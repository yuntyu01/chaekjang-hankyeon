package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"
)

// YES24 Developers 상품 API(https://developers.yes24.com/docs). 키는 서버에만 둔다(문서: 클라이언트 코드에 넣지 말 것).
// detail=Y여야 쪽수·가로·세로(mm)·판형이 온다. 책장 책 크기를 정하는 값이라 검색·ISBN 조회 모두 detail=Y로 부른다.
// 약관: 앱에 보일 때 출처(YES24)와 상품 페이지 링크를 함께 보인다(link). 종이책만 쓴다(eBook·음반 제외).
func yes24Key() string { return os.Getenv("YES24_API_KEY") }

func yes24Base() string {
	if v := os.Getenv("YES24_API_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://apis.yes24.com/v1"
}

type yes24Item struct {
	Title       string `json:"title"`
	Author      string `json:"author"`
	GoodsType   string `json:"goodsType"`
	Publisher   string `json:"publisher"`
	ISBN13      string `json:"isbn13"`
	PublishDate string `json:"publishDate"`
	Pages       *int   `json:"pages"`
	Width       *int   `json:"width"`
	Length      *int   `json:"length"`
	ItemFormat  string `json:"itemFormat"`
	Cover       string `json:"cover"`
	Link        string `json:"link"`
	GoodsSortNm string `json:"goodsSortNm"` // "국내도서-소설/시/희곡"
	Series      []struct {
		SeriesName string `json:"seriesName"`
	} `json:"series"`
	ContentDetail *struct {
		BookIntroduction string `json:"bookIntroduction"`
	} `json:"contentDetail"`
}

func (s *Server) yes24Search(q string, isbn bool) ([]searchItem, error) {
	if isbn {
		raw, e := s.yes24Fetch("/goods/itemDetail", url.Values{"searchType": {"ISBN13"}, "query": {q}, "detail": {"Y"}})
		if e != nil {
			return nil, e
		}
		out := []searchItem{}
		for _, it := range raw {
			if yes24PaperBook(it) && it.ISBN13 == q && validISBN(it.ISBN13) {
				out = append(out, it.item())
			}
		}
		return out, nil
	}
	// 한글이 없는 검색어(원서 제목 등)는 외국 도서 칸(category=FOREIGN)을 100건까지 함께 받는다.
	// 전체 검색 30건에는 eBook·번역판·다른 책이 앞서 원서가 안 들어오기도 하고(Clean Code 원서는 외국 도서 54건 중 50위),
	// YES24 기본 순서는 품절 상품을 뒤로 민다. 그래서 전체 검색 앞 3건은 YES24 순서 그대로 두고(영문 저자명으로 찾으면
	// YES24가 국내 번역본을 먼저 준다: "Haruki Murakami" → 무라카미 하루키 책), 나머지를 검색어와 맞는 정도로 다시 줄 세운다.
	hangul := strings.ContainsFunc(q, func(r rune) bool { return unicode.Is(unicode.Hangul, r) })
	var foreignRaw []yes24Item
	var wg sync.WaitGroup
	if !hangul && !isbnLike(q) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			foreignRaw, _ = s.yes24Fetch("/goods/itemList", url.Values{"query": {q}, "pageSize": {"100"}, "detail": {"Y"}, "category": {"FOREIGN"}}) // 실패해도 전체 검색 결과로 답한다
		}()
	}
	raw, e := s.yes24Fetch("/goods/itemList", url.Values{"query": {q}, "pageSize": {"30"}, "detail": {"Y"}})
	wg.Wait()
	if e != nil {
		return nil, e
	}
	out, foreign := []searchItem{}, []searchItem{}
	seen := map[string]bool{}
	head := 0 // 전체 검색에서 온 책 수(앞쪽)
	for n, it := range append(raw, foreignRaw...) {
		if !yes24PaperBook(it) || !validISBN(it.ISBN13) || seen[it.ISBN13] {
			continue
		}
		seen[it.ISBN13] = true
		if n < len(raw) {
			head++
		}
		// 한글 검색어면 국내 도서를 먼저, 외국 도서(한국 책의 번역판 등)는 뒤에 붙인다
		if hangul && yes24Foreign(it) {
			foreign = append(foreign, it.item())
			continue
		}
		out = append(out, it.item())
	}
	if hangul {
		return append(out, foreign...), nil
	}
	rest := out[min(head, 3):]
	sort.SliceStable(rest, func(i, j int) bool { return matchTier(rest[i], q) < matchTier(rest[j], q) })
	if len(out) > 30 {
		out = out[:30]
	}
	return out, nil
}

// 결과 없음(SEARCH_001·GOODS_002, 404)은 빈 목록. 키 오류·한도 초과·서버 오류는 상위 서비스 오류로 알린다
func (s *Server) yes24Fetch(path string, v url.Values) ([]yes24Item, error) {
	req, e := http.NewRequest("GET", yes24Base()+path+"?"+v.Encode(), nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("X-Api-Key", yes24Key())
	res, e := s.HTTP.Do(req)
	if e != nil {
		return nil, upstream
	}
	defer res.Body.Close()
	var data struct {
		Success   bool   `json:"success"`
		ErrorCode string `json:"errorCode"`
		Data      struct {
			Items []yes24Item `json:"items"`
		} `json:"data"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 5<<20)).Decode(&data); e != nil {
		return nil, upstream
	}
	if !data.Success {
		if res.StatusCode == http.StatusNotFound {
			return nil, nil
		}
		return nil, upstream
	}
	return data.Data.Items, nil
}

func (it yes24Item) item() searchItem {
	item := searchItem{ISBN: it.ISBN13, Title: it.Title, Authors: yes24Authors(it.Author, yes24Foreign(it)), Publisher: it.Publisher, PublishedAt: yes24Date(it.PublishDate), Thumb: it.Cover, Binding: it.ItemFormat, Link: it.Link, Category: yes24Category(it.GoodsSortNm), Provider: "yes24"}
	if len(it.Series) > 0 {
		item.Series = strings.TrimSpace(it.Series[0].SeriesName)
	}
	if it.ContentDetail != nil {
		item.Description = strings.TrimSpace(it.ContentDetail.BookIntroduction)
	}
	if it.Pages != nil && *it.Pages > 0 {
		item.Pages = *it.Pages
	}
	// 가로·세로가 둘 다 있을 때만 판형으로 쓴다(한쪽만 있거나 0이면 비워 두고 추정하지 않는다)
	if it.Width != nil && it.Length != nil && *it.Width > 0 && *it.Length > 0 {
		item.WidthMm, item.HeightMm = min(*it.Width, *it.Length), max(*it.Width, *it.Length)
	}
	return item
}

func isbnLike(q string) bool {
	d := strings.NewReplacer("-", "", " ", "").Replace(q)
	return (len(d) == 10 || len(d) == 13) && strings.Trim(d, "0123456789Xx") == ""
}

// 제목이 검색어와 맞는 정도: 0 본제목(부제·괄호 앞)이 같음, 1 제목이 검색어로 시작, 2 검색어가 이어서 들어 있음, 3 낱말이 모두 들어 있음, 4 그 밖
// 대소문자·문장부호·앞의 관사(the·a·an)는 무시한다("The Norwegian Wood"도 "Norwegian Wood"와 같게).
func titleTier(title, q string) int {
	nq, nt, nm := titleWords(q), titleWords(title), titleWords(mainTitle(title))
	switch {
	case nq == "":
		return 4
	case nm == nq:
		return 0
	case strings.HasPrefix(nt+" ", nq+" "):
		return 1
	case strings.Contains(" "+nt+" ", " "+nq+" "):
		return 2
	}
	words := map[string]bool{}
	for _, w := range strings.Fields(nt) {
		words[w] = true
	}
	for _, w := range strings.Fields(nq) {
		if !words[w] {
			return 4
		}
	}
	return 3
}

// 다시 줄 세울 때의 순위: 저자가 검색어와 같으면 0(그 저자의 책), 아니면 제목 단계. 제목·저자 낱말을 합쳐 다 들어 있으면 3
func matchTier(it searchItem, q string) int {
	qw := strings.Fields(titleWords(q))
	if len(qw) == 0 {
		return 4
	}
	have := map[string]bool{}
	for _, w := range strings.Fields(titleWords(strings.Join(it.Authors, " "))) {
		have[w] = true
	}
	if allIn(qw, have) {
		return 0
	}
	t := titleTier(it.Title, q)
	if t == 4 {
		for _, w := range strings.Fields(titleWords(it.Title)) {
			have[w] = true
		}
		if allIn(qw, have) {
			return 3
		}
	}
	return t
}

func allIn(words []string, set map[string]bool) bool {
	for _, w := range words {
		if !set[w] {
			return false
		}
	}
	return true
}

var leadingTag = regexp.MustCompile(`^\s*(\[[^\]]*\]|【[^】]*】)\s*`)
var subtitleCut = regexp.MustCompile(`\s*[:：(（\[【]|\s+[-–—]\s+`)

// "[미국판] Pachinko (미국판) : …" → "Pachinko", "Clean Code: A Handbook…" → "Clean Code"
func mainTitle(t string) string {
	t = leadingTag.ReplaceAllString(t, "")
	if loc := subtitleCut.FindStringIndex(t); loc != nil && loc[0] > 0 {
		return t[:loc[0]]
	}
	return t
}

func titleWords(s string) string {
	s = strings.NewReplacer("'", "", "’", "", "`", "").Replace(strings.ToLower(s))
	w := strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	for len(w) > 0 && (w[0] == "the" || w[0] == "a" || w[0] == "an") {
		w = w[1:]
	}
	return strings.Join(w, " ")
}

// "국내도서-소설/시/희곡" → "국내도서>소설/시/희곡"(앱 rebinding.genreOf가 '>' 경로를 안쪽부터 읽는다)
func yes24Category(s string) string {
	parts := []string{}
	for _, p := range strings.Split(s, "-") {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	return strings.Join(parts, ">")
}

// "20130401" → "2013-04-01"(형식이 다르면 비운다)
func yes24Date(s string) string {
	if len(s) != 8 {
		return ""
	}
	return s[:4] + "-" + s[4:6] + "-" + s[6:]
}

// 종이책인지: 국내 '도서'와 외국 도서(관리 분류 goodsSortNm이 '외국도서-…'). eBook·음반·DVD·문구·중고는 뺀다.
// 외국 종이책은 상품 유형이 '외서'·'직수입양서'·'직수입일서'처럼 '도서'라는 말 없이 온다(2026-10-31 실제 응답).
func yes24PaperBook(it yes24Item) bool {
	if strings.Contains(it.GoodsType, "도서") {
		return true
	}
	t := strings.ToLower(strings.TrimSpace(it.GoodsType))
	return yes24Foreign(it) && t != "ebook" && t != "중고"
}

func yes24Foreign(it yes24Item) bool {
	return strings.HasPrefix(strings.TrimSpace(it.GoodsSortNm), "외국도서")
}

var yes24Role = regexp.MustCompile(`\s+(공저|편저|저|지음|글|엮음|원작|역|옮김|번역|그림|감수|사진)\s*$`)

// 외서 역할 코드: "Deborah Smith (TRN)" 옮긴이, (ILT) 그린이, (EDT) 엮은이, "Not Available (NA)" 정보 없음. (AUT)만 지은이
var yes24Code = regexp.MustCompile(`\s*\(([A-Z]{2,3})\)\s*$`)

// "J.K 롤링 저/강동혁 역" → [J.K 롤링]. 지은이만 남긴다(옮긴이·그린이·감수는 뺀다). 역할 표시가 없으면 이름 그대로.
// 외서(foreign)는 "/"가 사람 사이이고 쉼표 하나는 "성, 이름"이다: "Fitzgerald, F. Scott" → F. Scott Fitzgerald.
// 쉼표가 둘 이상이면 이름 나열로 본다("Han Kang, Kyungran Choi, Pierre Bisiou").
func yes24Authors(s string, foreign bool) []string {
	out := []string{}
	seen := map[string]bool{}
	add := func(name string) {
		if name = strings.Join(strings.Fields(name), " "); name != "" && !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	for _, part := range strings.Split(s, "/") {
		role := yes24Role.FindStringSubmatch(part)
		if role != nil && !strings.Contains("공저 편저 저 지음 글 엮음 원작", role[1]) {
			continue
		}
		part = yes24Role.ReplaceAllString(part, "")
		if code := yes24Code.FindStringSubmatch(part); code != nil {
			if code[1] != "AUT" {
				continue
			}
			part = yes24Code.ReplaceAllString(part, "")
		}
		if foreign && strings.Count(part, ",") == 1 {
			name := strings.SplitN(part, ",", 2)
			add(strings.TrimSpace(name[1]) + " " + strings.TrimSpace(name[0]))
			continue
		}
		for _, name := range strings.Split(part, ",") {
			add(name)
		}
	}
	return out
}

// 판형 문자열: "양장 128x188"(heightFromFormat이 숫자 쌍을 읽는다)
func (it searchItem) format() string {
	if it.WidthMm == 0 || it.HeightMm == 0 {
		return it.Binding
	}
	return strings.TrimSpace(fmt.Sprintf("%s %dx%d", it.Binding, it.WidthMm, it.HeightMm))
}
