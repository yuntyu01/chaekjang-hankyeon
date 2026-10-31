package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
)

// YES24 응답 모양은 2026-10-31 실제 호출(detail=Y)에서 옮겼다
const yes24Body = `{"success":true,"message":"성공","errorCode":null,"data":{"items":[
{"itemId":8759796,"title":"모순","author":"양귀자 저","goodsType":"도서","publisher":"쓰다","isbn13":"9788998441012","publishDate":"20130401","pages":308,"width":128,"length":188,"itemFormat":"양장","cover":"https://image.yes24.com/goods/8759796/L","link":"https://www.yes24.com/product/goods/8759796","goodsSortNm":"국내도서-소설/시/희곡","series":[],"contentDetail":{"bookIntroduction":" 초판이 나온 지 벌써 15년이 흘렀지만 ","bookSummary":null}},
{"title":"모순","author":"양귀자 저","goodsType":"eBook","publisher":"쓰다","isbn13":"9791134373641","publishDate":"20220712","pages":308,"width":null,"length":null,"cover":"x","link":"y"},
{"title":"해리 포터와 마법사의 돌 1","author":"J.K 롤링 저/강동혁 역","goodsType":"도서","publisher":"문학수첩","isbn13":"9791193790403","publishDate":"20240101","pages":null,"width":137,"length":null,"cover":"","link":"https://www.yes24.com/product/goods/1","series":[{"seriesId":1,"seriesName":"해리 포터 20주년 개정판"}],"contentDetail":null},
{"title":"영화음악","author":"John Williams","goodsType":"LP","isbn13":"8809000000000"}],"currentPage":1,"pageSize":30,"totalCount":4}}`

func yes24Server(t *testing.T, status int, body string, seen *[]*http.Request) *Server {
	t.Helper()
	t.Setenv("YES24_API_KEY", "yk_test")
	t.Setenv("YES24_API_URL", "https://yes24.test/v1")
	s := New(nil)
	s.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		*seen = append(*seen, r)
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	return s
}

func TestYes24Search(t *testing.T) {
	var seen []*http.Request
	s := yes24Server(t, 200, yes24Body, &seen)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/books/search?q=%EB%AA%A8%EC%88%9C", nil))
	if w.Code != 200 {
		t.Fatalf("status %d %s", w.Code, w.Body)
	}
	r := seen[0]
	if r.Header.Get("X-Api-Key") != "yk_test" || r.URL.Path != "/v1/goods/itemList" || r.URL.Query().Get("detail") != "Y" || r.URL.Query().Get("query") != "모순" {
		t.Fatalf("request %s %v", r.URL, r.Header)
	}
	var got struct{ Items []searchItem }
	if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil {
		t.Fatal(e)
	}
	// 종이책만(eBook·LP 제외), 쪽수·판형은 있을 때만, 옮긴이는 지은이에서 뺀다. 분류는 '>' 경로, 시리즈는 첫 이름, 책 소개는 앞뒤 공백 없이
	want := []searchItem{
		{ISBN: "9788998441012", Title: "모순", Authors: []string{"양귀자"}, Publisher: "쓰다", PublishedAt: "2013-04-01", Thumb: "https://image.yes24.com/goods/8759796/L", Description: "초판이 나온 지 벌써 15년이 흘렀지만", Pages: 308, WidthMm: 128, HeightMm: 188, Binding: "양장", Link: "https://www.yes24.com/product/goods/8759796", ProductID: "8759796", Category: "국내도서>소설/시/희곡", Provider: "yes24"},
		{ISBN: "9791193790403", Title: "해리 포터와 마법사의 돌 1", Authors: []string{"J.K 롤링"}, Publisher: "문학수첩", PublishedAt: "2024-01-01", Link: "https://www.yes24.com/product/goods/1", Series: "해리 포터 20주년 개정판", Provider: "yes24"},
	}
	if !reflect.DeepEqual(got.Items, want) {
		t.Fatalf("items\n got %+v\nwant %+v", got.Items, want)
	}
	if f := got.Items[0].format(); f != "양장 128x188" || heightFromFormat(f) != "short" {
		t.Fatalf("format %q → %s", f, heightFromFormat(f))
	}
}

func TestYes24ISBNAndErrors(t *testing.T) {
	var seen []*http.Request
	s := yes24Server(t, 200, yes24Body, &seen)
	items, e := s.searchBooks("9788998441012", true)
	if e != nil || len(items) != 1 || items[0].ISBN != "9788998441012" {
		t.Fatalf("isbn %v %+v", e, items)
	}
	if q := seen[0].URL.Query(); seen[0].URL.Path != "/v1/goods/itemDetail" || q.Get("searchType") != "ISBN13" || q.Get("detail") != "Y" {
		t.Fatalf("detail request %s", seen[0].URL)
	}
	// 결과 없음(404 SEARCH_001)은 빈 목록, 키 오류(401)·한도(429)는 상위 서비스 오류
	s = yes24Server(t, 404, `{"success":false,"errorCode":"SEARCH_001","message":"검색 결과가 없습니다.","data":null}`, &seen)
	if items, e := s.searchBooks("없는책", false); e != nil || len(items) != 0 {
		t.Fatalf("not found %v %+v", e, items)
	}
	for _, status := range []int{401, 429, 500} {
		s = yes24Server(t, status, `{"success":false,"errorCode":"AUTH_002","message":"x","data":null}`, &seen)
		if _, e := s.searchBooks("모순", false); e != upstream {
			t.Fatalf("%d: %v", status, e)
		}
	}
}

func TestYes24Authors(t *testing.T) {
	for in, want := range map[string][]string{
		"양귀자 저":               {"양귀자"},
		"J.K 롤링 저/강동혁 역":      {"J.K 롤링"},
		"김영하, 정세랑 공저":         {"김영하", "정세랑"},
		"앙투안 드 생텍쥐페리 저/황현산 역": {"앙투안 드 생텍쥐페리"},
		"한강 저 / 홍길동 그림":       {"한강"},
		"John Williams":       {"John Williams"},
		"김저":                  {"김저"},
	} {
		if got := yes24Authors(in, false); !reflect.DeepEqual(got, want) {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
	// 외서 표기(2026-10-31 실제 응답): "성, 이름", 역할 코드 (TRN)·(ILT)·(EDT)·(NA), 같은 이름 반복
	for in, want := range map[string][]string{
		"Fitzgerald, F. Scott":          {"F. Scott Fitzgerald"},
		"Rowling, J. K.":                {"J. K. Rowling"},
		"Han Kang/ Deborah Smith (TRN)": {"Han Kang"},
		"Not Available (NA)":            {},
		"":                              {},
		"Lee, Miye/Lee, Sandy Joosun(TRN)/Ucar, Aysegul(EDT)":   {"Miye Lee"},
		"Han Kang/ e. yaewon (TRN), Paige Aniyah Morris (TRN)":  {"Han Kang"},
		"J. K. Rowling/ Mary GrandPre (ILT)":                    {"J. K. Rowling"},
		"de Saint-Exupery, Antoine / de Saint-Exupery, Antoine": {"Antoine de Saint-Exupery"},
		"Han Kang, Kyungran Choi, Pierre Bisiou":                {"Han Kang", "Kyungran Choi", "Pierre Bisiou"},
		"Won-pyung Sohn":                                        {"Won-pyung Sohn"},
		"東野 圭吾 저/よん 그림 ":                                        {"東野 圭吾"},
	} {
		if got := yes24Authors(in, true); !reflect.DeepEqual(got, want) {
			t.Errorf("외서 %q → %q, want %q", in, got, want)
		}
	}
}

// 외국 종이책(외서·직수입양서·직수입일서)은 상품 유형에 '도서'가 없어도 넣는다. 외국 eBook·중고·음반은 뺀다.
// 앞 네 권은 2026-10-31 실제 응답(detail=Y)에서 옮겼다.
const yes24ForeignBody = `{"success":true,"message":"성공","errorCode":null,"data":{"items":[
{"title":"The Great Gatsby","author":"Fitzgerald, F. Scott","goodsType":"외서","goodsSortNm":"외국도서-문학","publisher":"Scribner Book Company","isbn13":"9780743273565","publishDate":"20041001","pages":180,"width":141,"length":201,"height":20,"itemFormat":null,"cover":"https://image.yes24.com/goods/1489124/L","link":"https://www.yes24.com/product/goods/1489124"},
{"title":"ノルウェイの森(上)","author":"","goodsType":"직수입일서","goodsSortNm":"외국도서-일본도서-문학-소설","publisher":"講談社","isbn13":"9784061848924","publishDate":"19910401","pages":269,"width":105,"length":148,"height":null,"itemFormat":null,"cover":"https://image.yes24.com/goods/241680/L","link":"https://www.yes24.com/product/goods/241680"},
{"title":"Kim Jiyoung, Born 1982","author":"Not Available (NA)","goodsType":"직수입양서","goodsSortNm":"외국도서-경제/경영","publisher":"Liveright Pub Corp","isbn13":"9781631496707","publishDate":"20200414","pages":144,"width":0,"length":0,"height":0,"itemFormat":null,"cover":"https://image.yes24.com/goods/74293518/L","link":"https://www.yes24.com/product/goods/74293518"},
{"title":"Human Acts  한강 작가『소년이 온다』 영문판 (미국판)","author":"Han Kang/ Deborah Smith (TRN)","goodsType":"외서","goodsSortNm":"외국도서-문학","publisher":"Hogarth Press","isbn13":"9781101906743","publishDate":"20171017","pages":224,"width":132,"length":200,"height":20,"itemFormat":null,"cover":"https://image.yes24.com/goods/35896136/L","link":"https://www.yes24.com/product/goods/35896136"},
{"title":"Clean Code","author":"Martin, Robert","goodsType":"eBook","goodsSortNm":"외국도서-컴퓨터","isbn13":"9780132350884","pages":464},
{"title":"Harry Potter","author":"Rowling, J. K.","goodsType":"중고","goodsSortNm":"외국도서-문학","isbn13":"9781408855652","pages":224},
{"title":"Soundtrack","author":"John Williams","goodsType":"CD","goodsSortNm":"음반-OST","isbn13":"8809000000000"}],"currentPage":1,"pageSize":30,"totalCount":7}}`

func TestYes24ForeignBooks(t *testing.T) {
	var seen []*http.Request
	s := yes24Server(t, 200, yes24ForeignBody, &seen)
	items, e := s.searchBooks("Gatsby", false)
	if e != nil {
		t.Fatal(e)
	}
	want := []searchItem{
		{ISBN: "9780743273565", Title: "The Great Gatsby", Authors: []string{"F. Scott Fitzgerald"}, Publisher: "Scribner Book Company", PublishedAt: "2004-10-01", Thumb: "https://image.yes24.com/goods/1489124/L", Pages: 180, WidthMm: 141, HeightMm: 201, Link: "https://www.yes24.com/product/goods/1489124", Category: "외국도서>문학", Provider: "yes24"},
		{ISBN: "9784061848924", Title: "ノルウェイの森(上)", Authors: []string{}, Publisher: "講談社", PublishedAt: "1991-04-01", Thumb: "https://image.yes24.com/goods/241680/L", Pages: 269, WidthMm: 105, HeightMm: 148, Link: "https://www.yes24.com/product/goods/241680", Category: "외국도서>일본도서>문학>소설", Provider: "yes24"},
		// 가로·세로 0은 판형으로 쓰지 않는다
		{ISBN: "9781631496707", Title: "Kim Jiyoung, Born 1982", Authors: []string{}, Publisher: "Liveright Pub Corp", PublishedAt: "2020-04-14", Thumb: "https://image.yes24.com/goods/74293518/L", Pages: 144, Link: "https://www.yes24.com/product/goods/74293518", Category: "외국도서>경제/경영", Provider: "yes24"},
		{ISBN: "9781101906743", Title: "Human Acts  한강 작가『소년이 온다』 영문판 (미국판)", Authors: []string{"Han Kang"}, Publisher: "Hogarth Press", PublishedAt: "2017-10-17", Thumb: "https://image.yes24.com/goods/35896136/L", Pages: 224, WidthMm: 132, HeightMm: 200, Link: "https://www.yes24.com/product/goods/35896136", Category: "외국도서>문학", Provider: "yes24"},
	}
	if !reflect.DeepEqual(items, want) {
		t.Fatalf("items\n got %+v\nwant %+v", items, want)
	}
	// ISBN 상세 조회도 같은 판정(외서가 404처럼 빠지지 않는다)
	s = yes24Server(t, 200, yes24ForeignBody, &seen)
	if items, e := s.searchBooks("9781101906743", true); e != nil || len(items) != 1 || items[0].Authors[0] != "Han Kang" {
		t.Fatalf("isbn %v %+v", e, items)
	}
	if items, e := s.searchBooks("9780132350884", true); e != nil || len(items) != 0 {
		t.Fatalf("외국 eBook은 빠져야 한다 %v %+v", e, items)
	}
}

// 한글로 찾으면 국내 도서가 먼저(번역판 외서는 뒤), 다른 글자로 찾으면 YES24 순서 그대로
func TestYes24ForeignAfterDomesticForHangul(t *testing.T) {
	body := `{"success":true,"data":{"items":[
{"title":"The Vegetarian 한강 작가『채식주의자』 영문판 (영국판)","author":"Han Kang/ Deborah Smith (TRN)","goodsType":"외서","goodsSortNm":"외국도서-문학","isbn13":"9781846276033"},
{"title":"채식주의자","author":"한강 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788936434595"},
{"title":"素食者","author":"한강","goodsType":"외서","goodsSortNm":"외국도서-제2외국어-중국어","isbn13":"9789864897865"},
{"title":"채식주의자 (큰글자도서)","author":"한강 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788936480615"}]}}`
	order := func(q string) string {
		var seen []*http.Request
		items, e := yes24Server(t, 200, body, &seen).searchBooks(q, false)
		if e != nil {
			t.Fatal(e)
		}
		isbns := []string{}
		for _, it := range items {
			isbns = append(isbns, it.ISBN)
		}
		return strings.Join(isbns, " ")
	}
	if got := order("채식주의자"); got != "9788936434595 9788936480615 9781846276033 9789864897865" {
		t.Fatalf("한글 검색 %s", got)
	}
	if got := order("The Vegetarian"); got != "9781846276033 9788936434595 9789864897865 9788936480615" {
		t.Fatalf("영문 검색 %s", got)
	}
}

// 책 정보는 YES24 기준: 카카오 키(로그인용)가 있어도 책 검색에는 쓰지 않는다
func TestBookSourceYes24(t *testing.T) {
	t.Setenv("YES24_API_KEY", "")
	t.Setenv("KAKAO_REST_KEY", "k")
	if bookSource() != "mock" {
		t.Fatal(bookSource())
	}
	t.Setenv("YES24_API_KEY", "y")
	if bookSource() != "yes24" {
		t.Fatal(bookSource())
	}
}

func TestYes24Category(t *testing.T) {
	for in, want := range map[string]string{"국내도서-소설/시/희곡": "국내도서>소설/시/희곡", "국내도서-인문": "국내도서>인문", "": "", "외국도서": "외국도서"} {
		if got := yes24Category(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

func TestTitleTier(t *testing.T) {
	for _, c := range []struct {
		title, q string
		want     int
	}{
		{"Clean Code: A Handbook of Agile Software Craftsmanship", "Clean Code", 0},
		{"Clean Code", "clean code", 0},
		{"The Norwegian Wood", "Norwegian Wood", 0},
		{"[미국판] Pachinko (미국판) : 애플TV 드라마 '파친코' 원작소설", "Pachinko", 0},
		{"ノルウェイの森(上)", "ノルウェイの森", 0},
		{"Harry Potter and the Philosopher's Stone : MinaLima Edition (영국판)", "Harry Potter and the Philosopher's Stone", 0},
		{"Clean Code アジャイルソフトウェア達人の技", "Clean Code", 1},
		{"Clean Codex", "Clean Code", 4},
		{"Clean Code Cookbook: Recipes", "Clean Code", 1},
		{"Pragmatic Clean Code", "Clean Code", 2},
		{"Code That Is Clean", "Clean Code", 3},
		{"To Amend the Internal Revenue Code of 1986", "Clean Code", 4},
		{"아무 제목", "", 4},
	} {
		if got := titleTier(c.title, c.q); got != c.want {
			t.Errorf("titleTier(%q, %q) = %d, want %d", c.title, c.q, got, c.want)
		}
	}
}

// 한글이 없는 검색어는 외국 도서 칸(FOREIGN 100건)도 받는다. 전체 검색 앞 3건은 YES24 순서 그대로, 나머지는 검색어와 맞는 순.
// Clean Code 원서는 2026-10-31 실제 응답에서 전체 30건엔 없고 외국 도서 54건 중 50위였다.
func TestYes24ForeignCategoryRerank(t *testing.T) {
	run := func(all, foreign, q string, foreignStatus int) ([]string, []string) {
		t.Helper()
		t.Setenv("YES24_API_KEY", "yk_test")
		t.Setenv("YES24_API_URL", "https://yes24.test/v1")
		s := New(nil)
		var mu sync.Mutex
		cats := []string{}
		s.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			mu.Lock()
			cats = append(cats, r.URL.Query().Get("category")+"/"+r.URL.Query().Get("pageSize"))
			mu.Unlock()
			body, status := all, 200
			if r.URL.Query().Get("category") == "FOREIGN" {
				body, status = foreign, foreignStatus
				if status != 200 {
					body = `{"success":false,"errorCode":"UPSTREAM_UNAVAILABLE","data":null}`
				}
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})}
		items, e := s.searchBooks(q, false)
		if e != nil {
			t.Fatal(e)
		}
		isbns := []string{}
		for _, it := range items {
			isbns = append(isbns, it.ISBN)
		}
		sort.Strings(cats)
		return isbns, cats
	}
	all := `{"success":true,"data":{"items":[
{"title":"클린 코드","author":"로버트 C. 마틴 저/박재호,이해영 역","goodsType":"도서","goodsSortNm":"국내도서-IT 모바일","isbn13":"9788966265527"},
{"title":"Clean Code","author":"Robert C. Martin","goodsType":"eBook","goodsSortNm":"eBook-컴퓨터","isbn13":"9780132350884"},
{"title":"Pragmatic Clean Code","author":"Krystyna Ślusarczyk","goodsType":"직수입양서","goodsSortNm":"외국도서-컴퓨터외서","isbn13":"9781808493799"},
{"title":"The Clean Coder","author":"Martin, Robert C.","goodsType":"외서","goodsSortNm":"외국도서-컴퓨터외서","isbn13":"9780137081073"},
{"title":"To Amend the Internal Revenue Code of 1986","author":"United States Congress","goodsType":"직수입양서","goodsSortNm":"외국도서-법","isbn13":"9781240978052"}]}}`
	foreign := `{"success":true,"data":{"items":[
{"title":"Pragmatic Clean Code","author":"Krystyna Ślusarczyk","goodsType":"직수입양서","goodsSortNm":"외국도서-컴퓨터외서","isbn13":"9781808493799"},
{"title":"To Amend the Internal Revenue Code of 1986","author":"United States Congress","goodsType":"직수입양서","goodsSortNm":"외국도서-법","isbn13":"9781240978052"},
{"title":"Clean Code: A Handbook of Agile Software Craftsmanship","author":"Martin, Robert","goodsType":"외서","goodsSortNm":"외국도서-컴퓨터외서","isbn13":"9780132350884"}]}}`
	// 앞 3건 그대로, 그 뒤에 원서(본제목 일치)가 상관없는 책보다 먼저. 같은 ISBN의 eBook은 빠지고 겹친 책은 한 번만
	isbns, cats := run(all, foreign, "Clean Code", 200)
	if strings.Join(isbns, " ") != "9788966265527 9781808493799 9780137081073 9780132350884 9781240978052" || strings.Join(cats, ",") != "/30,FOREIGN/100" {
		t.Fatalf("영문 검색 %v %v", isbns, cats)
	}
	// 외국 도서 칸 요청이 실패해도 전체 검색 결과로 답한다
	if isbns, _ := run(all, foreign, "Clean Code", 503); strings.Join(isbns, " ") != "9788966265527 9781808493799 9780137081073 9781240978052" {
		t.Fatalf("외국 칸 실패 %v", isbns)
	}
	// 한글 검색어·ISBN은 요청 한 번(지금과 같다)
	if _, cats := run(all, foreign, "클린 코드", 200); strings.Join(cats, ",") != "/30" {
		t.Fatalf("한글 검색 요청 %v", cats)
	}
	if _, cats := run(all, foreign, "978-0-13-235088-4", 200); strings.Join(cats, ",") != "/30" {
		t.Fatalf("ISBN 검색 요청 %v", cats)
	}
	// 영문 저자명: YES24가 주는 국내 번역본 앞 3건은 그대로, 그 저자의 원서가 상관없는 책보다 먼저
	authorAll := `{"success":true,"data":{"items":[
{"title":"소년이 온다","author":"한강 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788936434120"},
{"title":"채식주의자","author":"한강 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788936434595"},
{"title":"작별하지 않는다","author":"한강 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788954682152"},
{"title":"모순","author":"양귀자 저","goodsType":"도서","goodsSortNm":"국내도서-소설/시/희곡","isbn13":"9788998441012"}]}}`
	authorForeign := `{"success":true,"data":{"items":[
{"title":"Han Kang: Un voyage","author":"Humaines, Gew","goodsType":"직수입양서","goodsSortNm":"외국도서-문학","isbn13":"9781408855652"},
{"title":"Human Acts","author":"Han Kang/ Deborah Smith (TRN)","goodsType":"외서","goodsSortNm":"외국도서-문학","isbn13":"9781101906743"}]}}`
	if isbns, _ := run(authorAll, authorForeign, "Han Kang", 200); strings.Join(isbns, " ") != "9788936434120 9788936434595 9788954682152 9781408855652 9781101906743 9788998441012" {
		t.Fatalf("저자 검색 %v", isbns)
	}
}
