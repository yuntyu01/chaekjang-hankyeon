package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 커뮤니티(공개 데이터) 권한·중복·차단·삭제·집계. TEST_DATABASE_URL(버려도 되는 DB)이 있을 때만
func TestCommunity(t *testing.T) {
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
	t.Setenv("ADMIN_TOKEN", "admin-secret")
	h := New(db).Handler()
	call := func(method, path, token string, body any, header ...string) (int, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		for i := 0; i+1 < len(header); i += 2 {
			req.Header.Set(header[i], header[i+1])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		out := map[string]any{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	type acct struct {
		token string
		id    int64
	}
	newUser := func(social bool) acct {
		code, out := call("POST", "/auth/device", "", nil)
		if code != 201 {
			t.Fatalf("device %d %v", code, out)
		}
		tok := out["token"].(string)
		id := int64(out["userId"].(float64))
		if social {
			if _, err := db.Exec(ctx, "INSERT INTO auth_identities(provider,subject,user_id) VALUES('google',$1,$2)", fmt.Sprintf("g-%d", id), id); err != nil {
				t.Fatal(err)
			}
		}
		return acct{tok, id}
	}
	errCode := func(out map[string]any) string {
		e, _ := out["error"].(map[string]any)
		s, _ := e["code"].(string)
		return s
	}

	a, b, c := newUser(true), newUser(true), newUser(false)
	// 소셜 연결 없으면 공개 프로필·게시 불가, 연결돼도 닉네임 없이는 게시 불가
	if code, out := call("PUT", "/community/profile", c.token, map[string]any{"nickname": "기기만"}); code != 403 || errCode(out) != "needs_social_account" {
		t.Fatalf("device-only profile %d %v", code, out)
	}
	if code, out := call("POST", "/community/posts", a.token, map[string]any{"clientId": "x", "bookTitle": "데미안"}); code != 403 || errCode(out) != "needs_profile" {
		t.Fatalf("post without profile %d %v", code, out)
	}
	if code, _ := call("PUT", "/community/profile", a.token, map[string]any{"nickname": "읽는사람"}); code != 200 {
		t.Fatalf("profile a %d", code)
	}
	if code, out := call("PUT", "/community/profile", b.token, map[string]any{"nickname": "읽는사람"}); code != 409 || errCode(out) != "nickname_taken" {
		t.Fatalf("dup nickname %d %v", code, out)
	}
	if code, _ := call("PUT", "/community/profile", b.token, map[string]any{"nickname": "책벌레", "bio": "  "}); code != 200 {
		t.Fatalf("profile b %d", code)
	}

	// 게시: 같은 clientId 재시도는 하나, 0·음수 숫자는 비움
	post := map[string]any{"clientId": "session-1", "isbn13": "9788937460449", "bookTitle": "데미안", "durationMs": 1500000, "pagesRead": 0, "quote": "새는 알에서 나오려고 투쟁한다", "body": "좋았다"}
	code, p1 := call("POST", "/community/posts", a.token, post)
	if code != 200 {
		t.Fatalf("post %d %v", code, p1)
	}
	_, p2 := call("POST", "/community/posts", a.token, post)
	if p1["id"] != p2["id"] || p1["pagesRead"] != nil || p1["durationMs"] != float64(1500000) {
		t.Fatalf("idempotent post %v %v", p1, p2)
	}
	pid := int64(p1["id"].(float64))
	// 피드: 발견에는 보이고, 팔로잉은 팔로우 전 비어 있다
	_, feed := call("GET", "/community/feed?scope=discover", b.token, nil)
	if n := len(feed["items"].([]any)); n != 1 {
		t.Fatalf("discover %v", feed)
	}
	_, feed = call("GET", "/community/feed?scope=following", b.token, nil)
	if n := len(feed["items"].([]any)); n != 0 {
		t.Fatalf("following before follow %v", feed)
	}
	if code, _ := call("PUT", fmt.Sprintf("/community/users/%d/follow", a.id), b.token, nil); code != 200 {
		t.Fatalf("follow %d", code)
	}
	_, feed = call("GET", "/community/feed?scope=following", b.token, nil)
	if n := len(feed["items"].([]any)); n != 1 {
		t.Fatalf("following after follow %v", feed)
	}
	// 좋아요(멱등)·댓글
	call("PUT", fmt.Sprintf("/community/posts/%d/like", pid), b.token, nil)
	_, liked := call("PUT", fmt.Sprintf("/community/posts/%d/like", pid), b.token, nil)
	if liked["likes"] != float64(1) || liked["liked"] != true {
		t.Fatalf("like %v", liked)
	}
	_, cm := call("POST", fmt.Sprintf("/community/posts/%d/comments", pid), b.token, map[string]any{"body": "저도요", "clientId": "c1"})
	call("POST", fmt.Sprintf("/community/posts/%d/comments", pid), b.token, map[string]any{"body": "저도요", "clientId": "c1"})
	if n := len(cm["items"].([]any)); n != 1 {
		t.Fatalf("comment %v", cm)
	}
	// 기기 계정만 있는 사람은 읽기만(좋아요는 소셜 필요)
	if code, _ := call("GET", fmt.Sprintf("/community/posts/%d", pid), c.token, nil); code != 200 {
		t.Fatalf("device read %d", code)
	}
	if code, out := call("PUT", fmt.Sprintf("/community/posts/%d/like", pid), c.token, nil); code != 403 {
		t.Fatalf("device like %d %v", code, out)
	}
	// 남의 게시물은 고치거나 지울 수 없다
	if code, _ := call("DELETE", fmt.Sprintf("/community/posts/%d", pid), b.token, nil); code != 404 {
		t.Fatalf("delete others %d", code)
	}

	// 별점·후기: 사용자당 하나(고치면 갱신), 평가 안 한 사람은 0점으로 세지 않는다
	call("PUT", "/community/books/9788937460449/review", a.token, map[string]any{"rating": 5})
	call("PUT", "/community/books/9788937460449/review", a.token, map[string]any{"rating": 4, "body": "다시 읽어도", "bookTitle": "데미안"})
	_, rv := call("PUT", "/community/books/9788937460449/review", b.token, map[string]any{"rating": 2})
	if rv["count"] != float64(2) || rv["average"] != float64(3) {
		t.Fatalf("reviews %v", rv)
	}
	if code, _ := call("PUT", "/community/books/9788937460449/review", b.token, map[string]any{"rating": 0}); code != 400 {
		t.Fatalf("zero rating %d", code)
	}
	_, rv = call("GET", "/community/books/9788937460449/reviews", c.token, nil)
	if rv["count"] != float64(2) || rv["mine"] != nil {
		t.Fatalf("reviews for reader %v", rv)
	}
	if _, pa := call("GET", fmt.Sprintf("/community/users/%d", a.id), c.token, nil); pa["reviews"].([]any)[0].(map[string]any)["bookTitle"] != "데미안" {
		t.Fatalf("review title %v", pa["reviews"])
	}

	// 차단: 서로의 게시물·댓글·후기가 보이지 않고 팔로우가 끊긴다
	if code, _ := call("PUT", fmt.Sprintf("/community/users/%d/block", b.id), a.token, nil); code != 200 {
		t.Fatalf("block %d", code)
	}
	_, feed = call("GET", "/community/feed", b.token, nil)
	if n := len(feed["items"].([]any)); n != 0 {
		t.Fatalf("blocked feed %v", feed)
	}
	if code, _ := call("GET", fmt.Sprintf("/community/posts/%d", pid), b.token, nil); code != 404 {
		t.Fatalf("blocked post %d", code)
	}
	_, cm = call("GET", fmt.Sprintf("/community/posts/%d/comments", pid), a.token, nil)
	if n := len(cm["items"].([]any)); n != 0 {
		t.Fatalf("blocked comments %v", cm)
	}
	_, rv = call("GET", "/community/books/9788937460449/reviews", a.token, nil)
	if rv["count"] != float64(1) {
		t.Fatalf("blocked reviews %v", rv)
	}
	_, pu := call("GET", fmt.Sprintf("/community/users/%d", a.id), a.token, nil)
	if pu["profile"].(map[string]any)["followers"] != float64(0) {
		t.Fatalf("block unfollows %v", pu)
	}
	_, bl := call("GET", "/community/blocks", a.token, nil)
	if items := bl["items"].([]any); len(items) != 1 || items[0].(map[string]any)["nickname"] != "책벌레" {
		t.Fatalf("block list %v", bl)
	}
	call("DELETE", fmt.Sprintf("/community/users/%d/block", b.id), a.token, nil)
	if _, bl = call("GET", "/community/blocks", a.token, nil); len(bl["items"].([]any)) != 0 {
		t.Fatalf("block list after unblock %v", bl)
	}

	// 신고 → 운영자 숨김: 피드·상세·집계에서 빠진다
	call("POST", "/community/reports", c.token, map[string]any{"kind": "post", "id": fmt.Sprint(pid), "reason": "시험"})
	if code, _ := call("GET", "/admin/reports", "", nil); code != 404 {
		t.Fatalf("admin without token %d", code)
	}
	_, reps := call("GET", "/admin/reports", "", nil, "X-Admin-Token", "admin-secret")
	items := reps["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("reports %v", reps)
	}
	rid := int64(items[0].(map[string]any)["id"].(float64))
	if code, _ := call("POST", fmt.Sprintf("/admin/reports/%d/resolve", rid), "", map[string]any{"action": "hide"}, "X-Admin-Token", "admin-secret"); code != 200 {
		t.Fatalf("resolve %d", code)
	}
	if code, _ := call("GET", fmt.Sprintf("/community/posts/%d", pid), b.token, nil); code != 404 {
		t.Fatalf("hidden post %d", code)
	}

	// 지운 게시물은 목록·상세·글쓴이 게시 수에서 빠진다
	_, p3 := call("POST", "/community/posts", a.token, map[string]any{"clientId": "session-2", "bookTitle": "모순"})
	pid3 := int64(p3["id"].(float64))
	if code, _ := call("DELETE", fmt.Sprintf("/community/posts/%d", pid3), a.token, nil); code != 200 {
		t.Fatalf("delete own %d", code)
	}
	_, feed = call("GET", "/community/feed", c.token, nil)
	if n := len(feed["items"].([]any)); n != 0 {
		t.Fatalf("feed after delete %v", feed)
	}
	_, pu = call("GET", fmt.Sprintf("/community/users/%d", a.id), c.token, nil)
	if pu["profile"].(map[string]any)["posts"] != float64(0) {
		t.Fatalf("post count after delete %v", pu)
	}
	// 개인 동기화 API로는 남의 기록을 볼 수 없다(토큰의 사용자 것만): 공개 API와 섞이지 않는다
	_, pull := call("GET", "/sync/pull", c.token, nil)
	if books, _ := pull["books"].([]any); len(books) != 0 {
		t.Fatalf("private pull leaked %v", pull)
	}
	_ = http.StatusOK
}
