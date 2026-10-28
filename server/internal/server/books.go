package server

import (
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type searchItem struct {
	ISBN        string   `json:"isbn13"`
	Title       string   `json:"title"`
	Authors     []string `json:"authors"`
	Publisher   string   `json:"publisher,omitempty"`
	PublishedAt string   `json:"publishedAt,omitempty"`
	Thumb       string   `json:"thumbnailUrl,omitempty"`
	Description string   `json:"description,omitempty"`
}
type bookResponse struct {
	searchItem
	PageCount      int    `json:"pageCount,omitempty"`
	Format         string `json:"format,omitempty"`
	CoverURL       string `json:"coverUrl,omitempty"`
	CoverThumbURL  string `json:"coverThumbUrl,omitempty"`
	ThemeColor     string `json:"themeColor"`
	HeightClass    string `json:"heightClass"`
	ThicknessClass string `json:"thicknessClass"`
	DefaultMotifID string `json:"defaultMotifId"`
	Source         string `json:"source"`
}

var mocks = []searchItem{{"9790000000018", "여름의 숲", []string{"가짜 작가"}, "샘플 출판", "2021-06-01", "", ""}, {"9790000000025", "여름의 숲", []string{"가짜 작가"}, "샘플 출판 개정판", "2025-03-15", "", ""}, {"9790000000032", "달과 나", []string{"시험 저자"}, "개발 문고", "2019-11-20", "", ""}, {"9790000000049", "고요한 우연", []string{"시험 저자"}, "개발 문고", "2023-02-08", "", ""}, {"9790000000056", "작은 것들의 깊이", []string{"목업 작가", "공동 저자"}, "샘플 출판", "2024-09-01", "", ""}}
var pages = map[string]int{"9790000000018": 180, "9790000000025": 196, "9790000000032": 312, "9790000000049": 460, "9790000000056": 240}
var motifs = strings.Split("leaf sprig cotton moon crescent star constellation wave ripple flower wildflower tulip camellia pine mountain cloud sun rain snow feather bird cat teacup candle key letter window lantern shell mushroom", " ")
var colors = []string{"#EFE6D3", "#2F5A45", "#B5503A", "#A8C3DA", "#223A63", "#F2C9A0", "#D98A7E", "#7D2E35"}

func hashISBN(s string) uint32 {
	var h uint32
	for _, c := range s {
		h = h*31 + uint32(c)
	}
	return h
}
func validISBN(s string) bool {
	if len(s) != 13 {
		return false
	}
	sum := 0
	for i, c := range s {
		if c < '0' || c > '9' {
			return false
		}
		n := int(c - '0')
		if i%2 == 1 {
			n *= 3
		}
		sum += n
	}
	return sum%10 == 0
}
func (s *Server) searchBooks(q string, isbn bool) ([]searchItem, error) {
	key := os.Getenv("KAKAO_REST_KEY")
	out := []searchItem{}
	if key == "" {
		for _, b := range mocks {
			if (isbn && b.ISBN == q) || (!isbn && (strings.Contains(b.Title, q) || strings.Contains(strings.Join(b.Authors, " "), q))) {
				out = append(out, b)
			}
		}
		return out, nil
	}
	v := url.Values{"query": {q}, "size": {"30"}}
	if isbn {
		v.Set("target", "isbn")
	}
	req, e := http.NewRequest("GET", "https://dapi.kakao.com/v3/search/book?"+v.Encode(), nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "KakaoAK "+key)
	res, e := s.HTTP.Do(req)
	if e != nil {
		return nil, upstream
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, upstream
	}
	var data struct {
		Documents []struct {
			ISBN      string   `json:"isbn"`
			Title     string   `json:"title"`
			Authors   []string `json:"authors"`
			Publisher string   `json:"publisher"`
			Datetime  string   `json:"datetime"`
			Thumbnail string   `json:"thumbnail"`
			Contents  string   `json:"contents"`
		} `json:"documents"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 5<<20)).Decode(&data); e != nil {
		return nil, upstream
	}
	for _, d := range data.Documents {
		code := ""
		for _, part := range strings.Fields(d.ISBN) {
			if len(part) == 13 {
				code = part
				break
			}
		}
		if code == "" || (isbn && code != q) {
			continue
		}
		date := d.Datetime
		if len(date) >= 10 {
			date = date[:10]
		}
		out = append(out, searchItem{code, d.Title, d.Authors, d.Publisher, date, d.Thumbnail, d.Contents})
	}
	return out, nil
}

type searchEntry struct {
	items []searchItem
	at    time.Time
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || utf8.RuneCountInString(q) > 100 {
		return bad
	}
	ttl := 10 * time.Minute
	if value := os.Getenv("SEARCH_CACHE_TTL"); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			ttl = d
		}
	}
	s.searchMu.Lock()
	entry, ok := s.searchCache[q]
	s.searchMu.Unlock()
	if ok && time.Since(entry.at) < ttl {
		writeJSON(w, 200, map[string]any{"items": entry.items})
		return nil
	}
	items, err := s.searchBooks(q, false)
	if err != nil {
		return err
	}
	s.searchMu.Lock()
	if len(s.searchCache) >= 500 {
		for key, old := range s.searchCache {
			if time.Since(old.at) >= ttl {
				delete(s.searchCache, key)
			}
		}
		if len(s.searchCache) >= 500 {
			for key := range s.searchCache {
				delete(s.searchCache, key)
				break
			}
		}
	}
	s.searchCache[q] = searchEntry{items: items, at: time.Now()}
	s.searchMu.Unlock()
	writeJSON(w, 200, map[string]any{"items": items})
	return nil
}

type bookLockEntry struct {
	mu   sync.Mutex
	refs int
}

var bookLocks = struct {
	sync.Mutex
	entries map[string]*bookLockEntry
}{entries: make(map[string]*bookLockEntry)}

func lockBook(isbn string) func() {
	bookLocks.Lock()
	entry := bookLocks.entries[isbn]
	if entry == nil {
		entry = &bookLockEntry{}
		bookLocks.entries[isbn] = entry
	}
	entry.refs++
	bookLocks.Unlock()
	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		bookLocks.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(bookLocks.entries, isbn)
		}
		bookLocks.Unlock()
	}
}

func (s *Server) book(w http.ResponseWriter, r *http.Request) error {
	isbn := r.PathValue("isbn")
	if !validISBN(isbn) {
		return apiError{400, "invalid_isbn", "ISBN-13 형식이 아니에요"}
	}
	unlock := lockBook(isbn)
	defer unlock()
	ctx := r.Context()
	var b bookResponse
	var updated time.Time
	var authors []string
	e := s.DB.QueryRow(ctx, `SELECT isbn13,title,COALESCE(publisher,''),COALESCE(to_char(published_at,'YYYY-MM-DD'),''),COALESCE(page_count,0),COALESCE(format,''),COALESCE(cover_url,''),COALESCE(cover_thumb_url,''),COALESCE(description,''),theme_color,height_class,thickness_class,default_motif_id,source,updated_at,ARRAY(SELECT name FROM book_authors WHERE isbn13=$1 ORDER BY position) FROM books WHERE isbn13=$1`, isbn).Scan(&b.ISBN, &b.Title, &b.Publisher, &b.PublishedAt, &b.PageCount, &b.Format, &b.CoverURL, &b.CoverThumbURL, &b.Description, &b.ThemeColor, &b.HeightClass, &b.ThicknessClass, &b.DefaultMotifID, &b.Source, &updated, &authors)
	cached := e == nil
	if e != nil && e != pgx.ErrNoRows {
		return e
	}
	b.Authors = authors
	ttl := 720 * time.Hour
	if v := os.Getenv("BOOKS_CACHE_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			ttl = d
		}
	}
	if cached && time.Since(updated) < ttl {
		writeJSON(w, 200, b)
		return nil
	}
	found, e := s.searchBooks(isbn, true)
	if e != nil || len(found) == 0 {
		if cached {
			writeJSON(w, 200, b)
			return nil
		}
		if e != nil {
			return e
		}
		return notFound
	}
	item := found[0]
	source := "kakao"
	if os.Getenv("KAKAO_REST_KEY") == "" {
		source = "mock"
	}
	color := ""
	if cached && b.CoverURL == item.Thumb {
		color = b.ThemeColor
	}
	if color == "" && item.Thumb != "" {
		color = s.coverColor(item.Thumb)
	}
	if color == "" {
		color = colors[int(hashISBN(isbn)%uint32(len(colors)))]
	}
	motif := motifs[int(hashISBN(isbn)%uint32(len(motifs)))]
	if cached {
		motif = b.DefaultMotifID
	}
	page := pages[isbn]
	if source != "mock" {
		page = 0
	}
	thickness := "medium"
	if page > 0 && page < 220 {
		thickness = "thin"
	} else if page >= 420 {
		thickness = "thick"
	}
	b = bookResponse{searchItem: searchItem{ISBN: isbn, Title: item.Title, Authors: item.Authors, Publisher: item.Publisher, PublishedAt: item.PublishedAt, Description: item.Description}, PageCount: page, CoverURL: item.Thumb, CoverThumbURL: item.Thumb, ThemeColor: color, HeightClass: "medium", ThicknessClass: thickness, DefaultMotifID: motif, Source: source}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var date any
	if b.PublishedAt != "" {
		t, err := time.Parse("2006-01-02", b.PublishedAt)
		if err == nil {
			date = t
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO books(isbn13,title,publisher,published_at,page_count,format,cover_url,cover_thumb_url,description,theme_color,height_class,thickness_class,default_motif_id,source,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()) ON CONFLICT(isbn13) DO UPDATE SET title=EXCLUDED.title,publisher=EXCLUDED.publisher,published_at=EXCLUDED.published_at,page_count=EXCLUDED.page_count,format=EXCLUDED.format,cover_url=EXCLUDED.cover_url,cover_thumb_url=EXCLUDED.cover_thumb_url,description=EXCLUDED.description,theme_color=EXCLUDED.theme_color,height_class=EXCLUDED.height_class,thickness_class=EXCLUDED.thickness_class,default_motif_id=EXCLUDED.default_motif_id,source=EXCLUDED.source,updated_at=now()`, isbn, b.Title, b.Publisher, date, page, b.Format, b.CoverURL, b.CoverThumbURL, b.Description, b.ThemeColor, b.HeightClass, b.ThicknessClass, b.DefaultMotifID, b.Source)
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "DELETE FROM book_authors WHERE isbn13=$1", isbn); e != nil {
		return e
	}
	for i, name := range b.Authors {
		if _, e = tx.Exec(ctx, "INSERT INTO book_authors(isbn13,position,name) VALUES($1,$2,$3)", isbn, i, name); e != nil {
			return e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	writeJSON(w, 200, b)
	return nil
}
func (s *Server) coverColor(url string) string {
	res, e := s.HTTP.Get(url)
	if e != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return ""
	}
	img, _, e := image.Decode(io.LimitReader(res.Body, 5<<20))
	if e != nil {
		return ""
	}
	bounds := img.Bounds()
	step := bounds.Dx() / 80
	if step < 1 {
		step = 1
	}
	type acc struct{ n, r, g, b int }
	pick := func(skip bool) string {
		m := map[int]*acc{}
		order := []int{}
		for y := bounds.Min.Y; y < bounds.Max.Y; y += step {
			for x := bounds.Min.X; x < bounds.Max.X; x += step {
				rr, gg, bb, aa := img.At(x, y).RGBA()
				r, g, b, a := int(rr>>8), int(gg>>8), int(bb>>8), int(aa>>8)
				if a < 128 || (skip && ((r > 238 && g > 238 && b > 238) || (r < 22 && g < 22 && b < 22))) {
					continue
				}
				k := (r>>4)<<8 | (g>>4)<<4 | b>>4
				if m[k] == nil {
					m[k] = &acc{}
					order = append(order, k)
				}
				v := m[k]
				v.n++
				v.r += r
				v.g += g
				v.b += b
			}
		}
		var best *acc
		for _, k := range order {
			v := m[k]
			if best == nil || v.n > best.n {
				best = v
			}
		}
		if best == nil {
			return ""
		}
		return fmt.Sprintf("#%02X%02X%02X", best.r/best.n, best.g/best.n, best.b/best.n)
	}
	c := pick(true)
	if c == "" {
		c = pick(false)
	}
	return c
}
