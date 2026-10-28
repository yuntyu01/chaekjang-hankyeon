package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestIntegration(t *testing.T) {
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
	if e = Migrate(ctx, db); e != nil {
		t.Fatal(e)
	}
	t.Setenv("FILE_DIR", t.TempDir())
	t.Setenv("S3_BUCKET", "")
	t.Setenv("KAKAO_REST_KEY", "")
	h := New(db).Handler()
	request := func(method, path, token string, body any) (int, map[string]any) {
		t.Helper()
		var data []byte
		switch b := body.(type) {
		case nil:
		case []byte:
			data = b
		default:
			data, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if method == "PUT" {
			req.Header.Set("Content-Type", "image/png")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	account := func() string {
		status, body := request("POST", "/auth/device", "", nil)
		if status != 201 {
			t.Fatalf("device %d %+v", status, body)
		}
		return body["token"].(string)
	}
	one, two := account(), account()
	if status, _ := request("GET", "/me", "", nil); status != 401 {
		t.Fatalf("unauthorized: %d", status)
	}
	if status, body := request("PUT", "/files/a.png", one, []byte("image")); status != 204 {
		t.Fatalf("upload %d %+v", status, body)
	}
	if status, _ := request("GET", "/files/a.png", two, nil); status != 404 {
		t.Fatalf("cross-user file: %d", status)
	}
	at := "2026-10-01T12:00:00Z"
	body := map[string]any{"editions": []any{map[string]any{"id": "ed1", "title": "Book", "authors": []string{"A", "B"}, "source": "manual", "updatedAt": at}}, "books": []any{map[string]any{"id": "book1", "editionId": "ed1", "status": "reading", "currentPage": 12, "updatedAt": at}}, "bookmarks": []any{map[string]any{"id": "mark1", "myBookId": "book1", "text": "hello", "photoFileId": "a.png", "updatedAt": at}}, "layout": map[string]any{"layoutJson": "{\"shelves\":[]}", "version": 2, "updatedAt": at}}
	if status, out := request("POST", "/sync/push", one, body); status != 200 || out["applied"] != float64(4) {
		t.Fatalf("push %d %+v", status, out)
	}
	seen := map[string]bool{}
	since := 0
	for i := 0; i < 10; i++ {
		status, out := request("GET", fmt.Sprintf("/sync/pull?since=%d&limit=1", since), one, nil)
		if status != 200 {
			t.Fatalf("pull %d %+v", status, out)
		}
		for _, key := range []string{"editions", "books", "bookmarks"} {
			for _, v := range out[key].([]any) {
				seen[v.(map[string]any)["id"].(string)] = true
			}
		}
		if out["layout"] != nil {
			seen["layout"] = true
		}
		since = int(out["rev"].(float64))
		if !out["more"].(bool) {
			break
		}
	}
	for _, key := range []string{"ed1", "book1", "mark1", "layout"} {
		if !seen[key] {
			t.Fatalf("missing %s in pages: %v", key, seen)
		}
	}
	if status, out := request("GET", "/sync/pull", two, nil); status != 200 || len(out["books"].([]any)) != 0 {
		t.Fatalf("cross-user sync %d %+v", status, out)
	}
	stale := map[string]any{"books": []any{map[string]any{"id": "book1", "editionId": "ed1", "status": "read", "updatedAt": "2026-01-01T00:00:00Z"}}}
	if status, out := request("POST", "/sync/push", one, stale); status != 200 || len(out["skipped"].([]any)) != 1 {
		t.Fatalf("stale %d %+v", status, out)
	}
	invalid := map[string]any{"editions": []any{map[string]any{"id": "rollback", "title": "temp", "source": "manual", "updatedAt": at}}, "books": []any{map[string]any{"id": "bad", "editionId": "missing", "status": "read", "updatedAt": at}}}
	if status, out := request("POST", "/sync/push", one, invalid); status != 409 {
		t.Fatalf("missing reference %d %+v", status, out)
	}
	if _, out := request("GET", "/sync/pull", one, nil); len(out["editions"].([]any)) != 1 {
		t.Fatalf("transaction not rolled back %+v", out)
	}

	extended := map[string]any{
		"bindings": []any{map[string]any{"id": "binding1", "myBookId": "book1", "spineColor": "#abcdef", "motif": "leaf", "material": "cloth", "coverArtId": "cover1", "source": "custom", "status": "ready", "seed": 12, "updatedAt": at}},
		"rounds":   []any{map[string]any{"id": "round1", "myBookId": "book1", "index": 1, "startedAt": "2026-10-01", "paused": false, "updatedAt": at}},
		"sessions": []any{map[string]any{"id": "session1", "myBookId": "book1", "roundId": "round1", "startedAt": at, "endedAt": "2026-10-01T12:01:00Z", "durationMs": 60000, "pagesRead": 3, "updatedAt": at}},
	}
	if status, out := request("POST", "/sync/push", one, extended); status != 200 || out["applied"] != float64(3) {
		t.Fatalf("extended push %d %+v", status, out)
	}
	if status, out := request("GET", "/sync/pull", one, nil); status != 200 {
		t.Fatalf("extended pull %d %+v", status, out)
	} else {
		edition := out["editions"].([]any)[0].(map[string]any)
		authors := edition["authors"].([]any)
		if len(authors) != 2 || authors[0] != "A" || authors[1] != "B" {
			t.Fatalf("authors: %v", authors)
		}
		binding := out["bindings"].([]any)[0].(map[string]any)
		if binding["material"] != "cloth" || binding["coverArtId"] != "cover1" {
			t.Fatalf("binding %+v", binding)
		}
		round := out["rounds"].([]any)[0].(map[string]any)
		if round["startedAt"] != "2026-10-01" {
			t.Fatalf("round %+v", round)
		}
		session := out["sessions"].([]any)[0].(map[string]any)
		if session["durationMs"] != float64(60000) {
			t.Fatalf("session %+v", session)
		}
	}
	deleted := map[string]any{"bookmarks": []any{map[string]any{"id": "mark1", "deleted": true, "updatedAt": "2026-10-02T12:00:00Z"}}}
	if status, out := request("POST", "/sync/push", one, deleted); status != 200 || out["applied"] != float64(1) {
		t.Fatalf("delete %d %+v", status, out)
	}
	if status, out := request("GET", "/sync/pull", one, nil); status != 200 || out["bookmarks"].([]any)[0].(map[string]any)["deleted"] != true {
		t.Fatalf("tombstone %d %+v", status, out)
	}
	if status, out := request("GET", "/books/9790000000018", "", nil); status != 200 || out["thicknessClass"] != "thin" {
		t.Fatalf("mock book %d %+v", status, out)
	}
	if status, out := request("POST", "/auth/kakao/start", one, map[string]string{"returnUrl": "chaekjang://auth/kakao"}); status != http.StatusServiceUnavailable || out["error"].(map[string]any)["code"] != "not_configured" {
		t.Fatalf("kakao %d %+v", status, out)
	}
}
