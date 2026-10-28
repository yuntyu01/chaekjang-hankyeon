package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
)

func googleEnabled() bool {
	return os.Getenv("GOOGLE_CLIENT_ID") != "" && os.Getenv("GOOGLE_CLIENT_SECRET") != "" && os.Getenv("PUBLIC_BASE_URL") != ""
}
func googleCallbackURL() string {
	return strings.TrimRight(os.Getenv("PUBLIC_BASE_URL"), "/") + "/auth/google/callback"
}
func lifecycleError() error {
	return apiError{426, "upgrade_required", "로그인하려면 앱을 업데이트해 주세요"}
}

func (s *Server) providers(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, 200, map[string]bool{"google": googleEnabled(), "kakao": kakaoEnabled(), "accountDeletion": true})
	return nil
}

func (s *Server) googleStart(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	if !googleEnabled() {
		return apiError{503, "not_configured", "Google 로그인이 아직 준비되지 않았어요"}
	}
	var body struct {
		ReturnURL string `json:"returnUrl"`
		Lifecycle string `json:"accountLifecycle"`
	}
	if err = decode(r, &body); err != nil {
		return err
	}
	if body.Lifecycle != "1" {
		return lifecycleError()
	}
	if body.ReturnURL != "chaekjang://auth/google" {
		return bad
	}
	state, err := random(32)
	if err != nil {
		return err
	}
	nonce, err := random(32)
	if err != nil {
		return err
	}
	verifier, err := random(32)
	if err != nil {
		return err
	}
	if _, err = s.DB.Exec(r.Context(), "DELETE FROM google_logins WHERE expires_at<=now()"); err != nil {
		return err
	}
	if _, err = s.DB.Exec(r.Context(), "DELETE FROM google_login_tickets WHERE expires_at<=now()"); err != nil {
		return err
	}
	if _, err = s.DB.Exec(r.Context(), "INSERT INTO google_logins(state_hash,user_id,return_url,nonce_hash,upstream_verifier) VALUES($1,$2,$3,$4,$5)", hash(state), user, body.ReturnURL, hash(nonce), verifier); err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(verifier))
	values := url.Values{"response_type": {"code"}, "client_id": {os.Getenv("GOOGLE_CLIENT_ID")}, "redirect_uri": {googleCallbackURL()}, "scope": {"openid profile"}, "state": {state}, "nonce": {nonce}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}}
	writeJSON(w, 200, map[string]string{"url": "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode()})
	return nil
}

type googleIdentity struct{ Subject, Nickname string }

func (s *Server) googleExchange(ctx context.Context, code, verifier, nonceHash string) (googleIdentity, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.HTTP)
	cfg := oauth2.Config{ClientID: os.Getenv("GOOGLE_CLIENT_ID"), ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"), RedirectURL: googleCallbackURL(), Endpoint: oauth2.Endpoint{TokenURL: "https://oauth2.googleapis.com/token", AuthStyle: oauth2.AuthStyleInParams}}
	token, err := cfg.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", verifier))
	if err != nil {
		return googleIdentity{}, fmt.Errorf("google_exchange_failed")
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" || len(raw) > 16000 {
		return googleIdentity{}, fmt.Errorf("google_id_token_missing")
	}
	s.googleOnce.Do(func() {
		keyCtx := oidc.ClientContext(context.Background(), s.HTTP)
		keys := oidc.NewRemoteKeySet(keyCtx, "https://www.googleapis.com/oauth2/v3/certs")
		s.googleVerifier = oidc.NewVerifier("https://accounts.google.com", keys, &oidc.Config{ClientID: os.Getenv("GOOGLE_CLIENT_ID"), SupportedSigningAlgs: []string{"RS256"}})
	})
	id, err := s.googleVerifier.Verify(ctx, raw)
	if err != nil {
		return googleIdentity{}, fmt.Errorf("google_id_token_invalid")
	}
	var claims struct {
		Nonce string `json:"nonce"`
		Name  string `json:"name"`
		Azp   string `json:"azp"`
	}
	if err = id.Claims(&claims); err != nil || id.Subject == "" || len(id.Subject) > 255 || id.IssuedAt.IsZero() || id.IssuedAt.After(time.Now().Add(time.Minute)) || claims.Nonce == "" || subtle.ConstantTimeCompare([]byte(hash(claims.Nonce)), []byte(nonceHash)) != 1 || (len(id.Audience) > 1 && claims.Azp == "") || (claims.Azp != "" && claims.Azp != os.Getenv("GOOGLE_CLIENT_ID")) {
		return googleIdentity{}, fmt.Errorf("google_id_token_invalid")
	}
	name := []rune(claims.Name)
	if len(name) > 200 {
		name = name[:200]
	}
	return googleIdentity{Subject: id.Subject, Nickname: string(name)}, nil
}

func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) error {
	state := r.URL.Query().Get("state")
	if state == "" || len(state) > 200 {
		return expired
	}
	var source int64
	var ret, nonceHash, verifier string
	err := s.DB.QueryRow(r.Context(), "DELETE FROM google_logins WHERE state_hash=$1 AND expires_at>now() RETURNING user_id,return_url,nonce_hash,upstream_verifier", hash(state)).Scan(&source, &ret, &nonceHash, &verifier)
	if errors.Is(err, pgx.ErrNoRows) {
		return expired
	}
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	code := r.URL.Query().Get("code")
	if r.URL.Query().Get("error") != "" || code == "" || len(code) > 4096 {
		http.Redirect(w, r, redirectParam(ret, "error", "denied"), http.StatusFound)
		return nil
	}
	identity, err := s.googleExchange(r.Context(), code, verifier, nonceHash)
	if err != nil {
		http.Redirect(w, r, redirectParam(ret, "error", "failed"), http.StatusFound)
		return nil
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "INSERT INTO auth_identities(provider,subject,user_id) VALUES('google',$1,$2) ON CONFLICT DO NOTHING", identity.Subject, source); err != nil {
		return err
	}
	var result int64
	if err = tx.QueryRow(r.Context(), "SELECT user_id FROM auth_identities WHERE provider='google' AND subject=$1", identity.Subject).Scan(&result); err != nil {
		return err
	}
	if identity.Nickname != "" {
		if _, err = tx.Exec(r.Context(), "UPDATE users SET nickname=$1 WHERE id=$2", identity.Nickname, result); err != nil {
			return err
		}
	}
	ticket, err := random(32)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(r.Context(), "INSERT INTO google_login_tickets(ticket_hash,source_user_id,result_user_id) VALUES($1,$2,$3)", hash(ticket), source, result); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	http.Redirect(w, r, redirectParam(ret, "ticket", ticket), http.StatusFound)
	return nil
}

func recordSwitch(ctx context.Context, tx pgx.Tx, source, target int64) error {
	if source == target {
		return nil
	}
	rows, err := tx.Query(ctx, "SELECT id FROM users WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE", []int64{source, target})
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		count++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if count != 2 {
		return apiError{409, "account_unavailable", "연결할 계정을 사용할 수 없어요"}
	}
	var active, sourceActive bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM api_tokens WHERE user_id=$1), EXISTS(SELECT 1 FROM api_tokens WHERE user_id=$2)", target, source).Scan(&active, &sourceActive); err != nil {
		return err
	}
	if !active || !sourceActive {
		return apiError{409, "account_unavailable", "연결할 계정을 사용할 수 없어요"}
	}
	var linked bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM auth_identities WHERE user_id=$1)", source).Scan(&linked); err != nil {
		return err
	}
	if linked {
		return apiError{409, "account_link_conflict", "다른 계정에 이미 연결된 로그인입니다. 현재 계정의 연결은 유지됩니다"}
	}
	if _, err := tx.Exec(ctx, "INSERT INTO account_predecessors(source_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING", source, target); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "DELETE FROM api_tokens WHERE user_id=$1", source)
	return err
}

func (s *Server) googleClaim(w http.ResponseWriter, r *http.Request) error {
	source, err := s.user(r)
	if err != nil {
		return err
	}
	var body struct {
		Ticket string `json:"ticket"`
	}
	if err = decode(r, &body); err != nil {
		return err
	}
	if body.Ticket == "" || len(body.Ticket) > 200 {
		return bad
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	var result int64
	err = tx.QueryRow(r.Context(), "DELETE FROM google_login_tickets WHERE ticket_hash=$1 AND source_user_id=$2 AND expires_at>now() RETURNING result_user_id", hash(body.Ticket), source).Scan(&result)
	if errors.Is(err, pgx.ErrNoRows) {
		return expired
	}
	if err != nil {
		return err
	}
	if err = recordSwitch(r.Context(), tx, source, result); err != nil {
		return err
	}
	token, err := issueToken(r.Context(), tx, result)
	if err != nil {
		return err
	}
	var nickname string
	if err = tx.QueryRow(r.Context(), "SELECT COALESCE(nickname,'') FROM users WHERE id=$1", result).Scan(&nickname); err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"userId": result, "token": token, "switched": result != source, "nickname": nickname})
	return nil
}
