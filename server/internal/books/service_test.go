package books

import (
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/httpx"
)

const isbn = "9788937460449"

type countingSearcher struct {
	lookups atomic.Int32
	fail    atomic.Bool
}

func (c *countingSearcher) Search(context.Context, string) ([]SearchItem, error) { return nil, nil }
func (c *countingSearcher) LookupISBN(_ context.Context, i string) (*SearchItem, error) {
	c.lookups.Add(1)
	time.Sleep(10 * time.Millisecond)
	if c.fail.Load() {
		return nil, errors.New("down")
	}
	if i != isbn {
		return nil, nil
	}
	return &SearchItem{ISBN13: isbn, Title: "데미안", Authors: []string{"헤르만 헤세"}, ThumbnailURL: "https://img/c.jpg"}, nil
}

type countingColors struct{ n atomic.Int32 }

func (c *countingColors) ThemeColor(context.Context, string) (string, error) {
	c.n.Add(1)
	return "#2F5A45", nil
}

func newSvc() (*Service, *countingSearcher, *countingColors, *time.Time) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	s, c := &countingSearcher{}, &countingColors{}
	svc := &Service{Store: NewMemStore(), Searcher: s, Colors: c, Source: "test", TTL: 30 * 24 * time.Hour, SearchTTL: time.Minute, Now: func() time.Time { return now }}
	svc.Store = &clockStore{MemStore: NewMemStore(), now: &now}
	return svc, s, c, &now
}

// clockStore는 저장 시각을 테스트 시계로 찍는다.
type clockStore struct {
	*MemStore
	now *time.Time
}

func (c *clockStore) Put(ctx context.Context, b *Book) error {
	cp := *b
	cp.UpdatedAt = *c.now
	return c.MemStore.Put(ctx, &cp)
}

func TestSameISBNFetchedOnce(t *testing.T) {
	svc, s, c, _ := newSvc()
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Get(context.Background(), isbn); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	// 두 번째 사용자 요청도 캐시에서
	b, err := svc.Get(context.Background(), isbn)
	if err != nil {
		t.Fatal(err)
	}
	if s.lookups.Load() != 1 || c.n.Load() != 1 {
		t.Fatalf("external calls: lookup=%d color=%d, want 1/1", s.lookups.Load(), c.n.Load())
	}
	if b.ThemeColor != "#2F5A45" || b.ThicknessClass != "medium" || b.DefaultMotifID == "" {
		t.Fatalf("unexpected book: %+v", b)
	}
}

func TestTTLRefreshKeepsColor(t *testing.T) {
	svc, s, c, now := newSvc()
	ctx := context.Background()
	if _, err := svc.Get(ctx, isbn); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(31 * 24 * time.Hour)
	if _, err := svc.Get(ctx, isbn); err != nil {
		t.Fatal(err)
	}
	if s.lookups.Load() != 2 || c.n.Load() != 1 {
		t.Fatalf("lookup=%d color=%d, want 2/1", s.lookups.Load(), c.n.Load())
	}
	// 갱신 실패 시 이전 데이터
	*now = now.Add(31 * 24 * time.Hour)
	s.fail.Store(true)
	b, err := svc.Get(ctx, isbn)
	if err != nil || b.Title != "데미안" {
		t.Fatalf("stale not served: %v %+v", err, b)
	}
}

func TestGetErrors(t *testing.T) {
	svc, s, _, _ := newSvc()
	ctx := context.Background()
	var he *httpx.Error
	if _, err := svc.Get(ctx, "123"); !errors.As(err, &he) || he.Code != "invalid_isbn" {
		t.Fatalf("want invalid_isbn, got %v", err)
	}
	if _, err := svc.Get(ctx, "9788996991342"); !errors.Is(err, httpx.ErrNotFound) {
		t.Fatalf("want not found, got %v", err)
	}
	s.fail.Store(true)
	if _, err := svc.Get(ctx, isbn); !errors.Is(err, httpx.ErrUpstream) {
		t.Fatalf("want upstream, got %v", err)
	}
}

func TestErrorJSONFormat(t *testing.T) {
	svc, _, _, _ := newSvc()
	mux := http.NewServeMux()
	svc.Routes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/books/9788996991342", nil))
	var body struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != 404 || body.Error.Code != "not_found" {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestKakaoClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "KakaoAK k1" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{"documents":[{"title":"데미안","isbn":"8937460440 9788937460449","datetime":"2000-12-20T00:00:00.000+09:00","authors":["헤르만 헤세"],"publisher":"민음사","thumbnail":"https://t/x.jpg"},{"title":"isbn 없음","isbn":""}]}`))
	}))
	defer srv.Close()
	k := &Kakao{Key: "k1", BaseURL: srv.URL}
	items, err := k.Search(context.Background(), "데미안")
	if err != nil || len(items) != 1 || items[0].ISBN13 != isbn || items[0].PublishedAt != "2000-12-20" {
		t.Fatalf("%v %+v", err, items)
	}
	it, err := k.LookupISBN(context.Background(), isbn)
	if err != nil || it == nil || it.Publisher != "민음사" {
		t.Fatalf("%v %+v", err, it)
	}
	if _, err := (&Kakao{Key: "bad", BaseURL: srv.URL}).Search(context.Background(), "x"); err == nil {
		t.Fatal("want error on 401")
	}
}

func TestSearchCacheAndValidation(t *testing.T) {
	svc := &Service{Searcher: MockSearcher{}, SearchTTL: time.Minute}
	items, err := svc.Search(context.Background(), " 여름의 숲 ")
	if err != nil || len(items) != 2 {
		t.Fatalf("%v %+v", err, items)
	}
	if _, err := svc.Search(context.Background(), "  "); !errors.Is(err, httpx.ErrBadRequest) {
		t.Fatal("empty query must be bad request")
	}
	for _, b := range mockBooks {
		if !validISBN13(b.ISBN13) {
			t.Fatalf("mock isbn invalid: %s", b.ISBN13)
		}
	}
}

func TestDominantColor(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 100, 140))
	for y := range 140 {
		for x := range 100 {
			c := color.RGBA{250, 250, 250, 255} // 흰 여백
			if y > 30 && y < 110 && x > 10 && x < 90 {
				c = color.RGBA{0x2F, 0x5A, 0x45, 255}
			}
			if y > 50 && y < 60 {
				c = color.RGBA{10, 10, 10, 255} // 검은 글자
			}
			img.Set(x, y, c)
		}
	}
	if got := DominantColor(img); got != "#2F5A45" {
		t.Fatalf("got %s", got)
	}
}

func TestClasses(t *testing.T) {
	cases := map[int]string{0: "medium", 120: "thin", 219: "thin", 220: "medium", 419: "medium", 600: "thick"}
	for p, want := range cases {
		if got := ThicknessFromPages(p); got != want {
			t.Errorf("%d: %s want %s", p, got, want)
		}
	}
	formats := map[string]string{"128*188mm": "short", "152x225mm": "medium", "188×257": "tall", "A5": "medium", "B6": "short", "": "medium"}
	for f, want := range formats {
		if got := HeightFromFormat(f); got != want {
			t.Errorf("%q: %s want %s", f, got, want)
		}
	}
}

func TestDefaultMotifMatchesApp(t *testing.T) {
	// app/src/domain/__tests__/catalog.test.ts 와 같은 기대값
	if DefaultMotifFor("9788937460449") != "constellation" || DefaultMotifFor("9791190090018") != "window" {
		t.Fatal("motif hash differs from app")
	}
}

// 앱 motif-slots.ts와 순서·해시가 같아야 같은 책이 같은 모티프를 받는다.
func TestMotifSlotsMatchApp(t *testing.T) {
	src, err := os.ReadFile("../../../app/src/domain/motif-slots.ts")
	if err != nil {
		t.Skip("app source not found")
	}
	var ids []string
	for _, m := range regexp.MustCompile(`\{ id: '(\w+)'`).FindAllStringSubmatch(string(src), -1) {
		ids = append(ids, m[1])
	}
	if len(ids) != len(MotifSlots) {
		t.Fatalf("app %d slots, server %d", len(ids), len(MotifSlots))
	}
	for i := range ids {
		if ids[i] != MotifSlots[i] {
			t.Fatalf("slot %d: app %s server %s", i, ids[i], MotifSlots[i])
		}
	}
}
