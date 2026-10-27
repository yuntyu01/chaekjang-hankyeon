package server

import (
	"context"
	"embed"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The SQL is copied from the Java server. Existing Flyway-managed databases are never replayed.
//
//go:embed migrations/*.sql
var migrations embed.FS

func Migrate(ctx context.Context, db *pgxpool.Pool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(987614002)"); err != nil {
		return err
	}
	var flyway, own, existing bool
	if err = tx.QueryRow(ctx, "SELECT to_regclass('public.flyway_schema_history') IS NOT NULL, to_regclass('public.go_schema_history') IS NOT NULL, to_regclass('public.users') IS NOT NULL").Scan(&flyway, &own, &existing); err != nil {
		return err
	}
	if flyway {
		var n int
		if err = tx.QueryRow(ctx, "SELECT count(DISTINCT version) FROM flyway_schema_history WHERE success AND version IN ('1','2','3','4','5')").Scan(&n); err != nil {
			return err
		}
		if n != 5 {
			return fmt.Errorf("Flyway schema is incomplete; apply Java migrations before starting Go server")
		}
		return tx.Commit(ctx)
	}
	if existing && !own {
		return fmt.Errorf("existing schema has no recognized migration history")
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS go_schema_history (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for i, entry := range entries {
		version := i + 1
		var done bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM go_schema_history WHERE version=$1)", version).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		data, e := migrations.ReadFile("migrations/" + entry.Name())
		if e != nil {
			return e
		}
		if _, err = tx.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("migration %s: %w", entry.Name(), err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO go_schema_history(version) VALUES ($1)", version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
