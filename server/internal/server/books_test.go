package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchCacheAndUpstream(t *testing.T) {
	t.Setenv("YES24_API_KEY", "fake")
	t.Setenv("YES24_API_URL", "https://yes24.test/v1")
	t.Setenv("SEARCH_CACHE_TTL", "10m")
	calls := 0
	s := New(nil)
	s.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("X-Api-Key") != "fake" {
			t.Error("missing yes24 key")
		}
		body := `{"success":true,"data":{"items":[{"isbn13":"9790000000018","title":"여름의 숲","author":"작가 저","goodsType":"도서","publishDate":"20240102"},{"isbn13":"","title":"no isbn","goodsType":"도서"}]}}`
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	h := s.Handler()
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/books/search?q=%EC%97%AC%EB%A6%84", nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), "9790000000018") || strings.Contains(w.Body.String(), "no isbn") {
			t.Fatalf("search %d %s", w.Code, w.Body)
		}
	}
	if calls != 1 {
		t.Fatalf("search calls=%d", calls)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/books/search", nil))
	if w.Code != 400 {
		t.Fatalf("empty query: %d", w.Code)
	}
}
func TestISBN(t *testing.T) {
	for _, tc := range []struct {
		s    string
		want bool
	}{{"9790000000018", true}, {"9790000000019", false}, {"123", false}, {"97900000000x8", false}} {
		if got := validISBN(tc.s); got != tc.want {
			t.Fatalf("%q = %v", tc.s, got)
		}
	}
}
