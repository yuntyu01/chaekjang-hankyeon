// Package httpx는 JSON 응답과 통일된 오류 형식을 제공한다.
// 오류: {"error": {"code": "...", "message": "..."}}
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func NewError(status int, code, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

var (
	ErrNotFound   = NewError(http.StatusNotFound, "not_found", "찾을 수 없어요")
	ErrBadRequest = NewError(http.StatusBadRequest, "bad_request", "요청 형식이 올바르지 않아요")
	ErrUpstream   = NewError(http.StatusBadGateway, "upstream_error", "외부 서비스 응답이 없어요")
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if !errors.As(err, &e) {
		slog.Error("internal error", "path", r.URL.Path, "err", err)
		e = NewError(http.StatusInternalServerError, "internal", "서버 오류가 났어요")
	}
	JSON(w, e.Status, map[string]*Error{"error": e})
}

// Handler는 오류를 반환하는 핸들러를 http.Handler로 바꾼다.
type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		Fail(w, r, err)
	}
}
