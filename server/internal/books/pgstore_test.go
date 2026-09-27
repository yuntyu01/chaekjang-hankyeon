package books

import (
	"context"
	"os"
	"testing"

	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/db"
	"github.com/yuntyu01/chaekjang-hankyeon/server/migrations"
)

// TEST_DATABASE_URL이 있을 때만 실제 Postgres로 마이그레이션·저장·갱신을 확인한다.
func TestPgStore(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL 없음")
	}
	ctx := context.Background()
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for range 2 { // 두 번 돌려도 한 번만 적용
		if err := db.Migrate(ctx, pool, migrations.Files); err != nil {
			t.Fatal(err)
		}
	}
	s := PgStore{Pool: pool}
	b := &Book{ISBN13: isbn, Title: "데미안", Authors: []string{"헤르만 헤세"}, PublishedAt: "2000-12-20", ThemeColor: "#2F5A45",
		HeightClass: "medium", ThicknessClass: "thick", DefaultMotifID: "leaf", Source: "test"}
	if err := s.Put(ctx, b); err != nil {
		t.Fatal(err)
	}
	b.Title, b.DefaultMotifID = "데미안(개정)", "moon"
	if err := s.Put(ctx, b); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, isbn)
	if err != nil || got == nil || got.Title != "데미안(개정)" || got.DefaultMotifID != "leaf" || got.PublishedAt != "2000-12-20" || got.UpdatedAt.IsZero() {
		t.Fatalf("%v %+v", err, got)
	}
	if none, err := s.Get(ctx, "9788996991342"); err != nil || none != nil {
		t.Fatalf("%v %+v", err, none)
	}
	_, _ = pool.Exec(ctx, `DELETE FROM books WHERE isbn13 = $1`, isbn)
}
