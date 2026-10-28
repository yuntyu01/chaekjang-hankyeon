package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConcurrentPushPreservesCommitOrder(t *testing.T) {
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
	h := New(db).Handler()
	request := func(method, path, token string, body any) *httptest.ResponseRecorder {
		var data []byte
		if body != nil {
			data, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	var account struct {
		UserID int64  `json:"userId"`
		Token  string `json:"token"`
	}
	w := request("POST", "/auth/device", "", nil)
	if w.Code != 201 {
		t.Fatalf("account: %d %s", w.Code, w.Body)
	}
	if err = json.Unmarshal(w.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var locked int64
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", account.UserID).Scan(&locked); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO editions(user_id,id,title,source,created_at,updated_at,rev) VALUES($1,'slow','slow','manual',now(),now(),nextval('sync_rev_seq'))", account.UserID); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- request("POST", "/sync/push", account.Token, map[string]any{"editions": []any{map[string]any{"id": "fast", "title": "fast", "source": "manual", "updatedAt": "2026-10-28T00:00:00Z"}}})
	}()
	select {
	case r := <-done:
		t.Fatalf("same-user write committed before first transaction: %d %s", r.Code, r.Body)
	case <-time.After(200 * time.Millisecond):
	}
	// 한 사용자의 저장 대기가 다른 사용자까지 막지 않는다.
	otherAccount := request("POST", "/auth/device", "", nil)
	if otherAccount.Code != 201 {
		t.Fatalf("other account: %d %s", otherAccount.Code, otherAccount.Body)
	}
	var other struct {
		Token string `json:"token"`
	}
	if err = json.Unmarshal(otherAccount.Body.Bytes(), &other); err != nil {
		t.Fatal(err)
	}
	otherDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		otherDone <- request("POST", "/sync/push", other.Token, map[string]any{"editions": []any{map[string]any{"id": "other", "title": "other", "source": "manual", "updatedAt": "2026-10-28T00:00:00Z"}}})
	}()
	select {
	case r := <-otherDone:
		if r.Code != 200 {
			t.Fatalf("other user push %d %s", r.Code, r.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("unrelated user was blocked")
	}
	before := request("GET", "/sync/pull?since=0", account.Token, nil)
	var page struct {
		Rev      int64 `json:"rev"`
		Editions []struct {
			ID string `json:"id"`
		} `json:"editions"`
	}
	if err = json.Unmarshal(before.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Editions) != 0 || page.Rev != 0 {
		t.Fatalf("uncommitted data visible: %s", before.Body)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-done:
		if r.Code != 200 {
			t.Fatalf("push %d %s", r.Code, r.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("push did not resume")
	}
	seen := map[string]bool{}
	since := int64(0)
	for i := 0; i < 4; i++ {
		res := request("GET", fmt.Sprintf("/sync/pull?since=%d&limit=1", since), account.Token, nil)
		var p struct {
			Rev      int64 `json:"rev"`
			More     bool  `json:"more"`
			Editions []struct {
				ID string `json:"id"`
			} `json:"editions"`
		}
		if err = json.Unmarshal(res.Body.Bytes(), &p); err != nil {
			t.Fatal(err)
		}
		for _, e := range p.Editions {
			seen[e.ID] = true
		}
		since = p.Rev
		if !p.More {
			break
		}
	}
	if !seen["slow"] || !seen["fast"] {
		t.Fatalf("lost changes across pages: %v", seen)
	}
}
