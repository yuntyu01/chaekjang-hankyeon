package server

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDeletionWithObjectStorage(t *testing.T) {
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
	var mu sync.Mutex
	objects := map[string][]byte{}
	failKey := ""
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "missing signature", 403)
			return
		}
		key := strings.TrimPrefix(r.URL.Path, "/test-bucket/")
		mu.Lock()
		defer mu.Unlock()
		if r.Method == "GET" && r.URL.Query().Get("list-type") == "2" {
			prefix := r.URL.Query().Get("prefix")
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprint(w, `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>`)
			for k, v := range objects {
				if strings.HasPrefix(k, prefix) {
					fmt.Fprint(w, "<Contents><Key>")
					_ = xml.EscapeText(w, []byte(k))
					fmt.Fprintf(w, "</Key><Size>%d</Size></Contents>", len(v))
				}
			}
			fmt.Fprint(w, "</ListBucketResult>")
			return
		}
		switch r.Method {
		case "PUT":
			objects[key], _ = io.ReadAll(r.Body)
			w.WriteHeader(200)
		case "GET":
			if b, ok := objects[key]; ok {
				_, _ = w.Write(b)
			} else {
				http.Error(w, "not found", 404)
			}
		case "DELETE":
			if key == failKey {
				http.Error(w, "temporary failure", 403)
				return
			}
			delete(objects, key)
			w.WriteHeader(204)
		default:
			http.Error(w, "unsupported", 405)
		}
	}))
	defer fake.Close()
	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_ENDPOINT", fake.URL)
	t.Setenv("S3_REGION", "auto")
	t.Setenv("S3_ACCESS_KEY", "test-access")
	t.Setenv("S3_SECRET_KEY", "test-secret")
	s := New(db)
	if err = s.InitializeDeletion(ctx); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/auth/device", nil))
	var a struct {
		ID    int64  `json:"userId"`
		Token string `json:"token"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	put := httptest.NewRequest("PUT", "/files/a.png", bytes.NewReader([]byte("photo")))
	put.Header.Set("Authorization", "Bearer "+a.Token)
	put.Header.Set("Content-Type", "image/png")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, put)
	if w.Code != 204 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	orphan := fmt.Sprintf("%d/orphan.png", a.ID)
	mu.Lock()
	objects[orphan] = []byte("orphan")
	failKey = orphan
	mu.Unlock()
	del := httptest.NewRequest("DELETE", "/me", strings.NewReader(`{"confirmation":"DELETE"}`))
	del.Header.Set("Authorization", "Bearer "+a.Token)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, del)
	if w.Code != 202 {
		t.Fatalf("delete: %d %s", w.Code, w.Body)
	}
	if err = s.processDeletionJobs(ctx); err != nil {
		t.Fatal(err)
	}
	var attempts int
	if err = db.QueryRow(ctx, "SELECT attempts FROM account_file_deletions WHERE storage_key=$1", orphan).Scan(&attempts); err != nil || attempts < 1 {
		t.Fatalf("failed object deletion was not queued: attempts=%d error=%v", attempts, err)
	}
	mu.Lock()
	failKey = ""
	mu.Unlock()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = s.processDeletionJobs(ctx)
		mu.Lock()
		_, photo := objects[fmt.Sprintf("%d/a.png", a.ID)]
		_, extra := objects[orphan]
		mu.Unlock()
		if !photo && !extra {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if _, ok := objects[fmt.Sprintf("%d/a.png", a.ID)]; ok {
		t.Fatal("photo still present")
	}
	if _, ok := objects[orphan]; ok {
		t.Fatal("orphan still present")
	}
	found := false
	for k := range objects {
		if strings.HasPrefix(k, journalPrefix) {
			found = true
		}
	}
	if !found {
		t.Fatal("durable journal missing")
	}
}
