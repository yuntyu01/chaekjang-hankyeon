// Package books는 ISBN 기준 도서 캐시와 외부 도서 API 프록시를 맡는다.
package books

import (
	"context"
	"time"
)

// Book은 books 테이블 한 줄(전 사용자 공유).
type Book struct {
	ISBN13         string    `json:"isbn13"`
	Title          string    `json:"title"`
	Authors        []string  `json:"authors"`
	Publisher      string    `json:"publisher,omitempty"`
	PublishedAt    string    `json:"publishedAt,omitempty"` // YYYY-MM-DD
	PageCount      int       `json:"pageCount,omitempty"`
	Format         string    `json:"format,omitempty"`
	CoverURL       string    `json:"coverUrl,omitempty"`
	CoverThumbURL  string    `json:"coverThumbUrl,omitempty"`
	Description    string    `json:"description,omitempty"`
	ThemeColor     string    `json:"themeColor"`
	HeightClass    string    `json:"heightClass"`
	ThicknessClass string    `json:"thicknessClass"`
	DefaultMotifID string    `json:"defaultMotifId"`
	Source         string    `json:"source"`
	UpdatedAt      time.Time `json:"-"`
}

// SearchItem은 검색 결과 한 건. 같은 책의 여러 판은 출판사·출간일로 구분해 보여준다.
type SearchItem struct {
	ISBN13       string   `json:"isbn13"`
	Title        string   `json:"title"`
	Authors      []string `json:"authors"`
	Publisher    string   `json:"publisher,omitempty"`
	PublishedAt  string   `json:"publishedAt,omitempty"`
	ThumbnailURL string   `json:"thumbnailUrl,omitempty"`
	Description  string   `json:"description,omitempty"`
}

// Detail은 카카오 검색에 없는 정보(고해상도 표지, 쪽수, 판형)를 보강한다.
// 알라딘 OpenAPI는 2026-10-30 종료라 쓰지 않는다. 대체 출처는 미정(Detailer 구현만 바꾸면 된다).
type Detail struct {
	CoverURL    string
	PageCount   int
	Format      string
	Description string
	Link        string
}

// Searcher: 카카오 책 검색.
type Searcher interface {
	Search(ctx context.Context, query string) ([]SearchItem, error)
	LookupISBN(ctx context.Context, isbn13 string) (*SearchItem, error) // 없으면 nil, nil
}

// Detailer: 보강 정보 조회. 없으면 nil, nil.
type Detailer interface {
	Detail(ctx context.Context, isbn13 string) (*Detail, error)
}

// ColorExtractor: 표지 이미지에서 주조색을 뽑는다.
type ColorExtractor interface {
	ThemeColor(ctx context.Context, imageURL string) (string, error)
}

// Store: books 테이블. 없으면 nil, nil.
type Store interface {
	Get(ctx context.Context, isbn13 string) (*Book, error)
	Put(ctx context.Context, b *Book) error
}
