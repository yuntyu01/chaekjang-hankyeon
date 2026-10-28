package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/server"
)

func normalizeDatabaseURL(url string) string {
	url = strings.TrimPrefix(url, "jdbc:")
	if strings.HasPrefix(url, "postgresql+psycopg2://") {
		return "postgresql://" + strings.TrimPrefix(url, "postgresql+psycopg2://")
	}
	return url
}

func main() {
	ctx := context.Background()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	url = normalizeDatabaseURL(url)
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		// pgx parse errors may contain the original URL, including its password.
		log.Fatal("DATABASE_URL is invalid; check its format")
	}
	defer db.Close()
	if err = db.Ping(ctx); err != nil {
		log.Fatal(err)
	}
	if err = server.Migrate(ctx, db); err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	app := server.New(db)
	if app.ConfigError != nil {
		log.Fatal(app.ConfigError)
	}
	// 복원된 DB에 과거 삭제 요청을 다시 적용한 뒤에만 요청을 받는다.
	if err = app.InitializeDeletion(ctx); err != nil {
		log.Fatal("account deletion journal initialization failed")
	}
	app.StartDeletionWorker(ctx)
	srv := &http.Server{Addr: ":" + port, Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}
