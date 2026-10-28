package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestKakaoLogin(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable PostgreSQL database")
	}
	ctx := context.Background()
	db, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("KAKAO_REST_KEY", "test")
	t.Setenv("KAKAO_ADMIN_KEY", "admin-test")
	t.Setenv("KAKAO_APP_ID", "1234")
	t.Setenv("PUBLIC_BASE_URL", "https://api.example.test")
	subject := fmt.Sprintf("%d", time.Now().UnixNano())
	s := New(db)
	s.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := `{"access_token":"test"}`
		if strings.Contains(r.URL.Host, "kapi.kakao.com") {
			body = `{"id":` + subject + `,"kakao_account":{"profile":{"nickname":"reader"}}}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	h := s.Handler()
	req := func(method, path, token string, body any) *httptest.ResponseRecorder {
		t.Helper()
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	parse := func(w *httptest.ResponseRecorder) map[string]any {
		var v map[string]any
		if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
			t.Fatal(e)
		}
		return v
	}
	account := func() string {
		w := req("POST", "/auth/device", "", nil)
		if w.Code != 201 {
			t.Fatal(w.Body)
		}
		return parse(w)["token"].(string)
	}
	first, second := account(), account()
	login := func(token string) string {
		w := req("POST", "/auth/kakao/start", token, map[string]string{"returnUrl": "chaekjang://auth/kakao", "accountLifecycle": "1"})
		if w.Code != 200 {
			t.Fatalf("start %d %s", w.Code, w.Body)
		}
		auth, e := url.Parse(parse(w)["url"].(string))
		if e != nil {
			t.Fatal(e)
		}
		state := auth.Query().Get("state")
		w = req("GET", "/auth/kakao/callback?state="+url.QueryEscape(state)+"&code=test", "", nil)
		if w.Code != 302 {
			t.Fatalf("callback %d %s", w.Code, w.Body)
		}
		ret, e := url.Parse(w.Header().Get("Location"))
		if e != nil {
			t.Fatal(e)
		}
		ticket := ret.Query().Get("ticket")
		if ticket == "" {
			t.Fatal("ticket missing")
		}
		return ticket
	}
	ticket := login(first)
	if w := req("POST", "/auth/kakao/claim", second, map[string]string{"ticket": ticket}); w.Code != 400 {
		t.Fatalf("foreign claim %d", w.Code)
	}
	w := req("POST", "/auth/kakao/claim", first, map[string]string{"ticket": ticket})
	if w.Code != 200 || parse(w)["switched"] != false {
		t.Fatalf("first claim %d %s", w.Code, w.Body)
	}
	if w = req("POST", "/auth/kakao/claim", first, map[string]string{"ticket": ticket}); w.Code != 400 {
		t.Fatalf("reused ticket %d", w.Code)
	}
	ticket = login(second)
	w = req("POST", "/auth/kakao/claim", second, map[string]string{"ticket": ticket})
	if w.Code != 200 || parse(w)["switched"] != true {
		t.Fatalf("switched claim %d %s", w.Code, w.Body)
	}
	if w = req("POST", "/auth/kakao/start", first, map[string]string{"returnUrl": "https://attacker.example", "accountLifecycle": "1"}); w.Code != 400 {
		t.Fatalf("invalid return %d", w.Code)
	}
}
