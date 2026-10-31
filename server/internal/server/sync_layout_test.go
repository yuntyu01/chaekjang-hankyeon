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
	"strings"
	"testing"
)

func TestLayoutSync(t *testing.T) {
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
	at := "2026-10-01T12:00:00Z"
	books := []any{}
	for _, id := range []string{"b1", "b2", "b3"} {
		books = append(books, map[string]any{"id": id, "editionId": "ed1", "status": "want", "updatedAt": at})
	}
	lib := map[string]any{"editions": []any{map[string]any{"id": "ed1", "title": "Book", "source": "manual", "updatedAt": at}}, "books": books}
	if status, out := request("POST", "/sync/push", token, lib); status != 200 || out["applied"] != float64(4) {
		t.Fatalf("library push %d %+v", status, out)
	}

	// 새 앱: 표 모양. 같은 책 두 번·없는 선반·서버에 없는 책·서랍에 또 나온 책은 버린다
	layout := map[string]any{
		"version": 2, "updatedAt": "2026-10-01T12:00:01Z",
		"shelves": []any{map[string]any{"id": "s2", "order": 1}, map[string]any{"id": "s1", "order": 0}},
		"placements": []any{
			map[string]any{"bookId": "b2", "shelfId": "s2", "order": 0, "pose": "spine", "tilt": 0},
			map[string]any{"bookId": "b1", "shelfId": "s1", "order": 2, "pose": "horizontal", "tilt": 7, "stackId": "st", "stackOrder": 1, "pos": 12.5, "lean": map[string]any{"angle": 3.5, "on": "b2", "slide": 0.75}, "pitch": -2, "wallLean": true, "flip": true, "overhang": true},
			map[string]any{"bookId": "b1", "shelfId": "s2", "order": 5, "pose": "spine", "tilt": 0},
			map[string]any{"bookId": "b3", "shelfId": "gone", "order": 0, "pose": "spine", "tilt": 0},
			map[string]any{"bookId": "ghost", "shelfId": "s1", "order": 0, "pose": "front", "tilt": 0},
		},
		"drawer": []any{"b3", "b1"},
	}
	layout["layoutJson"] = "ignored when table shape is present"
	if status, out := request("POST", "/sync/push", token, map[string]any{"layout": layout}); status != 200 || out["applied"] != float64(1) {
		t.Fatalf("layout push %d %+v", status, out)
	}
	_, out := request("GET", "/sync/pull", token, nil)
	got := out["layout"].(map[string]any)
	wantShelves := []any{map[string]any{"id": "s1", "order": float64(0)}, map[string]any{"id": "s2", "order": float64(1)}}
	wantPlacements := []any{
		map[string]any{"bookId": "b1", "shelfId": "s1", "order": float64(2), "pose": "horizontal", "tilt": float64(7), "stackId": "st", "stackOrder": float64(1), "pos": 12.5, "lean": map[string]any{"angle": 3.5, "on": "b2", "slide": 0.75}, "pitch": float64(-2), "wallLean": true, "flip": true, "overhang": true},
		map[string]any{"bookId": "b2", "shelfId": "s2", "order": float64(0), "pose": "spine", "tilt": float64(0)},
	}
	if !reflect.DeepEqual(got["shelves"], wantShelves) || !reflect.DeepEqual(got["placements"], wantPlacements) || !reflect.DeepEqual(got["drawer"], []any{"b3"}) {
		t.Fatalf("layout tables %+v", got)
	}
	// 예전 앱용 layoutJson: 같은 내용, version이 첫 키
	raw := got["layoutJson"].(string)
	var fromJSON map[string]any
	if !strings.HasPrefix(raw, `{"version":2,`) || json.Unmarshal([]byte(raw), &fromJSON) != nil || !reflect.DeepEqual(fromJSON["placements"], wantPlacements) || !reflect.DeepEqual(fromJSON["drawer"], []any{"b3"}) {
		t.Fatalf("layoutJson %s", raw)
	}
	rev := int(out["rev"].(float64))
	if _, out := request("GET", fmt.Sprintf("/sync/pull?since=%d", rev), token, nil); out["layout"] != nil {
		t.Fatalf("unchanged layout pulled again %+v", out["layout"])
	}

	// 예전 앱: layoutJson만 보낸다. 통째로 바뀐다
	old := map[string]any{"version": 2, "updatedAt": "2026-10-01T12:00:02Z", "layoutJson": `{"version":2,"shelves":[{"id":"only","order":0,"x":1}],"placements":[{"bookId":"b3","shelfId":"only","order":0,"pose":"front","tilt":-7,"x":0.4}],"drawer":["b1","b2"]}`}
	if status, out := request("POST", "/sync/push", token, map[string]any{"layout": old}); status != 200 || out["applied"] != float64(1) {
		t.Fatalf("old app push %d %+v", status, out)
	}
	_, out = request("GET", "/sync/pull", token, nil)
	got = out["layout"].(map[string]any)
	if len(got["shelves"].([]any)) != 1 || !reflect.DeepEqual(got["placements"], []any{map[string]any{"bookId": "b3", "shelfId": "only", "order": float64(0), "pose": "front", "tilt": float64(-7)}}) || !reflect.DeepEqual(got["drawer"], []any{"b1", "b2"}) {
		t.Fatalf("old app layout %+v", got)
	}

	// 더 오래된 배치는 건너뛴다
	stale := map[string]any{"version": 2, "updatedAt": "2026-09-01T00:00:00Z", "shelves": []any{}, "placements": []any{}, "drawer": []any{}}
	if status, out := request("POST", "/sync/push", token, map[string]any{"layout": stale}); status != 200 || out["skipped"].([]any)[0] != "layout" {
		t.Fatalf("stale layout %d %+v", status, out)
	}
	for name, l := range map[string]map[string]any{
		"pose":     {"updatedAt": "2026-10-02T00:00:00Z", "shelves": []any{map[string]any{"id": "s"}}, "placements": []any{map[string]any{"bookId": "b1", "shelfId": "s", "pose": "upside"}}},
		"shelf id": {"updatedAt": "2026-10-02T00:00:00Z", "shelves": []any{map[string]any{"id": ""}}},
		"no body":  {"updatedAt": "2026-10-02T00:00:00Z"},
		"time":     {"updatedAt": "yesterday", "shelves": []any{}},
	} {
		if status, _ := request("POST", "/sync/push", token, map[string]any{"layout": l}); status != 400 {
			t.Fatalf("%s: want 400, got %d", name, status)
		}
	}
	many := make([]any, maxLayoutRows+1)
	for i := range many {
		many[i] = fmt.Sprintf("d%d", i)
	}
	if status, _ := request("POST", "/sync/push", token, map[string]any{"layout": map[string]any{"updatedAt": "2026-10-02T00:00:00Z", "drawer": many}}); status != 400 {
		t.Fatalf("too many rows: %d", status)
	}
	// 거부된 올리기는 아무것도 바꾸지 않는다
	if _, out := request("GET", "/sync/pull", token, nil); len(out["layout"].(map[string]any)["drawer"].([]any)) != 2 {
		t.Fatalf("rejected push changed layout %+v", out["layout"])
	}
}

// Flyway V1~V7(예전 Java 서버) DB에 V8을 적용하면 JSON 배치가 표로 옮겨지고 계산 열이 빠진다.
func TestFlywayV7UpgradesLayout(t *testing.T) {
	dsn := os.Getenv("TEST_EMPTY_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_EMPTY_DATABASE_URL to an empty disposable PostgreSQL database")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, err := migrationFiles()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "CREATE TABLE flyway_schema_history (installed_rank int PRIMARY KEY, version varchar(50), description varchar(200), success boolean NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	for _, m := range files[:flywayBase] {
		data, _ := migrations.ReadFile("migrations/" + m.name)
		if _, err = db.Exec(ctx, string(data)); err != nil {
			t.Fatalf("%s: %v", m.name, err)
		}
		if _, err = db.Exec(ctx, "INSERT INTO flyway_schema_history VALUES ($1,$2,$3,true)", m.version, fmt.Sprint(m.version), m.name); err != nil {
			t.Fatal(err)
		}
	}
	var user int64
	if err = db.QueryRow(ctx, "INSERT INTO users DEFAULT VALUES RETURNING id").Scan(&user); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO editions(user_id,id,title,source,created_at,updated_at,rev) VALUES($1,'e','T','manual',now(),now(),1)`, user); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b", "c"} {
		if _, err = db.Exec(ctx, `INSERT INTO my_books(user_id,id,edition_id,status,created_at,updated_at,rev) VALUES($1,$2,'e','want',now(),now(),1)`, user, id); err != nil {
			t.Fatal(err)
		}
	}
	saved := `{"version":2,"shelves":[{"id":"s1","order":0},{"id":"s2"}],
		"placements":[{"bookId":"a","shelfId":"s1","order":1,"pose":"spine","tilt":-7,"pos":3.25,"lean":{"angle":4,"on":"b","slide":1.5},"flip":true,"x":0.2},
			{"bookId":"a","shelfId":"s2","order":0,"pose":"spine","tilt":0},
			{"bookId":"ghost","shelfId":"s1","order":0,"pose":"spine","tilt":0},
			{"bookId":"b","shelfId":"nowhere","order":0,"pose":"spine","tilt":0}],
		"drawer":["c","a","ghost"]}`
	if _, err = db.Exec(ctx, `INSERT INTO shelf_layouts(user_id,layout,version,client_updated_at,rev) VALUES($1,$2::jsonb,2,'2026-10-01T00:00:00Z',5)`, user, saved); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, `INSERT INTO books(isbn13,title,page_count,format,theme_color,height_class,thickness_class,default_motif_id,source) VALUES('9790000000049','Q',460,'152*225mm','#000','medium','thick','leaf','mock')`); err != nil {
		t.Fatal(err)
	}

	if err = Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	var versions []int32
	if err = db.QueryRow(ctx, "SELECT array_agg(version ORDER BY version) FROM go_schema_history").Scan(&versions); err != nil || !reflect.DeepEqual(versions, []int32{8}) {
		t.Fatalf("go history %v %v", versions, err)
	}
	var shelves string
	if err = db.QueryRow(ctx, "SELECT string_agg(id||':'||position, ',' ORDER BY position) FROM shelves WHERE user_id=$1", user).Scan(&shelves); err != nil || shelves != "s1:0,s2:1" {
		t.Fatalf("shelves %q %v", shelves, err)
	}
	var placements string
	if err = db.QueryRow(ctx, `SELECT string_agg(concat_ws('|', book_id, coalesce(shelf_id,'-'), position, coalesce(pose,'-'), coalesce(tilt::text,'-'), coalesce(pos::text,'-'), coalesce(lean_angle::text,'-'), coalesce(lean_on,'-'), coalesce(lean_slide::text,'-'), flip, overhang), ',' ORDER BY shelf_id NULLS LAST, position)
		FROM shelf_placements WHERE user_id=$1`, user).Scan(&placements); err != nil || placements != "a|s1|1|spine|-7|3.25|4|b|1.5|t|f,c|-|0|-|-|-|-|-|-|f|f" {
		t.Fatalf("placements %q %v", placements, err)
	}
	var gone bool
	if err = db.QueryRow(ctx, `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='shelf_layouts' AND column_name='layout')
		AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='books' AND column_name IN ('height_class','thickness_class','default_motif_id'))`).Scan(&gone); err != nil || !gone {
		t.Fatalf("computed columns still stored: %v", err)
	}
	t.Setenv("KAKAO_REST_KEY", "")
	t.Setenv("BOOKS_CACHE_TTL", "1000h")
	w := httptest.NewRecorder()
	New(db).Handler().ServeHTTP(w, httptest.NewRequest("GET", "/books/9790000000049", nil))
	var b map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	if w.Code != 200 || b["heightClass"] != "medium" || b["thicknessClass"] != "thick" || b["defaultMotifId"] != motifs[int(hashISBN("9790000000049")%uint32(len(motifs)))] {
		t.Fatalf("cached book classes %d %+v", w.Code, b)
	}
}

func TestBookClasses(t *testing.T) {
	for format, want := range map[string]string{"": "medium", "128*188mm": "short", "188x128": "short", "152 × 225": "medium", "A5": "medium", "신국판 B5": "tall", "A6 문고": "short", "234*300": "tall"} {
		if got := heightFromFormat(format); got != want {
			t.Errorf("height %q = %s, want %s", format, got, want)
		}
	}
	for pages, want := range map[int]string{0: "medium", 1: "thin", 219: "thin", 220: "medium", 419: "medium", 420: "thick"} {
		if got := thicknessFromPages(pages); got != want {
			t.Errorf("thickness %d = %s, want %s", pages, got, want)
		}
	}
}
