// 책장 한켠 API 서버.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/books"
	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/db"
	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/httpx"
	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/llm"
	"github.com/yuntyu01/chaekjang-hankyeon/server/migrations"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func duration(key string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(os.Getenv(key)); err == nil {
		return d
	}
	return def
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	svc := &books.Service{
		TTL:       duration("BOOKS_CACHE_TTL", 30*24*time.Hour),
		SearchTTL: duration("SEARCH_CACHE_TTL", 10*time.Minute),
		Colors:    books.HTTPColorExtractor{},
	}

	if url := os.Getenv("DATABASE_URL"); url != "" {
		pool, err := db.Open(ctx, url)
		if err != nil {
			slog.Error("db open", "err", err)
			os.Exit(1)
		}
		defer pool.Close()
		if err := db.Migrate(ctx, pool, migrations.Files); err != nil {
			slog.Error("migrate", "err", err)
			os.Exit(1)
		}
		svc.Store = books.PgStore{Pool: pool}
	} else {
		slog.Warn("DATABASE_URL 없음: 메모리 저장소로 실행")
		svc.Store = books.NewMemStore()
	}

	if key := os.Getenv("KAKAO_REST_KEY"); key != "" {
		svc.Searcher, svc.Source = &books.Kakao{Key: key}, "kakao"
	} else {
		slog.Warn("KAKAO_REST_KEY 없음: 가짜 도서 목록으로 실행")
		svc.Searcher, svc.Source = books.MockSearcher{}, "mock"
		svc.Detailer = books.MockDetailer{}
	}

	keys, err := llm.ParseKeys(os.Getenv("LLM_KEYS"))
	if err != nil {
		slog.Error("LLM_KEYS", "err", err)
		os.Exit(1)
	}
	gw := llm.New(llm.Config{Keys: keys, Models: map[llm.Provider]string{
		llm.Gemini: os.Getenv("GEMINI_MODEL"),
		llm.OpenAI: os.Getenv("OPENAI_MODEL"),
	}})
	slog.Info("llm keys", "registered", len(keys), "usable", gw.Available())

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "books": svc.Source, "llmKeys": gw.Available()})
	})
	svc.Routes(mux)

	srv := &http.Server{Addr: ":" + env("PORT", "8080"), Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	slog.Info("listening", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve", "err", err)
		os.Exit(1)
	}
}
