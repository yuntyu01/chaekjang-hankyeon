package llm

import (
	"errors"
	"fmt"
	"time"
)

type Kind string

const (
	KindQuota      Kind = "quota"       // 429, 사용량·요금 한도
	KindAuth       Kind = "auth"        // 401/403, 키 문제
	KindServer     Kind = "server"      // 5xx
	KindTimeout    Kind = "timeout"     // 응답 없음
	KindTokens     Kind = "tokens"      // 입력/출력 토큰 한도
	KindBlocked    Kind = "blocked"     // 안전 필터 등으로 응답 거부
	KindNetwork    Kind = "network"     // 연결 실패
	KindBadRequest Kind = "bad_request" // 요청 자체가 잘못됨(다른 키로도 같음)
)

type Error struct {
	Kind     Kind
	Status   int
	Provider Provider
	Msg      string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s %s (%d): %s", e.Provider, e.Kind, e.Status, e.Msg)
}

// Fallback: 다음 키로 넘겨도 되는 오류인가. 요청 자체가 잘못된 경우만 멈춘다.
func (e *Error) Fallback() bool { return e.Kind != KindBadRequest }

// 실패한 키를 쉬게 하는 시간.
var cooldowns = map[Kind]time.Duration{
	KindQuota:   time.Minute,
	KindAuth:    30 * time.Minute,
	KindServer:  15 * time.Second,
	KindTimeout: 15 * time.Second,
	KindNetwork: 15 * time.Second,
}

var ErrNoKeys = errors.New("llm: 사용할 수 있는 키가 없어요")

func classifyStatus(p Provider, status int, msg string) *Error {
	k := KindBadRequest
	switch {
	case status == 429:
		k = KindQuota
	case status == 401 || status == 403:
		k = KindAuth
	case status == 408 || status == 504:
		k = KindTimeout
	case status >= 500:
		k = KindServer
	}
	return &Error{Kind: k, Status: status, Provider: p, Msg: msg}
}
