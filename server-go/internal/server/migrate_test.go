package server

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
)

func TestFlywayV5RequiresUpgrade(t *testing.T) {
	dsn := os.Getenv("TEST_FLYWAY_V5_URL")
	if dsn == "" {
		t.Skip("set TEST_FLYWAY_V5_URL to a disposable Flyway V5 database")
	}
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = Migrate(context.Background(), db); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("expected incomplete schema error, got %v", err)
	}
}
func TestFlywayV7CanStart(t *testing.T) {
	dsn := os.Getenv("TEST_FLYWAY_V7_URL")
	if dsn == "" {
		t.Skip("set TEST_FLYWAY_V7_URL to a disposable Flyway V7 database")
	}
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
}
