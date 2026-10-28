package server

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestGoogleLogin(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable PostgreSQL database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOOGLE_CLIENT_ID", "client-test")
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret-test")
	t.Setenv("PUBLIC_BASE_URL", "https://api.example.test")
	t.Setenv("FILE_DIR", t.TempDir())
	t.Setenv("S3_BUCKET", "")
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	exponent := big.NewInt(int64(key.E)).Bytes()
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "RSA", "kid": "key1", "use": "sig", "alg": "RS256", "n": enc(key.N.Bytes()), "e": enc(exponent)}}})
	nonce := ""
	subject := "google-" + time.Now().Format("150405.000000000")
	badNonce, badAudience, badSignature, expiredToken := false, false, false, false
	sign := func() string {
		header, _ := json.Marshal(map[string]any{"alg": "RS256", "kid": "key1", "typ": "JWT"})
		n := nonce
		if badNonce {
			n = "wrong"
		}
		aud := "client-test"
		if badAudience {
			aud = "other-client"
		}
		exp := time.Now().Add(time.Hour).Unix()
		if expiredToken {
			exp = time.Now().Add(-time.Hour).Unix()
		}
		body, _ := json.Marshal(map[string]any{"iss": "https://accounts.google.com", "sub": subject, "aud": aud, "iat": time.Now().Unix(), "exp": exp, "nonce": n, "name": "Reader"})
		payload := enc(header) + "." + enc(body)
		sum := sha256.Sum256([]byte(payload))
		signingKey := key
		if badSignature {
			signingKey = otherKey
		}
		sig, e := rsa.SignPKCS1v15(rand.Reader, signingKey, crypto.SHA256, sum[:])
		if e != nil {
			t.Fatal(e)
		}
		return payload + "." + enc(sig)
	}
	s := New(db)
	s.HTTP = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body := ""
		switch r.URL.Host {
		case "oauth2.googleapis.com":
			b, _ := json.Marshal(map[string]any{"access_token": "test", "token_type": "Bearer", "id_token": sign()})
			body = string(b)
		case "www.googleapis.com":
			body = string(jwks)
		default:
			t.Fatalf("unexpected provider host: %s", r.URL.Host)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{"Content-Type": []string{"application/json"}}}, nil
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
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatalf("response: %s", w.Body)
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
	login := func(token string) string {
		w := req("POST", "/auth/google/start", token, map[string]string{"returnUrl": "chaekjang://auth/google", "accountLifecycle": "1"})
		if w.Code != 200 {
			t.Fatalf("start %d %s", w.Code, w.Body)
		}
		auth, e := url.Parse(parse(w)["url"].(string))
		if e != nil {
			t.Fatal(e)
		}
		nonce = auth.Query().Get("nonce")
		state := auth.Query().Get("state")
		if nonce == "" || auth.Query().Get("code_challenge_method") != "S256" {
			t.Fatal("missing PKCE or nonce")
		}
		w = req("GET", "/auth/google/callback?state="+url.QueryEscape(state)+"&code=test", "", nil)
		if w.Code != 302 {
			t.Fatalf("callback %d %s", w.Code, w.Body)
		}
		if replay := req("GET", "/auth/google/callback?state="+url.QueryEscape(state)+"&code=test", "", nil); replay.Code != 400 {
			t.Fatalf("state replay %d", replay.Code)
		}
		target, e := url.Parse(w.Header().Get("Location"))
		if e != nil {
			t.Fatal(e)
		}
		if badNonce || badAudience || badSignature || expiredToken {
			if target.Query().Get("error") != "failed" {
				t.Fatal("invalid nonce accepted")
			}
			return ""
		}
		ticket := target.Query().Get("ticket")
		if ticket == "" {
			t.Fatalf("missing ticket: %s", w.Header().Get("Location"))
		}
		return ticket
	}
	first, second := account(), account()
	badNonce = true
	login(first)
	badNonce = false
	badAudience = true
	login(first)
	badAudience = false
	badSignature = true
	login(first)
	badSignature = false
	expiredToken = true
	login(first)
	expiredToken = false
	ticket := login(first)
	if w := req("POST", "/auth/google/claim", second, map[string]string{"ticket": ticket}); w.Code != 400 {
		t.Fatalf("foreign claim %d", w.Code)
	}
	w := req("POST", "/auth/google/claim", first, map[string]string{"ticket": ticket})
	if w.Code != 200 || parse(w)["switched"] != false {
		t.Fatalf("first claim %d %s", w.Code, w.Body)
	}
	if w = req("POST", "/auth/google/claim", first, map[string]string{"ticket": ticket}); w.Code != 400 {
		t.Fatalf("reused ticket %d", w.Code)
	}
	ticket = login(second)
	w = req("POST", "/auth/google/claim", second, map[string]string{"ticket": ticket})
	if w.Code != 200 || parse(w)["switched"] != true {
		t.Fatalf("switched %d %s", w.Code, w.Body)
	}
	if w = req("GET", "/me", second, nil); w.Code != 401 {
		t.Fatalf("old anonymous token remains valid: %d", w.Code)
	}
	if w = req("POST", "/auth/google/start", first, map[string]string{"returnUrl": "chaekjang://auth/google"}); w.Code != 426 {
		t.Fatalf("old client accepted: %d", w.Code)
	}
	if w = req("POST", "/auth/google/start", first, map[string]string{"returnUrl": "https://attacker.example", "accountLifecycle": "1"}); w.Code != 400 {
		t.Fatalf("invalid return %d", w.Code)
	}
}
