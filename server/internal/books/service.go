package books

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/httpx"
)

// Service: ISBN당 외부 조회·색 추출을 한 번만 하고 공유 캐시에 넣는다.
// 카카오 운영정책(캐시는 최신 데이터로 유지)에 맞춰 TTL이 지나면 다시 조회한다.
type Service struct {
	Store     Store
	Searcher  Searcher
	Detailer  Detailer // nil 가능
	Colors    ColorExtractor
	Source    string        // kakao | mock
	TTL       time.Duration // books 캐시 갱신 주기
	SearchTTL time.Duration // 검색 결과 메모리 캐시
	Now       func() time.Time

	locks  keyedMutex
	smu    sync.Mutex
	scache map[string]searchEntry
}

type searchEntry struct {
	items []SearchItem
	at    time.Time
}

const searchCacheMax = 500

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) Search(ctx context.Context, q string) ([]SearchItem, error) {
	q = strings.TrimSpace(q)
	if q == "" || len([]rune(q)) > 100 {
		return nil, httpx.ErrBadRequest
	}
	s.smu.Lock()
	if e, ok := s.scache[q]; ok && s.now().Sub(e.at) < s.SearchTTL {
		s.smu.Unlock()
		return e.items, nil
	}
	s.smu.Unlock()
	items, err := s.Searcher.Search(ctx, q)
	if err != nil {
		slog.Warn("search failed", "err", err)
		return nil, httpx.ErrUpstream
	}
	if items == nil {
		items = []SearchItem{}
	}
	s.smu.Lock()
	if s.scache == nil {
		s.scache = map[string]searchEntry{}
	}
	if len(s.scache) >= searchCacheMax {
		for k, e := range s.scache {
			if s.now().Sub(e.at) >= s.SearchTTL || len(s.scache) >= searchCacheMax {
				delete(s.scache, k)
			}
		}
	}
	s.scache[q] = searchEntry{items: items, at: s.now()}
	s.smu.Unlock()
	return items, nil
}

func validISBN13(s string) bool {
	if len(s) != 13 {
		return false
	}
	sum := 0
	for i, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
		d := int(ch - '0')
		if i%2 == 1 {
			d *= 3
		}
		sum += d
	}
	return sum%10 == 0
}

func (s *Service) Get(ctx context.Context, isbn13 string) (*Book, error) {
	if !validISBN13(isbn13) {
		return nil, httpx.NewError(400, "invalid_isbn", "ISBN-13 형식이 아니에요")
	}
	fresh := func(b *Book) bool { return b != nil && s.now().Sub(b.UpdatedAt) < s.TTL }
	cached, err := s.Store.Get(ctx, isbn13)
	if err != nil {
		return nil, err
	}
	if fresh(cached) {
		return cached, nil
	}
	unlock := s.locks.lock(isbn13)
	defer unlock()
	// 기다리는 동안 다른 요청이 채웠을 수 있다.
	if again, err := s.Store.Get(ctx, isbn13); err == nil && fresh(again) {
		return again, nil
	}
	b, err := s.fetch(ctx, isbn13, cached)
	if err != nil {
		if cached != nil {
			slog.Warn("refresh failed, serving stale", "isbn", isbn13, "err", err)
			return cached, nil
		}
		return nil, err
	}
	if err := s.Store.Put(ctx, b); err != nil {
		return nil, err
	}
	return s.Store.Get(ctx, isbn13)
}

func (s *Service) fetch(ctx context.Context, isbn13 string, prev *Book) (*Book, error) {
	it, err := s.Searcher.LookupISBN(ctx, isbn13)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", httpx.ErrUpstream, err)
	}
	if it == nil {
		return nil, httpx.ErrNotFound
	}
	var d Detail
	if s.Detailer != nil {
		if got, err := s.Detailer.Detail(ctx, isbn13); err != nil {
			slog.Warn("detail failed", "isbn", isbn13, "err", err)
		} else if got != nil {
			d = *got
		}
	}
	cover := d.CoverURL
	if cover == "" {
		cover = it.ThumbnailURL
	}
	desc := d.Description
	if desc == "" {
		desc = it.Description
	}
	b := &Book{
		ISBN13:         isbn13,
		Title:          it.Title,
		Authors:        it.Authors,
		Publisher:      it.Publisher,
		PublishedAt:    it.PublishedAt,
		PageCount:      d.PageCount,
		Format:         d.Format,
		CoverURL:       cover,
		CoverThumbURL:  it.ThumbnailURL,
		Description:    desc,
		HeightClass:    HeightFromFormat(d.Format),
		ThicknessClass: ThicknessFromPages(d.PageCount),
		DefaultMotifID: DefaultMotifFor(isbn13),
		Source:         s.Source,
	}
	if b.Authors == nil {
		b.Authors = []string{}
	}
	// 색 추출도 한 번만: 표지가 그대로면 이전 색을 쓴다.
	switch {
	case prev != nil && prev.CoverURL == cover:
		b.ThemeColor = prev.ThemeColor
	case cover != "" && s.Colors != nil:
		if c, err := s.Colors.ThemeColor(ctx, cover); err == nil {
			b.ThemeColor = c
		} else {
			slog.Warn("color failed", "isbn", isbn13, "err", err)
		}
	}
	if b.ThemeColor == "" {
		b.ThemeColor = FallbackColor(isbn13)
	}
	return b, nil
}

// keyedMutex: 같은 ISBN 요청이 동시에 와도 외부 조회는 한 번.
type keyedMutex struct {
	mu sync.Mutex
	m  map[string]*keyedEntry
}

type keyedEntry struct {
	mu   sync.Mutex
	refs int
}

func (k *keyedMutex) lock(key string) func() {
	k.mu.Lock()
	if k.m == nil {
		k.m = map[string]*keyedEntry{}
	}
	e := k.m[key]
	if e == nil {
		e = &keyedEntry{}
		k.m[key] = e
	}
	e.refs++
	k.mu.Unlock()
	e.mu.Lock()
	return func() {
		e.mu.Unlock()
		k.mu.Lock()
		e.refs--
		if e.refs == 0 {
			delete(k.m, key)
		}
		k.mu.Unlock()
	}
}
