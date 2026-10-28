package server

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
)

const journalPrefix = "_account-deletions/"
const receiptPrefix = "_account-deletion-receipts/"

var kakaoSubject = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)
var deletionJournalKey = regexp.MustCompile(`^_account-deletions/[1-9][0-9]*-[0-9]+\.json$`)

type deletionEntry struct {
	UserID      int64   `json:"userId"`
	CreatedAt   string  `json:"createdAt"`
	RequestedAt string  `json:"requestedAt"`
	CompletedAt *string `json:"completedAt"`
	TokenHash   string  `json:"tokenHash,omitempty"`
}

func (e deletionEntry) key() (string, error) {
	t, err := time.Parse(time.RFC3339Nano, e.CreatedAt)
	if err != nil || e.UserID < 1 {
		return "", fmt.Errorf("invalid_deletion_journal")
	}
	return journalPrefix + strconv.FormatInt(e.UserID, 10) + "-" + strconv.FormatInt(t.UnixMilli(), 10) + ".json", nil
}
func (s *Server) storagePut(ctx context.Context, key string, data []byte) error {
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		client, err := s.objectClient(ctx)
		if err != nil {
			return err
		}
		_, err = client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: bytes.NewReader(data)})
		return err
	}
	path := filePath(key)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".journal-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
func (s *Server) storageRead(ctx context.Context, key string) ([]byte, error) {
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		client, err := s.objectClient(ctx)
		if err != nil {
			return nil, err
		}
		out, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
		if err != nil {
			return nil, err
		}
		defer out.Body.Close()
		return io.ReadAll(io.LimitReader(out.Body, 4097))
	}
	return os.ReadFile(filePath(key))
}
func (s *Server) storageList(ctx context.Context, prefix string) ([]string, error) {
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		client, err := s.objectClient(ctx)
		if err != nil {
			return nil, err
		}
		p := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String(prefix)})
		var keys []string
		for p.HasMorePages() {
			page, err := p.NextPage(ctx)
			if err != nil {
				return nil, err
			}
			for _, item := range page.Contents {
				if item.Key != nil {
					keys = append(keys, *item.Key)
				}
			}
		}
		return keys, nil
	}
	root := filePath(prefix)
	var keys []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if !d.IsDir() {
			rel, e := filepath.Rel(filePath(""), path)
			if e != nil {
				return e
			}
			keys = append(keys, filepath.ToSlash(rel))
		}
		return nil
	})
	return keys, err
}
func (s *Server) storageDelete(ctx context.Context, key string) error {
	if bucket := os.Getenv("S3_BUCKET"); bucket != "" {
		client, err := s.objectClient(ctx)
		if err != nil {
			return err
		}
		_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
		return err
	}
	err := os.Remove(filePath(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// DB를 과거 시점으로 복원해도 삭제 요청을 다시 적용할 수 있도록 독립 저장소에 남긴다.
func (s *Server) InitializeDeletion(ctx context.Context) error {
	keys, err := s.storageList(ctx, journalPrefix)
	if err != nil {
		return err
	}
	entries := make(map[string]deletionEntry, len(keys))
	for _, key := range keys {
		raw, err := s.storageRead(ctx, key)
		if err != nil {
			return err
		}
		if len(raw) > 4096 {
			return fmt.Errorf("invalid_deletion_journal")
		}
		var e deletionEntry
		if json.Unmarshal(raw, &e) != nil {
			return fmt.Errorf("invalid_deletion_journal")
		}
		expected, err := e.key()
		if err != nil || expected != key || e.RequestedAt == "" {
			return fmt.Errorf("invalid_deletion_journal")
		}
		entries[key] = e
	}
	s.deletionMu.Lock()
	s.deletions = entries
	s.deletionMu.Unlock()
	if err = s.reconcileDeletions(ctx); err != nil {
		return err
	}
	return nil
}
func (s *Server) deletionBlocked(user int64, created time.Time) bool {
	key, _ := (deletionEntry{UserID: user, CreatedAt: created.UTC().Format(time.RFC3339Nano)}).key()
	s.deletionMu.RLock()
	entry, ok := s.deletions[key]
	s.deletionMu.RUnlock()
	if !ok {
		return false
	}
	at, err := time.Parse(time.RFC3339Nano, entry.CreatedAt)
	return err == nil && at.Equal(created)
}
func (s *Server) saveDeletion(ctx context.Context, e deletionEntry) error {
	key, err := e.key()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	// 영수증을 먼저 쓰되, 재시도 시 실제 저널도 확인한다. 인스턴스가 바뀌어도 같은 요청을 확인할 수 있다.
	if e.TokenHash != "" {
		if len(e.TokenHash) != 64 {
			return fmt.Errorf("invalid_deletion_receipt")
		}
		if err = s.storagePut(ctx, receiptPrefix+e.TokenHash, []byte(key)); err != nil {
			return err
		}
	}
	if err = s.storagePut(ctx, key, raw); err != nil {
		return err
	}
	s.deletionMu.Lock()
	s.deletions[key] = e
	s.deletionMu.Unlock()
	return nil
}
func (s *Server) requestDeletion(ctx context.Context, user int64, tokenHash string) error {
	s.deletionRequestMu.Lock()
	defer s.deletionRequestMu.Unlock()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var locked int64
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", user).Scan(&locked); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, "SELECT source_id FROM account_predecessors WHERE target_id=$1", user)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	ids = append(ids, user)
	for _, id := range ids {
		var created time.Time
		err = tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id=$1", id).Scan(&created)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		e := deletionEntry{UserID: id, CreatedAt: created.UTC().Format(time.RFC3339Nano), RequestedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		key, _ := e.key()
		s.deletionMu.RLock()
		old, exists := s.deletions[key]
		s.deletionMu.RUnlock()
		if exists {
			e = old
		}
		if id == user && tokenHash != "" {
			e.TokenHash = tokenHash
		}
		if err = s.saveDeletion(ctx, e); err != nil {
			return err
		}
	}
	// 다른 서버 인스턴스에서도 기존 인증을 즉시 차단한다.
	_, err = tx.Exec(ctx, "DELETE FROM api_tokens WHERE user_id=ANY($1::bigint[])", ids)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Server) eraseEntry(ctx context.Context, e deletionEntry) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var created time.Time
	err = tx.QueryRow(ctx, "SELECT created_at FROM users WHERE id=$1 FOR UPDATE", e.UserID).Scan(&created)
	if !errors.Is(err, pgx.ErrNoRows) && err != nil {
		return err
	}
	want, err := time.Parse(time.RFC3339Nano, e.CreatedAt)
	if err != nil {
		return err
	}
	if created.Equal(want) {
		keys, err := s.storageList(ctx, strconv.FormatInt(e.UserID, 10)+"/")
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO account_file_deletions(storage_key) SELECT storage_key FROM files WHERE user_id=$1 ON CONFLICT DO NOTHING", e.UserID); err != nil {
			return err
		}
		for _, key := range keys {
			if _, err = tx.Exec(ctx, "INSERT INTO account_file_deletions(storage_key) VALUES($1) ON CONFLICT DO NOTHING", key); err != nil {
				return err
			}
		}
		if e.CompletedAt == nil {
			if _, err = tx.Exec(ctx, "INSERT INTO kakao_disconnect_jobs(subject,account_id) SELECT subject,user_id FROM auth_identities WHERE provider='kakao' AND user_id=$1 ON CONFLICT DO NOTHING", e.UserID); err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, "DELETE FROM users WHERE id=$1", e.UserID); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if e.CompletedAt == nil {
		done := time.Now().UTC().Format(time.RFC3339Nano)
		e.CompletedAt = &done
		return s.saveDeletion(ctx, e)
	}
	return nil
}
func (s *Server) reconcileDeletions(ctx context.Context) error {
	s.deletionMu.RLock()
	entries := make(map[string]deletionEntry, len(s.deletions))
	for k, v := range s.deletions {
		entries[k] = v
	}
	s.deletionMu.RUnlock()
	for key, e := range entries {
		if err := s.eraseEntry(ctx, e); err != nil {
			return err
		}
		if e.CompletedAt != nil {
			t, err := time.Parse(time.RFC3339Nano, *e.CompletedAt)
			if err != nil {
				return err
			}
			if t.Before(time.Now().Add(-29*24*time.Hour - 23*time.Hour)) {
				if e.TokenHash != "" {
					if err = s.storageDelete(ctx, receiptPrefix+e.TokenHash); err != nil {
						return err
					}
				}
				if err = s.storageDelete(ctx, key); err != nil {
					return err
				}
				s.deletionMu.Lock()
				delete(s.deletions, key)
				s.deletionMu.Unlock()
			}
		}
	}
	return nil
}
func (s *Server) processDeletionJobs(ctx context.Context) error {
	s.deletionWorkMu.Lock()
	defer s.deletionWorkMu.Unlock()
	if err := s.reconcileDeletions(ctx); err != nil {
		return err
	}
	rows, err := s.DB.Query(ctx, "SELECT storage_key FROM account_file_deletions ORDER BY requested_at LIMIT 50")
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, key := range keys {
		if err = s.storageDelete(ctx, key); err != nil {
			_, _ = s.DB.Exec(ctx, "UPDATE account_file_deletions SET attempts=attempts+1 WHERE storage_key=$1", key)
			continue
		}
		if _, err = s.DB.Exec(ctx, "DELETE FROM account_file_deletions WHERE storage_key=$1", key); err != nil {
			return err
		}
	}
	// A failed Kakao disconnect is retried while retaining only the identifier needed for it.
	rows, err = s.DB.Query(ctx, "SELECT subject FROM kakao_disconnect_jobs ORDER BY requested_at LIMIT 50")
	if err != nil {
		return err
	}
	var subjects []string
	for rows.Next() {
		var subject string
		if err = rows.Scan(&subject); err != nil {
			rows.Close()
			return err
		}
		subjects = append(subjects, subject)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, subject := range subjects {
		var newer bool
		if err = s.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM auth_identities WHERE provider='kakao' AND subject=$1)", subject).Scan(&newer); err != nil {
			return err
		}
		if !newer {
			if err = s.unlinkKakao(ctx, subject); err != nil {
				_, _ = s.DB.Exec(ctx, "UPDATE kakao_disconnect_jobs SET attempts=attempts+1 WHERE subject=$1", subject)
				continue
			}
		}
		if _, err = s.DB.Exec(ctx, "DELETE FROM kakao_disconnect_jobs WHERE subject=$1", subject); err != nil {
			return err
		}
	}
	var overdue int
	err = s.DB.QueryRow(ctx, "SELECT count(*) FROM kakao_disconnect_jobs WHERE requested_at<now()-interval '6 days 23 hours'").Scan(&overdue)
	if err == nil && overdue > 0 {
		log.Print("kakao_unlink_deadline_exceeded")
	}
	return err
}
func (s *Server) StartDeletionWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			jobCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := s.processDeletionJobs(jobCtx)
			cancel()
			if err != nil && ctx.Err() == nil {
				log.Print("account_erasure_retry_pending")
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-s.deletionWake:
			}
		}
	}()
}
func (s *Server) wakeDeletionWorker() {
	select {
	case s.deletionWake <- struct{}{}:
	default:
	}
}
func (s *Server) unlinkKakao(ctx context.Context, subject string) error {
	admin := os.Getenv("KAKAO_ADMIN_KEY")
	if admin == "" {
		return fmt.Errorf("kakao_not_configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://kapi.kakao.com/v1/user/unlink", strings.NewReader(url.Values{"target_id_type": {"user_id"}, "target_id": {subject}}.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "KakaoAK "+admin)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := s.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == 200 {
		return nil
	}
	if res.StatusCode == 400 {
		var b struct {
			Code int `json:"code"`
		}
		if json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&b) == nil && b.Code == -101 {
			return nil
		}
	}
	return fmt.Errorf("kakao_unlink_failed")
}
func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Confirmation string `json:"confirmation"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	if body.Confirmation != "DELETE" {
		return bad
	}
	raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || raw == "" || len(raw) > 200 {
		return unauthorized
	}
	tokenHash := hash(raw)
	s.deletionMu.RLock()
	receipt := false
	for _, entry := range s.deletions {
		if entry.TokenHash != "" && subtle.ConstantTimeCompare([]byte(entry.TokenHash), []byte(tokenHash)) == 1 {
			receipt = true
			break
		}
	}
	s.deletionMu.RUnlock()
	if !receipt {
		// 재시도가 다른 인스턴스에 도착하면 독립 저장소의 영수증과 원본 저널을 대조한다.
		if marker, e := s.storageRead(r.Context(), receiptPrefix+tokenHash); e == nil && len(marker) < 256 && deletionJournalKey.Match(marker) {
			if raw, e := s.storageRead(r.Context(), string(marker)); e == nil && len(raw) <= 4096 {
				var entry deletionEntry
				if json.Unmarshal(raw, &entry) == nil {
					key, e := entry.key()
					receipt = e == nil && key == string(marker) && subtle.ConstantTimeCompare([]byte(entry.TokenHash), []byte(tokenHash)) == 1
				}
			}
		}
	}
	if receipt {
		w.WriteHeader(http.StatusAccepted)
		return nil
	}
	user, err := s.user(r)
	if err != nil {
		return err
	}
	if err = s.requestDeletion(r.Context(), user, tokenHash); err != nil {
		return err
	}
	s.wakeDeletionWorker()
	w.WriteHeader(http.StatusAccepted)
	return nil
}
func (s *Server) kakaoUnlink(w http.ResponseWriter, r *http.Request) error {
	admin, app := os.Getenv("KAKAO_ADMIN_KEY"), os.Getenv("KAKAO_APP_ID")
	header := r.Header.Get("Authorization")
	if admin == "" || app == "" || r.FormValue("app_id") != app || subtle.ConstantTimeCompare([]byte(header), []byte("KakaoAK "+admin)) != 1 {
		return unauthorized
	}
	subject := r.FormValue("user_id")
	if !kakaoSubject.MatchString(subject) {
		return bad
	}
	// 공급자 연결 해제는 해당 로그인만 제거한다. 서재 삭제는 앱의 명시적 요청으로만 한다.
	if _, err := s.DB.Exec(r.Context(), "DELETE FROM auth_identities WHERE provider='kakao' AND subject=$1", subject); err != nil {
		return err
	}
	w.WriteHeader(http.StatusOK)
	return nil
}
