package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAccountDeletion(t *testing.T) {
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
	root := t.TempDir()
	t.Setenv("FILE_DIR", root)
	t.Setenv("S3_BUCKET", "")
	t.Setenv("KAKAO_ADMIN_KEY", "admin-test")
	t.Setenv("KAKAO_APP_ID", "1234")
	s := New(db)
	if err = s.InitializeDeletion(ctx); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	req := func(method, path, token string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var b []byte
		switch v := body.(type) {
		case []byte:
			b = v
		default:
			b, _ = json.Marshal(body)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if method == "PUT" {
			r.Header.Set("Content-Type", "image/png")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	account := func() (int64, string) {
		w := req("POST", "/auth/device", "", nil)
		if w.Code != 201 {
			t.Fatal(w.Body)
		}
		var v struct {
			UserID int64  `json:"userId"`
			Token  string `json:"token"`
		}
		if err = json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v.UserID, v.Token
	}
	user, token := account()
	other, otherToken := account()
	predecessor, _ := account()
	switchTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = recordSwitch(ctx, switchTx, predecessor, user); err != nil {
		t.Fatal(err)
	}
	if err = switchTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var created time.Time
	if err = db.QueryRow(ctx, "SELECT created_at FROM users WHERE id=$1", user).Scan(&created); err != nil {
		t.Fatal(err)
	}
	if w := req("PUT", "/files/a.png", token, []byte("image")); w.Code != 204 {
		t.Fatalf("put %d %s", w.Code, w.Body)
	}
	if w := req("PUT", "/files/b.png", otherToken, []byte("other")); w.Code != 204 {
		t.Fatalf("other put %d", w.Code)
	}
	orphan := filepath.Join(root, fmt.Sprint(user), "orphan.png")
	if err = os.WriteFile(orphan, []byte("orphan"), 0600); err != nil {
		t.Fatal(err)
	}
	if w := req("DELETE", "/me", token, map[string]string{"confirmation": "bad"}); w.Code != 400 {
		t.Fatalf("bad confirmation %d", w.Code)
	}
	if w := req("DELETE", "/me", token, map[string]string{"confirmation": "DELETE"}); w.Code != 202 {
		t.Fatalf("delete %d %s", w.Code, w.Body)
	}
	if w := req("GET", "/me", token, nil); w.Code != 401 {
		t.Fatalf("deleted token accepted %d", w.Code)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = s.processDeletionJobs(ctx)
		var n int
		if err = db.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", user).Scan(&n); err != nil {
			t.Fatal(err)
		}
		_, e1 := os.Stat(orphan)
		_, e2 := os.Stat(filepath.Join(root, fmt.Sprint(user), "a.png"))
		if n == 0 && os.IsNotExist(e1) && os.IsNotExist(e2) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	var n int
	if err = db.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", user).Scan(&n); err != nil || n != 0 {
		t.Fatalf("user remains: %d %v", n, err)
	}
	if err = db.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", predecessor).Scan(&n); err != nil || n != 0 {
		t.Fatalf("predecessor remains: %d %v", n, err)
	}
	if _, err = os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("orphan remains: %v", err)
	}
	if _, err = os.Stat(filepath.Join(root, fmt.Sprint(other), "b.png")); err != nil {
		t.Fatalf("other account image removed: %v", err)
	}
	if w := req("DELETE", "/me", token, map[string]string{"confirmation": "DELETE"}); w.Code != 202 {
		t.Fatalf("retry receipt %d", w.Code)
	}
	// A retry routed to an instance that has not cached the journal still confirms the receipt.
	otherInstance := New(db)
	retry := httptest.NewRequest("DELETE", "/me", stringsReader(`{"confirmation":"DELETE"}`))
	retry.Header.Set("Authorization", "Bearer "+token)
	retryResult := httptest.NewRecorder()
	otherInstance.Handler().ServeHTTP(retryResult, retry)
	if retryResult.Code != 202 {
		t.Fatalf("cross-instance receipt %d", retryResult.Code)
	}
	// 같은 사용자의 과거 DB 백업을 복원하면 독립 저널이 다시 삭제한다.
	if _, err = db.Exec(ctx, "INSERT INTO users(id,created_at,last_seen_at) VALUES($1,$2,now())", user, created); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, "INSERT INTO api_tokens(token_hash,user_id) VALUES($1,$2)", hash(token), user); err != nil {
		t.Fatal(err)
	}
	s2 := New(db)
	if err = s2.InitializeDeletion(ctx); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(ctx, "SELECT count(*) FROM users WHERE id=$1", user).Scan(&n); err != nil || n != 0 {
		t.Fatalf("restored account remains: %d %v", n, err)
	}
	if w := req("POST", "/auth/kakao/unlink?app_id=1234&user_id=123", "", nil); w.Code != 401 {
		t.Fatalf("forged webhook %d", w.Code)
	}
	subject := fmt.Sprintf("%d", time.Now().UnixNano())
	if _, err = db.Exec(ctx, "INSERT INTO auth_identities(provider,subject,user_id) VALUES('kakao',$1,$2)", subject, other); err != nil {
		t.Fatal(err)
	}
	webhook := httptest.NewRequest("POST", "/auth/kakao/unlink?app_id=1234&user_id="+subject, nil)
	webhook.Header.Set("Authorization", "KakaoAK admin-test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, webhook)
	if w.Code != 200 {
		t.Fatalf("verified webhook %d", w.Code)
	}
	if w := req("GET", "/me", otherToken, nil); w.Code != 200 {
		t.Fatalf("unlink deleted account: %d", w.Code)
	}
	if err = db.QueryRow(ctx, "SELECT count(*) FROM auth_identities WHERE provider='kakao' AND subject=$1", subject).Scan(&n); err != nil || n != 0 {
		t.Fatalf("identity remains: %d %v", n, err)
	}
}

func TestDeletionWaitsForInflightUpload(t *testing.T) {
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
	root := t.TempDir()
	t.Setenv("FILE_DIR", root)
	t.Setenv("S3_BUCKET", "")
	s := New(db)
	if err = s.InitializeDeletion(ctx); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/auth/device", nil))
	var account struct {
		UserID int64  `json:"userId"`
		Token  string `json:"token"`
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
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR KEY SHARE", account.UserID).Scan(&locked); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("DELETE", "/me", stringsReader(`{"confirmation":"DELETE"}`))
	r.Header.Set("Authorization", "Bearer "+account.Token)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { result := httptest.NewRecorder(); h.ServeHTTP(result, r); done <- result }()
	select {
	case result := <-done:
		t.Fatalf("delete did not wait for upload: %d", result.Code)
	case <-time.After(100 * time.Millisecond):
	}
	key := fmt.Sprintf("%d/late.png", account.UserID)
	path := filepath.Join(root, key)
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("late"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO files(user_id,id,content_type,size_bytes,sha256,storage_key) VALUES($1,'late','image/png',4,'x',$2)", account.UserID, key); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-done:
		if result.Code != 202 {
			t.Fatalf("delete %d %s", result.Code, result.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("deletion did not complete")
	}
	if err = s.processDeletionJobs(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("inflight file remains %v", err)
	}
}
func stringsReader(s string) *bytes.Reader { return bytes.NewReader([]byte(s)) }

func TestAccountSwitchCannotRaceDeletion(t *testing.T) {
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
	s := New(db)
	h := s.Handler()
	makeAccount := func() int64 {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/auth/device", nil))
		var a struct {
			ID int64 `json:"userId"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &a); e != nil || w.Code != 201 {
			t.Fatalf("account %d %v", w.Code, e)
		}
		return a.ID
	}
	target, source := makeAccount(), makeAccount()
	deletion, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer deletion.Rollback(ctx)
	var id int64
	if err = deletion.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", target).Scan(&id); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		tx, e := db.Begin(ctx)
		if e != nil {
			done <- e
			return
		}
		defer tx.Rollback(ctx)
		e = recordSwitch(ctx, tx, source, target)
		if e == nil {
			e = tx.Commit(ctx)
		}
		done <- e
	}()
	select {
	case e := <-done:
		t.Fatalf("account switch did not wait for deletion: %v", e)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err = deletion.Exec(ctx, "DELETE FROM api_tokens WHERE user_id=$1", target); err != nil {
		t.Fatal(err)
	}
	if err = deletion.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-done:
		var problem apiError
		if !errors.As(e, &problem) || problem.code != "account_unavailable" {
			t.Fatalf("expected unavailable account: %v", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("account switch did not finish")
	}
	var count int
	if err = db.QueryRow(ctx, "SELECT count(*) FROM account_predecessors WHERE source_id=$1", source).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected predecessor: %d %v", count, err)
	}
}

func TestFailedKakaoDisconnectRemainsQueued(t *testing.T) {
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
	t.Setenv("FILE_DIR", t.TempDir())
	t.Setenv("S3_BUCKET", "")
	t.Setenv("KAKAO_ADMIN_KEY", "")
	subject := fmt.Sprint(time.Now().UnixNano())
	if _, err = db.Exec(ctx, "INSERT INTO kakao_disconnect_jobs(subject,account_id,requested_at) VALUES($1,1,now()-interval '8 days')", subject); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, "DELETE FROM kakao_disconnect_jobs WHERE subject=$1", subject)
	s := New(db)
	if err = s.InitializeDeletion(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.processDeletionJobs(ctx); err != nil {
		t.Fatal(err)
	}
	var attempts int
	if err = db.QueryRow(ctx, "SELECT attempts FROM kakao_disconnect_jobs WHERE subject=$1", subject).Scan(&attempts); err != nil || attempts < 1 {
		t.Fatalf("failed disconnect not retained: %d %v", attempts, err)
	}
}

func TestSimultaneousAccountSwitchOnlyLinksOneTarget(t *testing.T) {
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
	makeAccount := func() int64 {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/auth/device", nil))
		var a struct {
			ID int64 `json:"userId"`
		}
		if e := json.Unmarshal(w.Body.Bytes(), &a); e != nil || w.Code != 201 {
			t.Fatalf("account %d %v", w.Code, e)
		}
		return a.ID
	}
	source, first, second := makeAccount(), makeAccount(), makeAccount()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err = recordSwitch(ctx, tx, source, first); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		other, e := db.Begin(ctx)
		if e != nil {
			done <- e
			return
		}
		defer other.Rollback(ctx)
		e = recordSwitch(ctx, other, source, second)
		if e == nil {
			e = other.Commit(ctx)
		}
		done <- e
	}()
	select {
	case e := <-done:
		t.Fatalf("second switch did not wait: %v", e)
	case <-time.After(100 * time.Millisecond):
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-done:
		var problem apiError
		if !errors.As(e, &problem) || problem.code != "account_unavailable" {
			t.Fatalf("expected unavailable source: %v", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("second switch did not finish")
	}
	var target int64
	if err = db.QueryRow(ctx, "SELECT target_id FROM account_predecessors WHERE source_id=$1", source).Scan(&target); err != nil || target != first {
		t.Fatalf("wrong predecessor: %d %v", target, err)
	}
}
