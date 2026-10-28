package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNormalizeDatabaseURL(t *testing.T) {
	tests := []struct{ input, want string }{
		{"postgresql+psycopg2://app:p%40ss@postgres:5432/app?sslmode=disable", "postgresql://app:p%40ss@postgres:5432/app?sslmode=disable"},
		{"jdbc:postgresql://app:pass@postgres:5432/app", "postgresql://app:pass@postgres:5432/app"},
		{"postgres://app:pass@postgres:5432/app", "postgres://app:pass@postgres:5432/app"},
		{"postgresql://app:pass@postgres:5432/app", "postgresql://app:pass@postgres:5432/app"},
	}
	for _, tt := range tests {
		got := normalizeDatabaseURL(tt.input)
		if got != tt.want {
			t.Errorf("normalizeDatabaseURL(%q) = %q, want %q", tt.input, got, tt.want)
		}
		if _, err := pgxpool.ParseConfig(got); err != nil {
			t.Errorf("normalized URL did not parse: %v", err)
		}
	}
}
