package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestS3Files(t *testing.T) {
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
	var saved []byte
	object := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/test-bucket/") {
			t.Errorf("wrong S3 path %s", r.URL.Path)
			http.Error(w, "bad path", 400)
			return
		}
		if r.Header.Get("Authorization") == "" {
			t.Error("missing S3 signature")
		}
		switch r.Method {
		case "PUT":
			saved, _ = io.ReadAll(r.Body)
			w.WriteHeader(200)
		case "GET":
			_, _ = w.Write(saved)
		default:
			http.Error(w, "bad method", 405)
		}
	}))
	defer object.Close()
	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_ENDPOINT", object.URL)
	t.Setenv("S3_REGION", "auto")
	t.Setenv("S3_ACCESS_KEY", "fake-access")
	t.Setenv("S3_SECRET_KEY", "fake-secret")
	handler := New(db).Handler()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/auth/device", nil))
	if w.Code != 201 {
		t.Fatalf("device: %d %s", w.Code, w.Body)
	}
	var account struct {
		Token string `json:"token"`
	}
	if e = json.Unmarshal(w.Body.Bytes(), &account); e != nil {
		t.Fatal(e)
	}
	payload := []byte("image bytes")
	put := httptest.NewRequest("PUT", "/files/test.png", bytes.NewReader(payload))
	put.Header.Set("Authorization", "Bearer "+account.Token)
	put.Header.Set("Content-Type", "image/png")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, put)
	if w.Code != 204 {
		t.Fatalf("upload %d %s", w.Code, w.Body)
	}
	if !bytes.Equal(saved, payload) {
		t.Fatalf("stored %q, want %q", saved, payload)
	}
	get := httptest.NewRequest("GET", "/files/test.png", nil)
	get.Header.Set("Authorization", "Bearer "+account.Token)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, get)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), payload) {
		t.Fatalf("download %d %q", w.Code, w.Body.Bytes())
	}
}
