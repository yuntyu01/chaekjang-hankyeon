package books

import (
	"net/http"

	"github.com/yuntyu01/chaekjang-hankyeon/server/internal/httpx"
)

func (s *Service) Routes(mux *http.ServeMux) {
	mux.Handle("GET /books/search", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		items, err := s.Search(r.Context(), r.URL.Query().Get("q"))
		if err != nil {
			return err
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
		return nil
	}))
	mux.Handle("GET /books/{isbn13}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		b, err := s.Get(r.Context(), r.PathValue("isbn13"))
		if err != nil {
			return err
		}
		httpx.JSON(w, http.StatusOK, b)
		return nil
	}))
}
