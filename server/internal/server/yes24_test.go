package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

// YES24 응답 모양은 2026-10-31 실제 호출(detail=Y)에서 옮겼다
const yes24Body = `{"success":true,"message":"성공","errorCode":null,"data":{"items":[
{"title":"모순","author":"양귀자 저","goodsType":"도서","publisher":"쓰다","isbn13":"9788998441012","publishDate":"20130401","pages":308,"width":128,"length":188,"itemFormat":"양장","cover":"https://image.yes24.com/goods/8759796/L","link":"https://www.yes24.com/product/goods/8759796","goodsSortNm":"국내도서-소설/시/희곡","series":[],"contentDetail":{"bookIntroduction":" 초판이 나온 지 벌써 15년이 흘렀지만 ","bookSummary":null}},
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
		{ISBN: "9788998441012", Title: "모순", Authors: []string{"양귀자"}, Publisher: "쓰다", PublishedAt: "2013-04-01", Thumb: "https://image.yes24.com/goods/8759796/L", Description: "초판이 나온 지 벌써 15년이 흘렀지만", Pages: 308, WidthMm: 128, HeightMm: 188, Binding: "양장", Link: "https://www.yes24.com/product/goods/8759796", Category: "국내도서>소설/시/희곡", Provider: "yes24"},
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
		if got := yes24Authors(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
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
