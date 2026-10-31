package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
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
}

func (s *Server) yes24Search(q string, isbn bool) ([]searchItem, error) {
	path, v := "/goods/itemList", url.Values{"query": {q}, "pageSize": {"30"}, "detail": {"Y"}}
	if isbn {
		path, v = "/goods/itemDetail", url.Values{"searchType": {"ISBN13"}, "query": {q}, "detail": {"Y"}}
	}
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
	// 결과 없음(SEARCH_001·GOODS_002, 404)은 빈 목록. 키 오류·한도 초과·서버 오류는 상위 서비스 오류로 알린다
	if !data.Success {
		if res.StatusCode == http.StatusNotFound {
			return []searchItem{}, nil
		}
		return nil, upstream
	}
	out := []searchItem{}
	for _, it := range data.Data.Items {
		if !strings.Contains(it.GoodsType, "도서") || !validISBN(it.ISBN13) || (isbn && it.ISBN13 != q) {
			continue
		}
		item := searchItem{ISBN: it.ISBN13, Title: it.Title, Authors: yes24Authors(it.Author), Publisher: it.Publisher, PublishedAt: yes24Date(it.PublishDate), Thumb: it.Cover, Binding: it.ItemFormat, Link: it.Link, Provider: "yes24"}
		if it.Pages != nil && *it.Pages > 0 {
			item.Pages = *it.Pages
		}
		// 가로·세로가 둘 다 있을 때만 판형으로 쓴다(한쪽만 있거나 0이면 비워 두고 추정하지 않는다)
		if it.Width != nil && it.Length != nil && *it.Width > 0 && *it.Length > 0 {
			item.WidthMm, item.HeightMm = min(*it.Width, *it.Length), max(*it.Width, *it.Length)
		}
		out = append(out, item)
	}
	return out, nil
}

// "20130401" → "2013-04-01"(형식이 다르면 비운다)
func yes24Date(s string) string {
	if len(s) != 8 {
		return ""
	}
	return s[:4] + "-" + s[4:6] + "-" + s[6:]
}

var yes24Role = regexp.MustCompile(`\s+(공저|편저|저|지음|글|엮음|원작|역|옮김|번역|그림|감수|사진)\s*$`)

// "J.K 롤링 저/강동혁 역" → [J.K 롤링]. 지은이만 남긴다(옮긴이·그린이·감수는 뺀다). 역할 표시가 없으면 이름 그대로.
func yes24Authors(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, "/") {
		role := yes24Role.FindStringSubmatch(part)
		if role != nil && !strings.Contains("공저 편저 저 지음 글 엮음 원작", role[1]) {
			continue
		}
		for _, name := range strings.Split(yes24Role.ReplaceAllString(part, ""), ",") {
			if name = strings.TrimSpace(name); name != "" {
				out = append(out, name)
			}
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
