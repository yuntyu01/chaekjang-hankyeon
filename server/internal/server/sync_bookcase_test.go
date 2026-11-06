package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"
)

func TestBookcaseSync(t *testing.T) {
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
	request := func(method, path, token string, body any) (int, map[string]any) {
		t.Helper()
		data, _ := json.Marshal(body)
		if body == nil {
			data = nil
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	_, acc := request("POST", "/auth/device", "", nil)
	token := acc["token"].(string)
	at := "2026-12-20T12:00:00Z"
	book := func(id string, extra map[string]any) map[string]any {
		m := map[string]any{"id": id, "editionId": "ed1", "status": "read", "bindingId": "bd-" + id, "updatedAt": at}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	binding := func(id, bookID, color string) map[string]any {
		return map[string]any{"id": id, "myBookId": bookID, "spineColor": color, "motif": "none", "source": "default", "status": "ready", "updatedAt": at}
	}
	lib := map[string]any{
		"editions": []any{map[string]any{"id": "ed1", "title": "Book", "source": "manual", "updatedAt": at}},
		"books":    []any{book("b1", nil), book("b2", nil)},
		"bindings": []any{binding("bd-b1", "b1", "#111111"), binding("bd-b2", "b2", "#222222"), binding("bc-2026-b1", "b1", "#999999")},
	}
	if status, out := request("POST", "/sync/push", token, lib); status != 200 || out["applied"] != float64(6) {
		t.Fatalf("library push %d %+v", status, out)
	}
	_, out := request("GET", "/sync/pull", token, nil)
	before := int(out["rev"].(float64))

	// 책 목록에 없는 책(ghost)의 자리는 버리고, 같은 책은 한 번만 남긴다
	bookcase := map[string]any{
		"id": "bc-2026", "year": 2026, "createdAt": "2027-01-01T00:00:05Z", "updatedAt": "2027-01-01T00:00:05Z",
		"shelves": []any{map[string]any{"id": "s1", "order": 0}, map[string]any{"id": "s2", "order": 1}},
		"placements": []any{
			map[string]any{"bookId": "b1", "shelfId": "s2", "order": 1, "pose": "spine", "tilt": 7, "lean": map[string]any{"angle": 4.5, "on": "#wall-r"}},
			map[string]any{"bookId": "ghost", "shelfId": "s1", "order": 0, "pose": "front", "tilt": 0},
		},
		"drawer": []any{"b2", "ghost"},
		"books": []any{
			map[string]any{"bookId": "b1", "bindingId": "bc-2026-b1", "status": "read", "rating": 5, "note": "한 줄 감상", "ribbonColor": "#7B4497", "currentPage": 320},
			map[string]any{"bookId": "b2", "bindingId": "bd-b2", "status": "reading", "rating": 9, "currentPage": -3},
			map[string]any{"bookId": "b1", "status": "want"},
		},
	}
	if status, out := request("POST", "/sync/push", token, map[string]any{"bookcases": []any{bookcase}}); status != 200 || out["applied"] != float64(1) {
		t.Fatalf("bookcase push %d %+v", status, out)
	}
	_, out = request("GET", fmt.Sprintf("/sync/pull?since=%d", before), token, nil)
	list := out["bookcases"].([]any)
	if len(list) != 1 {
		t.Fatalf("bookcases %+v", out["bookcases"])
	}
	got := list[0].(map[string]any)
	want := map[string]any{
		"id": "bc-2026", "year": float64(2026), "createdAt": "2027-01-01T00:00:05Z", "updatedAt": "2027-01-01T00:00:05Z",
		"shelves":    []any{map[string]any{"id": "s1", "order": float64(0)}, map[string]any{"id": "s2", "order": float64(1)}},
		"placements": []any{map[string]any{"bookId": "b1", "shelfId": "s2", "order": float64(1), "pose": "spine", "tilt": float64(7), "lean": map[string]any{"angle": 4.5, "on": "#wall-r"}}},
		"drawer":     []any{"b2"},
		"books": []any{
			map[string]any{"bookId": "b1", "bindingId": "bc-2026-b1", "status": "read", "rating": float64(5), "note": "한 줄 감상", "ribbonColor": "#7B4497", "currentPage": float64(320)},
			map[string]any{"bookId": "b2", "bindingId": "bd-b2", "status": "reading"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("bookcase pulled\n got %+v\nwant %+v", got, want)
	}
	rev := int(out["rev"].(float64))
	if rev <= before {
		t.Fatalf("rev did not move: %d <= %d", rev, before)
	}
	if _, out := request("GET", fmt.Sprintf("/sync/pull?since=%d", rev), token, nil); len(out["bookcases"].([]any)) != 0 {
		t.Fatalf("unchanged bookcase pulled again %+v", out["bookcases"])
	}

	// 처음 올린 것이 남는다: 같은 id, 같은 해 다른 id 모두 건너뛴다
	again := map[string]any{"id": "bc-2026", "year": 2026, "createdAt": "2027-01-02T00:00:00Z", "updatedAt": "2027-01-02T00:00:00Z", "shelves": []any{}, "books": []any{}}
	other := map[string]any{"id": "other-2026", "year": 2026, "createdAt": "2027-01-02T00:00:00Z", "updatedAt": "2027-01-02T00:00:00Z", "shelves": []any{}, "books": []any{}}
	if status, out := request("POST", "/sync/push", token, map[string]any{"bookcases": []any{again, other}}); status != 200 || out["applied"] != float64(0) || !reflect.DeepEqual(out["skipped"], []any{"bookcases:bc-2026", "bookcases:other-2026"}) {
		t.Fatalf("second bookcase %d %+v", status, out)
	}

	// 서버에 없는 책·장정을 가리키면 missing_reference(앱이 서재 전체를 다시 올린다). 아무것도 남지 않는다
	for name, b := range map[string]map[string]any{
		"book":    {"bookId": "nope", "status": "read"},
		"binding": {"bookId": "b1", "bindingId": "nope", "status": "read"},
	} {
		c := map[string]any{"id": "bc-2025", "year": 2025, "createdAt": at, "updatedAt": at, "books": []any{b}}
		if status, out := request("POST", "/sync/push", token, map[string]any{"bookcases": []any{c}}); status != 409 || out["error"].(map[string]any)["code"] != "missing_reference" {
			t.Fatalf("%s: want missing_reference, got %d %+v", name, status, out)
		}
	}
	var n int
	if err = db.QueryRow(ctx, "SELECT count(*) FROM bookcases WHERE year=2025").Scan(&n); err != nil || n != 0 {
		t.Fatalf("failed push left a bookcase: %d %v", n, err)
	}
	for name, c := range map[string]map[string]any{
		"year":   {"id": "x", "year": 1999, "createdAt": at, "updatedAt": at},
		"id":     {"id": "", "year": 2024, "createdAt": at, "updatedAt": at},
		"time":   {"id": "x", "year": 2024, "createdAt": "어제", "updatedAt": at},
		"status": {"id": "x", "year": 2024, "createdAt": at, "updatedAt": at, "books": []any{map[string]any{"bookId": "b1", "status": "lost"}}},
		"pose":   {"id": "x", "year": 2024, "createdAt": at, "updatedAt": at, "shelves": []any{map[string]any{"id": "s"}}, "books": []any{map[string]any{"bookId": "b1", "status": "read"}}, "placements": []any{map[string]any{"bookId": "b1", "shelfId": "s", "pose": "upside"}}},
	} {
		if status, _ := request("POST", "/sync/push", token, map[string]any{"bookcases": []any{c}}); status != 400 {
			t.Fatalf("%s: want 400, got %d", name, status)
		}
	}

	// 숨긴 책: hiddenAt이 그대로 오가고, 비우면 다시 보인다
	hidden := book("b1", map[string]any{"hiddenAt": "2027-01-03T09:00:00Z", "updatedAt": "2027-01-03T09:00:00Z"})
	if status, out := request("POST", "/sync/push", token, map[string]any{"books": []any{hidden}}); status != 200 || out["applied"] != float64(1) {
		t.Fatalf("hide push %d %+v", status, out)
	}
	_, out = request("GET", fmt.Sprintf("/sync/pull?since=%d", rev), token, nil)
	books := out["books"].([]any)
	if len(books) != 1 || books[0].(map[string]any)["hiddenAt"] == nil {
		t.Fatalf("hidden book %+v", books)
	}

	// 계정을 지우면 연도 책장도 함께 지워진다(내 책 외래키가 막지 않는다)
	if _, err = db.Exec(ctx, "DELETE FROM users WHERE id=(SELECT user_id FROM bookcases WHERE id='bc-2026')"); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if err = db.QueryRow(ctx, "SELECT (SELECT count(*) FROM bookcases)+(SELECT count(*) FROM bookcase_books)+(SELECT count(*) FROM bookcase_placements)+(SELECT count(*) FROM bookcase_shelves)").Scan(&n); err != nil || n != 0 {
		t.Fatalf("bookcase rows left after account delete: %d %v", n, err)
	}
}
