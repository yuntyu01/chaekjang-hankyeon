package server

import (
	"context"
	"embed"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"strconv"
	"strings"
)

// Existing Flyway-managed migrations (V1~V7) are never replayed. Later files are Go-owned:
// they are applied to both Flyway and Go databases and recorded in go_schema_history.
//
//go:embed migrations/*.sql
var migrations embed.FS

// flywayBase is the last version the retired Java server applied with Flyway.
const flywayBase = 7

type migration struct {
	version int
	name    string
}

// Versions come from the V<n>__ prefix, not the file order (V10 sorts before V8 as text).
func migrationFiles() ([]migration, error) {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	out := make([]migration, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		head, _, ok := strings.Cut(strings.TrimPrefix(name, "V"), "__")
		version, e := strconv.Atoi(head)
		if !ok || !strings.HasPrefix(name, "V") || e != nil || version < 1 {
			return nil, fmt.Errorf("migration %s: name must be V<version>__<description>.sql", name)
		}
		out = append(out, migration{version, name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	for i, m := range out {
		if m.version != i+1 {
			return nil, fmt.Errorf("migration %s: versions must be 1..n without gaps or duplicates", m.name)
		}
	}
	return out, nil
}

func Migrate(ctx context.Context, db *pgxpool.Pool) error {
	files, err := migrationFiles()
	if err != nil {
		return err
	}
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
	from := 1
	if flyway {
		var n int
		if err = tx.QueryRow(ctx, "SELECT count(DISTINCT version) FROM flyway_schema_history WHERE success AND version IN ('1','2','3','4','5','6','7')").Scan(&n); err != nil {
			return err
		}
		if n != flywayBase {
			return fmt.Errorf("Flyway schema is incomplete; apply migrations with Flyway before starting the server")
		}
		var unsafe bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM flyway_schema_history WHERE NOT success OR (version ~ '^[0-9]+$' AND version::numeric > 7))").Scan(&unsafe); err != nil {
			return err
		}
		if unsafe {
			return fmt.Errorf("Flyway history contains failed or newer migrations; review before starting Go server")
		}
		from = flywayBase + 1
	} else if existing && !own {
		return fmt.Errorf("existing schema has no recognized migration history")
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS go_schema_history (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	var newer bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM go_schema_history WHERE version>$1)", len(files)).Scan(&newer); err != nil {
		return err
	}
	if newer {
		return fmt.Errorf("Go schema has newer migrations; review before starting this server")
	}
	for _, m := range files {
		if m.version < from {
			continue
		}
		var done bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM go_schema_history WHERE version=$1)", m.version).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		data, e := migrations.ReadFile("migrations/" + m.name)
		if e != nil {
			return e
		}
		if _, err = tx.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("migration %s: %w", m.name, err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO go_schema_history(version) VALUES ($1)", m.version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
