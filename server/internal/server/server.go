package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/llm"
)

type Server struct {
	DB                *pgxpool.Pool
	HTTP              *http.Client
	LLM               *llm.Gateway
	ConfigError       error
	searchMu          sync.Mutex
	searchCache       map[string]searchEntry
	googleOnce        sync.Once
	googleVerifier    *oidc.IDTokenVerifier
	deletionMu        sync.RWMutex
	deletionRequestMu sync.Mutex
	deletionWorkMu    sync.Mutex
	deletions         map[string]deletionEntry
	deletionWake      chan struct{}
}
type apiError struct {
	status        int
	code, message string
}

func (e apiError) Error() string { return e.message }

var bad = apiError{400, "bad_request", "요청 형식이 올바르지 않아요"}
var unauthorized = apiError{401, "unauthorized", "로그인이 필요해요"}
var notFound = apiError{404, "not_found", "찾을 수 없어요"}
var upstream = apiError{502, "upstream_error", "외부 서비스 응답이 없어요"}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, err error) {
	var ae apiError
	if !errors.As(err, &ae) {
		var pe *pgconn.PgError
		switch {
		case errors.As(err, &pe) && pe.Code == "23503":
			ae = apiError{409, "missing_reference", "참조하는 항목이 서버에 아직 없어요"}
		case errors.As(err, &pe) && (strings.HasPrefix(pe.Code, "23") || strings.HasPrefix(pe.Code, "22")):
			ae = bad
		case errors.Is(err, pgx.ErrNoRows):
			ae = notFound
		default:
			log.Printf("request failed: %v", err)
			ae = apiError{500, "internal_error", "서버 오류가 발생했어요"}
		}
	}
	writeJSON(w, ae.status, map[string]any{"error": map[string]string{"code": ae.code, "message": ae.message}})
}

type handler func(http.ResponseWriter, *http.Request) error

func wrap(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			fail(w, err)
		}
	}
}
func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 16<<20))
	if err := dec.Decode(v); err != nil {
		return bad
	}
	return nil
}
func hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func random(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func (s *Server) auth(ctx context.Context, header string) (int64, error) {
	if !strings.HasPrefix(header, "Bearer ") {
		return 0, unauthorized
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || len(token) > 200 {
		return 0, unauthorized
	}
	var user int64
	var created time.Time
	var stale bool
	err := s.DB.QueryRow(ctx, "SELECT u.id,u.created_at,t.last_used_at < now()-interval '1 hour' FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1", hash(token)).Scan(&user, &created, &stale)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, unauthorized
	}
	if err != nil {
		return 0, err
	}
	if s.deletionBlocked(user, created) {
		return 0, unauthorized
	}
	// 요청마다 쓰지 않게 마지막 사용 시각은 한 시간에 한 번만 고친다(그 사이 요청은 위의 읽기 한 번)
	if !stale {
		return user, nil
	}
	tag, err := s.DB.Exec(ctx, "UPDATE api_tokens SET last_used_at=now() WHERE token_hash=$1", hash(token))
	if err == nil && tag.RowsAffected() == 0 {
		return 0, unauthorized
	}
	return user, err
}
func (s *Server) user(r *http.Request) (int64, error) {
	return s.auth(r.Context(), r.Header.Get("Authorization"))
}
func issueToken(ctx context.Context, tx pgx.Tx, user int64) (string, error) {
	v, err := random(32)
	if err != nil {
		return "", err
	}
	token := "ck_" + v
	_, err = tx.Exec(ctx, "INSERT INTO api_tokens (token_hash,user_id) VALUES ($1,$2)", hash(token), user)
	return token, err
}
func (s *Server) device(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var user int64
	if err = tx.QueryRow(ctx, "INSERT INTO users DEFAULT VALUES RETURNING id").Scan(&user); err != nil {
		return err
	}
	token, err := issueToken(ctx, tx, user)
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"userId": user, "token": token})
	return nil
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var kakao, google bool
	var nick string
	err = s.DB.QueryRow(r.Context(), "SELECT EXISTS (SELECT 1 FROM auth_identities WHERE provider='kakao' AND user_id=$1), EXISTS (SELECT 1 FROM auth_identities WHERE provider='google' AND user_id=$1), COALESCE(nickname,'') FROM users WHERE id=$1", user).Scan(&kakao, &google, &nick)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"userId": user, "kakao": kakao, "google": google, "nickname": nick})
	return nil
}
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", wrap(s.health))
	m.HandleFunc("POST /auth/device", wrap(s.device))
	m.HandleFunc("GET /auth/providers", wrap(s.providers))
	m.HandleFunc("POST /auth/google/start", wrap(s.googleStart))
	m.HandleFunc("GET /auth/google/callback", wrap(s.googleCallback))
	m.HandleFunc("POST /auth/google/claim", wrap(s.googleClaim))
	m.HandleFunc("GET /me", wrap(s.me))
	m.HandleFunc("DELETE /me", wrap(s.deleteAccount))
	m.HandleFunc("GET /auth/kakao/unlink", wrap(s.kakaoUnlink))
	m.HandleFunc("POST /auth/kakao/unlink", wrap(s.kakaoUnlink))
	m.HandleFunc("POST /sync/push", wrap(s.push))
	m.HandleFunc("GET /sync/pull", wrap(s.pull))
	m.HandleFunc("PUT /files/{id}", wrap(s.putFile))
	m.HandleFunc("GET /files/{id}", wrap(s.getFile))
	m.HandleFunc("GET /books/search", wrap(s.search))
	m.HandleFunc("GET /books/{isbn}", wrap(s.book))
	m.HandleFunc("POST /auth/kakao/start", wrap(s.kakaoStart))
	m.HandleFunc("GET /auth/kakao/callback", wrap(s.kakaoCallback))
	m.HandleFunc("POST /auth/kakao/claim", wrap(s.kakaoClaim))
	return m
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, 200, map[string]any{"ok": true, "books": bookSource(), "llmKeys": s.LLM.Available()})
	return nil
}
func New(db *pgxpool.Pool) *Server {
	gateway, err := llm.New(os.Getenv("LLM_KEYS"), os.Getenv("GEMINI_MODEL"), os.Getenv("OPENAI_MODEL"), nil)
	return &Server{DB: db, HTTP: &http.Client{Timeout: 8 * time.Second}, LLM: gateway, ConfigError: err, searchCache: make(map[string]searchEntry), deletions: make(map[string]deletionEntry), deletionWake: make(chan struct{}, 1)}
}
