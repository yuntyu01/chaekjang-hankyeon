package server

// 커뮤니티(공개 데이터) API. 개인 동기화(/sync)와 표·권한이 따로다: 다른 사람은 개인 기록을 조회할 수 없고,
// 공개되는 것은 사용자가 게시·평가할 때 고른 필드뿐이다.
// - 읽기(피드·게시물·후기·프로필): 로그인한 기기 계정이면 된다.
// - 쓰기(프로필·게시·평가·좋아요·댓글·팔로우): 소셜 계정(Google·카카오)이 연결되어 있고 공개 프로필(닉네임)이 있어야 한다.
// - 차단·신고: 로그인한 계정 누구나. 차단하면 서로의 게시물·댓글·후기·프로필이 보이지 않는다.
// - 삭제·숨김(deleted_at·hidden_at)된 것은 피드·상세·집계 어디에도 나오지 않는다.

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	needsSocial  = apiError{403, "needs_social_account", "공개 활동은 Google이나 카카오 계정을 연결한 뒤 할 수 있어요"}
	needsProfile = apiError{403, "needs_profile", "공개 닉네임을 먼저 정해 주세요"}
	nickTaken    = apiError{409, "nickname_taken", "이미 쓰는 닉네임이에요"}
)

func (s *Server) routeCommunity(m *http.ServeMux) {
	m.HandleFunc("GET /community/profile", wrap(s.myProfile))
	m.HandleFunc("PUT /community/profile", wrap(s.putProfile))
	m.HandleFunc("GET /community/users/{id}", wrap(s.publicUser))
	m.HandleFunc("PUT /community/users/{id}/follow", wrap(s.follow(true)))
	m.HandleFunc("DELETE /community/users/{id}/follow", wrap(s.follow(false)))
	m.HandleFunc("GET /community/blocks", wrap(s.blocks))
	m.HandleFunc("PUT /community/users/{id}/block", wrap(s.block(true)))
	m.HandleFunc("DELETE /community/users/{id}/block", wrap(s.block(false)))
	m.HandleFunc("GET /community/books/{isbn}/reviews", wrap(s.reviews))
	m.HandleFunc("PUT /community/books/{isbn}/review", wrap(s.putReview))
	m.HandleFunc("DELETE /community/books/{isbn}/review", wrap(s.deleteReview))
	m.HandleFunc("GET /community/feed", wrap(s.feed))
	m.HandleFunc("POST /community/posts", wrap(s.createPost))
	m.HandleFunc("GET /community/posts/{id}", wrap(s.getPost))
	m.HandleFunc("PATCH /community/posts/{id}", wrap(s.editPost))
	m.HandleFunc("DELETE /community/posts/{id}", wrap(s.deletePost))
	m.HandleFunc("PUT /community/posts/{id}/like", wrap(s.like(true)))
	m.HandleFunc("DELETE /community/posts/{id}/like", wrap(s.like(false)))
	m.HandleFunc("GET /community/posts/{id}/comments", wrap(s.comments))
	m.HandleFunc("POST /community/posts/{id}/comments", wrap(s.addComment))
	m.HandleFunc("DELETE /community/comments/{id}", wrap(s.deleteComment))
	m.HandleFunc("POST /community/reports", wrap(s.report))
	m.HandleFunc("GET /admin/reports", wrap(s.adminReports))
	m.HandleFunc("POST /admin/reports/{id}/resolve", wrap(s.adminResolve))
}

// 공개 활동을 할 수 있는지: 소셜 계정 연결 + 공개 프로필
func (s *Server) author(ctx context.Context, user int64, wantProfile bool) error {
	var social, profile bool
	if err := s.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM auth_identities WHERE user_id=$1), EXISTS(SELECT 1 FROM public_profiles WHERE user_id=$1)", user).Scan(&social, &profile); err != nil {
		return err
	}
	if !social {
		return needsSocial
	}
	if wantProfile && !profile {
		return needsProfile
	}
	return nil
}

// 서로 차단 관계가 아닌 사용자만(보는 사람 viewer 기준). $1 = viewer, col = 글쓴이 열
func visible(col string) string {
	return "NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=" + col + ") OR (b.blocker_id=" + col + " AND b.blocked_id=$1))"
}

func idParam(r *http.Request, name string) (int64, error) {
	v, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || v <= 0 {
		return 0, notFound
	}
	return v, nil
}

func trimmed(p *string, max int) (*string, error) {
	if p == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(v) > max {
		return nil, bad
	}
	return &v, nil
}

// ---------- 프로필 ----------

type profileOut struct {
	UserID    int64   `json:"userId"`
	Nickname  string  `json:"nickname"`
	Bio       *string `json:"bio,omitempty"`
	Followers int     `json:"followers"`
	Following int     `json:"following"`
	Posts     int     `json:"posts"`
}

func (s *Server) profileOf(ctx context.Context, user int64) (*profileOut, error) {
	p := profileOut{UserID: user}
	err := s.DB.QueryRow(ctx, `SELECT nickname, bio,
	  (SELECT count(*) FROM community_follows WHERE followee_id=$1),
	  (SELECT count(*) FROM community_follows WHERE follower_id=$1),
	  (SELECT count(*) FROM community_posts WHERE user_id=$1 AND deleted_at IS NULL AND hidden_at IS NULL)
	  FROM public_profiles WHERE user_id=$1`, user).Scan(&p.Nickname, &p.Bio, &p.Followers, &p.Following, &p.Posts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (s *Server) myProfile(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	p, err := s.profileOf(r.Context(), user)
	if err != nil {
		return err
	}
	var social bool
	if err = s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM auth_identities WHERE user_id=$1)", user).Scan(&social); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"profile": p, "socialLinked": social})
	return nil
}

func (s *Server) putProfile(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	if err = s.author(r.Context(), user, false); err != nil {
		return err
	}
	var in struct {
		Nickname string  `json:"nickname"`
		Bio      *string `json:"bio"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	nick := strings.TrimSpace(in.Nickname)
	if n := utf8.RuneCountInString(nick); n < 2 || n > 20 {
		return apiError{400, "invalid_nickname", "닉네임은 2~20자로 정해 주세요"}
	}
	bio, err := trimmed(in.Bio, 200)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(r.Context(), `INSERT INTO public_profiles(user_id,nickname,bio) VALUES($1,$2,$3)
	  ON CONFLICT(user_id) DO UPDATE SET nickname=EXCLUDED.nickname, bio=EXCLUDED.bio, updated_at=now()`, user, nick, bio)
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return nickTaken
	}
	if err != nil {
		return err
	}
	p, err := s.profileOf(r.Context(), user)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"profile": p, "socialLinked": true})
	return nil
}

func (s *Server) publicUser(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	var ok bool
	if err = s.DB.QueryRow(ctx, "SELECT "+visible("$2::bigint"), viewer, id).Scan(&ok); err != nil {
		return err
	}
	p, err := s.profileOf(ctx, id)
	if err != nil {
		return err
	}
	if p == nil || !ok {
		return notFound
	}
	var followed, blocked bool
	_ = s.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM community_follows WHERE follower_id=$1 AND followee_id=$2), EXISTS(SELECT 1 FROM community_blocks WHERE blocker_id=$1 AND blocked_id=$2)", viewer, id).Scan(&followed, &blocked)
	posts, err := s.listPosts(ctx, viewer, "p.user_id=$2", []any{id}, 0, 20)
	if err != nil {
		return err
	}
	revs, err := s.listReviews(ctx, viewer, "rv.user_id=$2", []any{id}, 20)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"profile": p, "followed": followed, "blocked": blocked, "me": viewer == id, "posts": posts, "reviews": revs})
	return nil
}

func (s *Server) follow(on bool) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		user, err := s.user(r)
		if err != nil {
			return err
		}
		id, err := idParam(r, "id")
		if err != nil {
			return err
		}
		if id == user {
			return bad
		}
		ctx := r.Context()
		if !on {
			_, err = s.DB.Exec(ctx, "DELETE FROM community_follows WHERE follower_id=$1 AND followee_id=$2", user, id)
			if err == nil {
				writeJSON(w, 200, map[string]any{"followed": false})
			}
			return err
		}
		if err = s.author(ctx, user, true); err != nil {
			return err
		}
		var ok bool
		if err = s.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM public_profiles WHERE user_id=$2) AND "+visible("$2::bigint"), user, id).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return notFound
		}
		if _, err = s.DB.Exec(ctx, "INSERT INTO community_follows(follower_id,followee_id) VALUES($1,$2) ON CONFLICT DO NOTHING", user, id); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"followed": true})
		return nil
	}
}

func (s *Server) block(on bool) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		user, err := s.user(r)
		if err != nil {
			return err
		}
		id, err := idParam(r, "id")
		if err != nil {
			return err
		}
		if id == user {
			return bad
		}
		ctx := r.Context()
		if !on {
			_, err = s.DB.Exec(ctx, "DELETE FROM community_blocks WHERE blocker_id=$1 AND blocked_id=$2", user, id)
			if err == nil {
				writeJSON(w, 200, map[string]any{"blocked": false})
			}
			return err
		}
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, "INSERT INTO community_blocks(blocker_id,blocked_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2) ON CONFLICT DO NOTHING", user, id); err != nil {
			return err
		}
		// 차단하면 서로 팔로우도 끊는다
		if _, err = tx.Exec(ctx, "DELETE FROM community_follows WHERE (follower_id=$1 AND followee_id=$2) OR (follower_id=$2 AND followee_id=$1)", user, id); err != nil {
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"blocked": true})
		return nil
	}
}

// 내가 차단한 사람(풀 수 있게). 차단한 사람의 프로필은 보이지 않으므로 목록은 여기서만 준다
func (s *Server) blocks(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	rows, err := s.DB.Query(r.Context(), `SELECT b.blocked_id, COALESCE(pp.nickname, '') FROM community_blocks b
	  LEFT JOIN public_profiles pp ON pp.user_id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC LIMIT 200`, user)
	if err != nil {
		return err
	}
	type blockedOut struct {
		UserID   int64  `json:"userId"`
		Nickname string `json:"nickname"`
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (blockedOut, error) {
		var o blockedOut
		err := row.Scan(&o.UserID, &o.Nickname)
		return o, err
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"items": items})
	return nil
}

// ---------- 책별 별점·후기 ----------

type reviewOut struct {
	UserID    int64     `json:"userId"`
	Nickname  string    `json:"nickname"`
	ISBN      string    `json:"isbn13"`
	BookTitle *string   `json:"bookTitle,omitempty"`
	Rating    int       `json:"rating"`
	Body      *string   `json:"body,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Server) listReviews(ctx context.Context, viewer int64, where string, args []any, limit int) ([]reviewOut, error) {
	rows, err := s.DB.Query(ctx, `SELECT rv.user_id, pp.nickname, rv.isbn13, rv.book_title, rv.rating, rv.body, rv.updated_at
	  FROM book_reviews rv JOIN public_profiles pp ON pp.user_id=rv.user_id
	  WHERE rv.hidden_at IS NULL AND `+visible("rv.user_id")+` AND `+where+`
	  ORDER BY rv.updated_at DESC LIMIT `+strconv.Itoa(limit), append([]any{viewer}, args...)...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (reviewOut, error) {
		var o reviewOut
		err := row.Scan(&o.UserID, &o.Nickname, &o.ISBN, &o.BookTitle, &o.Rating, &o.Body, &o.UpdatedAt)
		return o, err
	})
}

func (s *Server) reviews(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.user(r)
	if err != nil {
		return err
	}
	isbn := r.PathValue("isbn")
	if !validISBN(isbn) {
		return apiError{400, "invalid_isbn", "ISBN-13 형식이 아니에요"}
	}
	ctx := r.Context()
	// 평균·평가 수: 평가한 사람만(평가하지 않은 사람을 0점으로 세지 않는다), 사용자당 하나, 숨김 제외. 내 평가는 따로
	var avg *float64
	var count int
	if err = s.DB.QueryRow(ctx, "SELECT avg(rating)::float8, count(*) FROM book_reviews rv WHERE rv.isbn13=$2 AND rv.hidden_at IS NULL AND "+visible("rv.user_id"), viewer, isbn).Scan(&avg, &count); err != nil {
		return err
	}
	items, err := s.listReviews(ctx, viewer, "rv.isbn13=$2 AND rv.user_id<>$1", []any{isbn}, 50)
	if err != nil {
		return err
	}
	var mine *reviewOut
	var m reviewOut
	err = s.DB.QueryRow(ctx, "SELECT user_id, isbn13, book_title, rating, body, updated_at FROM book_reviews WHERE user_id=$1 AND isbn13=$2", viewer, isbn).Scan(&m.UserID, &m.ISBN, &m.BookTitle, &m.Rating, &m.Body, &m.UpdatedAt)
	if err == nil {
		mine = &m
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	writeJSON(w, 200, map[string]any{"isbn13": isbn, "average": avg, "count": count, "mine": mine, "items": items})
	return nil
}

func (s *Server) putReview(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	isbn := r.PathValue("isbn")
	if !validISBN(isbn) {
		return apiError{400, "invalid_isbn", "ISBN-13 형식이 아니에요"}
	}
	if err = s.author(r.Context(), user, true); err != nil {
		return err
	}
	var in struct {
		Rating    int     `json:"rating"`
		Body      *string `json:"body"`
		BookTitle *string `json:"bookTitle"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	if in.Rating < 1 || in.Rating > 5 {
		return apiError{400, "invalid_rating", "별점은 1~5점이에요"}
	}
	body, err := trimmed(in.Body, 500)
	if err != nil {
		return err
	}
	title, err := trimmed(in.BookTitle, 200)
	if err != nil {
		return err
	}
	if _, err = s.DB.Exec(r.Context(), `INSERT INTO book_reviews(user_id,isbn13,rating,body,book_title) VALUES($1,$2,$3,$4,$5)
	  ON CONFLICT(user_id,isbn13) DO UPDATE SET rating=EXCLUDED.rating, body=EXCLUDED.body, book_title=COALESCE(EXCLUDED.book_title, book_reviews.book_title), updated_at=now()`, user, isbn, in.Rating, body, title); err != nil {
		return err
	}
	return s.reviews(w, r)
}

func (s *Server) deleteReview(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	isbn := r.PathValue("isbn")
	if !validISBN(isbn) {
		return apiError{400, "invalid_isbn", "ISBN-13 형식이 아니에요"}
	}
	if _, err = s.DB.Exec(r.Context(), "DELETE FROM book_reviews WHERE user_id=$1 AND isbn13=$2", user, isbn); err != nil {
		return err
	}
	return s.reviews(w, r)
}

// ---------- 게시물·피드 ----------

type postOut struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"userId"`
	Nickname   string    `json:"nickname"`
	ISBN       *string   `json:"isbn13,omitempty"`
	BookTitle  string    `json:"bookTitle"`
	BookAuthor *string   `json:"bookAuthor,omitempty"`
	DurationMs *int64    `json:"durationMs,omitempty"`
	PagesRead  *int      `json:"pagesRead,omitempty"`
	Quote      *string   `json:"quote,omitempty"`
	QuotePage  *int      `json:"quotePage,omitempty"`
	Body       *string   `json:"body,omitempty"`
	Likes      int       `json:"likes"`
	Liked      bool      `json:"liked"`
	Comments   int       `json:"comments"`
	Mine       bool      `json:"mine"`
	CreatedAt  time.Time `json:"createdAt"`
}

// where의 매개변수는 $2부터(빈 자리는 args로). before > 0이면 그 id보다 앞(오래된) 것만
func (s *Server) listPosts(ctx context.Context, viewer int64, where string, args []any, before int64, limit int) ([]postOut, error) {
	q := `SELECT p.id, p.user_id, pp.nickname, p.isbn13, p.book_title, p.book_author, p.duration_ms, p.pages_read, p.quote, p.quote_page, p.body,
	  (SELECT count(*) FROM community_likes l WHERE l.post_id=p.id),
	  EXISTS(SELECT 1 FROM community_likes l WHERE l.post_id=p.id AND l.user_id=$1),
	  (SELECT count(*) FROM community_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND ` + visible("c.user_id") + `),
	  p.user_id=$1, p.created_at
	  FROM community_posts p JOIN public_profiles pp ON pp.user_id=p.user_id
	  WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND ` + visible("p.user_id") + ` AND ` + where
	all := append([]any{viewer}, args...)
	if before > 0 {
		all = append(all, before)
		q += " AND p.id < $" + strconv.Itoa(len(all))
	}
	q += " ORDER BY p.id DESC LIMIT " + strconv.Itoa(limit)
	rows, err := s.DB.Query(ctx, q, all...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (postOut, error) {
		var o postOut
		err := row.Scan(&o.ID, &o.UserID, &o.Nickname, &o.ISBN, &o.BookTitle, &o.BookAuthor, &o.DurationMs, &o.PagesRead, &o.Quote, &o.QuotePage, &o.Body, &o.Likes, &o.Liked, &o.Comments, &o.Mine, &o.CreatedAt)
		return o, err
	})
}

func (s *Server) feed(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.user(r)
	if err != nil {
		return err
	}
	scope := r.URL.Query().Get("scope")
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit := 20
	if v, e := strconv.Atoi(r.URL.Query().Get("limit")); e == nil && v > 0 && v <= 50 {
		limit = v
	}
	where := "TRUE"
	if scope == "following" {
		where = "p.user_id IN (SELECT followee_id FROM community_follows WHERE follower_id=$1)"
	} else if scope != "" && scope != "discover" {
		return bad
	}
	items, err := s.listPosts(r.Context(), viewer, where, nil, before, limit+1)
	if err != nil {
		return err
	}
	more := len(items) > limit
	if more {
		items = items[:limit]
	}
	var next *int64
	if more {
		next = &items[len(items)-1].ID
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextBefore": next})
	return nil
}

func (s *Server) onePost(ctx context.Context, viewer, id int64) (*postOut, error) {
	items, err := s.listPosts(ctx, viewer, "p.id=$2", []any{id}, 0, 1)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, notFound
	}
	return &items[0], nil
}

func (s *Server) createPost(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err = s.author(ctx, user, true); err != nil {
		return err
	}
	var in struct {
		ClientID   string  `json:"clientId"`
		ISBN       *string `json:"isbn13"`
		BookTitle  string  `json:"bookTitle"`
		BookAuthor *string `json:"bookAuthor"`
		DurationMs *int64  `json:"durationMs"`
		PagesRead  *int    `json:"pagesRead"`
		Quote      *string `json:"quote"`
		QuotePage  *int    `json:"quotePage"`
		Body       *string `json:"body"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	title := strings.TrimSpace(in.BookTitle)
	cid := strings.TrimSpace(in.ClientID)
	if title == "" || utf8.RuneCountInString(title) > 200 || cid == "" || len(cid) > 64 {
		return bad
	}
	if in.ISBN != nil && *in.ISBN != "" && !validISBN(*in.ISBN) {
		return apiError{400, "invalid_isbn", "ISBN-13 형식이 아니에요"}
	}
	isbn := in.ISBN
	if isbn != nil && *isbn == "" {
		isbn = nil
	}
	author, err := trimmed(in.BookAuthor, 200)
	if err != nil {
		return err
	}
	quote, err := trimmed(in.Quote, 1000)
	if err != nil {
		return err
	}
	body, err := trimmed(in.Body, 1000)
	if err != nil {
		return err
	}
	// 0·음수는 '모름'으로(잘못된 숫자를 보이지 않는다)
	pos64 := func(v *int64) *int64 {
		if v == nil || *v <= 0 {
			return nil
		}
		return v
	}
	pos := func(v *int) *int {
		if v == nil || *v <= 0 {
			return nil
		}
		return v
	}
	var id int64
	// 같은 client_id(재시도·중복 요청)는 처음 것 하나
	err = s.DB.QueryRow(ctx, `INSERT INTO community_posts(user_id,client_id,isbn13,book_title,book_author,duration_ms,pages_read,quote,quote_page,body)
	  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id`,
		user, cid, isbn, title, author, pos64(in.DurationMs), pos(in.PagesRead), quote, pos(in.QuotePage), body).Scan(&id)
	if err != nil {
		return err
	}
	p, err := s.onePost(ctx, user, id)
	if err != nil {
		return err
	}
	writeJSON(w, 200, p)
	return nil
}

func (s *Server) getPost(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	p, err := s.onePost(r.Context(), viewer, id)
	if err != nil {
		return err
	}
	writeJSON(w, 200, p)
	return nil
}

func (s *Server) editPost(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Body *string `json:"body"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	body, err := trimmed(in.Body, 1000)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), "UPDATE community_posts SET body=$3, updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", id, user, body)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound
	}
	return s.getPost(w, r)
}

func (s *Server) deletePost(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), "UPDATE community_posts SET deleted_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", id, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound
	}
	writeJSON(w, 200, map[string]any{"deleted": true})
	return nil
}

func (s *Server) like(on bool) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		user, err := s.user(r)
		if err != nil {
			return err
		}
		id, err := idParam(r, "id")
		if err != nil {
			return err
		}
		ctx := r.Context()
		if on {
			if err = s.author(ctx, user, true); err != nil {
				return err
			}
			if _, err = s.onePost(ctx, user, id); err != nil {
				return err
			}
			_, err = s.DB.Exec(ctx, "INSERT INTO community_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", id, user)
		} else {
			_, err = s.DB.Exec(ctx, "DELETE FROM community_likes WHERE post_id=$1 AND user_id=$2", id, user)
		}
		if err != nil {
			return err
		}
		return s.getPost(w, r)
	}
}

// ---------- 댓글 ----------

type commentOut struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"userId"`
	Nickname  string    `json:"nickname"`
	Body      string    `json:"body"`
	Mine      bool      `json:"mine"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Server) comments(w http.ResponseWriter, r *http.Request) error {
	viewer, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err = s.onePost(ctx, viewer, id); err != nil {
		return err
	}
	rows, err := s.DB.Query(ctx, `SELECT c.id, c.user_id, pp.nickname, c.body, c.user_id=$1, c.created_at
	  FROM community_comments c JOIN public_profiles pp ON pp.user_id=c.user_id
	  WHERE c.post_id=$2 AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND `+visible("c.user_id")+` ORDER BY c.id LIMIT 200`, viewer, id)
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (commentOut, error) {
		var o commentOut
		err := row.Scan(&o.ID, &o.UserID, &o.Nickname, &o.Body, &o.Mine, &o.CreatedAt)
		return o, err
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"items": items})
	return nil
}

func (s *Server) addComment(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err = s.author(ctx, user, true); err != nil {
		return err
	}
	if _, err = s.onePost(ctx, user, id); err != nil {
		return err
	}
	var in struct {
		Body     string  `json:"body"`
		ClientID *string `json:"clientId"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	body := strings.TrimSpace(in.Body)
	if body == "" || utf8.RuneCountInString(body) > 500 {
		return bad
	}
	if in.ClientID != nil {
		_, err = s.DB.Exec(ctx, "INSERT INTO community_comments(post_id,user_id,client_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,client_id) DO NOTHING", id, user, *in.ClientID, body)
	} else {
		_, err = s.DB.Exec(ctx, "INSERT INTO community_comments(post_id,user_id,body) VALUES($1,$2,$3)", id, user, body)
	}
	if err != nil {
		return err
	}
	return s.comments(w, r)
}

// 댓글을 쓴 사람 또는 그 게시물의 주인이 지울 수 있다
func (s *Server) deleteComment(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(r.Context(), `UPDATE community_comments c SET deleted_at=now() WHERE c.id=$1 AND c.deleted_at IS NULL
	  AND (c.user_id=$2 OR EXISTS(SELECT 1 FROM community_posts p WHERE p.id=c.post_id AND p.user_id=$2))`, id, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound
	}
	writeJSON(w, 200, map[string]any{"deleted": true})
	return nil
}

// ---------- 신고·운영 ----------

func (s *Server) report(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var in struct {
		Kind   string  `json:"kind"`
		ID     string  `json:"id"`
		Reason *string `json:"reason"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	switch in.Kind {
	case "post", "comment", "user", "review":
	default:
		return bad
	}
	if strings.TrimSpace(in.ID) == "" || len(in.ID) > 64 {
		return bad
	}
	reason, err := trimmed(in.Reason, 300)
	if err != nil {
		return err
	}
	if _, err = s.DB.Exec(r.Context(), "INSERT INTO community_reports(reporter_id,target_kind,target_id,reason) VALUES($1,$2,$3,$4)", user, in.Kind, in.ID, reason); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"reported": true})
	return nil
}

// 운영자: 환경 변수 ADMIN_TOKEN과 같은 X-Admin-Token. 없으면 운영 경로는 없다(404)
func adminOK(r *http.Request) bool {
	want := os.Getenv("ADMIN_TOKEN")
	got := r.Header.Get("X-Admin-Token")
	return want != "" && len(got) == len(want) && subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (s *Server) adminReports(w http.ResponseWriter, r *http.Request) error {
	if !adminOK(r) {
		return notFound
	}
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "open"
	}
	rows, err := s.DB.Query(r.Context(), "SELECT id, COALESCE(reporter_id,0), target_kind, target_id, COALESCE(reason,''), status, created_at FROM community_reports WHERE status=$1 ORDER BY id LIMIT 200", status)
	if err != nil {
		return err
	}
	type rep struct {
		ID        int64     `json:"id"`
		Reporter  int64     `json:"reporterId"`
		Kind      string    `json:"kind"`
		Target    string    `json:"targetId"`
		Reason    string    `json:"reason"`
		Status    string    `json:"status"`
		CreatedAt time.Time `json:"createdAt"`
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (rep, error) {
		var o rep
		err := row.Scan(&o.ID, &o.Reporter, &o.Kind, &o.Target, &o.Reason, &o.Status, &o.CreatedAt)
		return o, err
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"items": items})
	return nil
}

// action: hide(신고 대상을 숨김: 피드·상세·집계에서 빠진다) 또는 dismiss(기각)
func (s *Server) adminResolve(w http.ResponseWriter, r *http.Request) error {
	if !adminOK(r) {
		return notFound
	}
	id, err := idParam(r, "id")
	if err != nil {
		return err
	}
	var in struct {
		Action string `json:"action"`
	}
	if err = decode(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var kind, target string
	if err = tx.QueryRow(ctx, "SELECT target_kind, target_id FROM community_reports WHERE id=$1", id).Scan(&kind, &target); err != nil {
		return err
	}
	status := "dismissed"
	if in.Action == "hide" {
		status = "hidden"
		switch kind {
		case "post":
			_, err = tx.Exec(ctx, "UPDATE community_posts SET hidden_at=now() WHERE id::text=$1", target)
		case "comment":
			_, err = tx.Exec(ctx, "UPDATE community_comments SET hidden_at=now() WHERE id::text=$1", target)
		case "review":
			// target_id = '사용자id:ISBN'
			parts := strings.SplitN(target, ":", 2)
			if len(parts) == 2 {
				_, err = tx.Exec(ctx, "UPDATE book_reviews SET hidden_at=now() WHERE user_id::text=$1 AND isbn13=$2", parts[0], parts[1])
			}
		case "user":
			_, err = tx.Exec(ctx, "UPDATE community_posts SET hidden_at=now() WHERE user_id::text=$1", target)
		}
		if err != nil {
			return err
		}
	} else if in.Action != "dismiss" {
		return bad
	}
	if _, err = tx.Exec(ctx, "UPDATE community_reports SET status=$2, resolved_at=now() WHERE id=$1", id, status); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"status": status})
	return nil
}
