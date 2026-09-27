package books

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MemStore는 테스트·DB 없는 로컬 실행용.
type MemStore struct {
	mu sync.Mutex
	m  map[string]Book
}

func NewMemStore() *MemStore { return &MemStore{m: map[string]Book{}} }

func (s *MemStore) Get(_ context.Context, isbn13 string) (*Book, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if b, ok := s.m[isbn13]; ok {
		return &b, nil
	}
	return nil, nil
}

func (s *MemStore) Put(_ context.Context, b *Book) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := *b
	if c.UpdatedAt.IsZero() {
		c.UpdatedAt = time.Now()
	}
	s.m[b.ISBN13] = c
	return nil
}

// PgStore는 books 테이블.
type PgStore struct{ Pool *pgxpool.Pool }

const bookCols = `isbn13, title, authors, coalesce(publisher, ''), coalesce(to_char(published_at, 'YYYY-MM-DD'), ''),
	coalesce(page_count, 0), coalesce(format, ''), coalesce(cover_url, ''), coalesce(cover_thumb_url, ''), coalesce(description, ''),
	theme_color, height_class, thickness_class, default_motif_id, source, updated_at`

func (s PgStore) Get(ctx context.Context, isbn13 string) (*Book, error) {
	var b Book
	err := s.Pool.QueryRow(ctx, `SELECT `+bookCols+` FROM books WHERE isbn13 = $1`, isbn13).Scan(
		&b.ISBN13, &b.Title, &b.Authors, &b.Publisher, &b.PublishedAt, &b.PageCount, &b.Format,
		&b.CoverURL, &b.CoverThumbURL, &b.Description, &b.ThemeColor, &b.HeightClass, &b.ThicknessClass, &b.DefaultMotifID, &b.Source, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s PgStore) Put(ctx context.Context, b *Book) error {
	var published any
	if t, err := time.Parse("2006-01-02", b.PublishedAt); err == nil {
		published = t
	}
	var pages any
	if b.PageCount > 0 {
		pages = b.PageCount
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO books (isbn13, title, authors, publisher, published_at, page_count, format, cover_url, cover_thumb_url,
			description, theme_color, height_class, thickness_class, default_motif_id, source)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (isbn13) DO UPDATE SET
			title = excluded.title, authors = excluded.authors, publisher = excluded.publisher,
			published_at = excluded.published_at, page_count = excluded.page_count, format = excluded.format,
			cover_url = excluded.cover_url, cover_thumb_url = excluded.cover_thumb_url, description = excluded.description,
			theme_color = excluded.theme_color, height_class = excluded.height_class,
			thickness_class = excluded.thickness_class, source = excluded.source, updated_at = now()`,
		b.ISBN13, b.Title, b.Authors, nullable(b.Publisher), published, pages, nullable(b.Format), nullable(b.CoverURL),
		nullable(b.CoverThumbURL), nullable(b.Description), b.ThemeColor, b.HeightClass, b.ThicknessClass, b.DefaultMotifID, b.Source)
	return err
}
