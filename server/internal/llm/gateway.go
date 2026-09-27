package llm

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

type Request struct {
	Prompt    string
	Image     []byte // 선택. 긴 변 1024px로 줄인 사진
	MimeType  string // image/jpeg 등
	JSON      bool   // JSON 응답 강제
	MaxTokens int
}

type Response struct {
	Text     string
	Provider Provider
	KeyLabel string
}

// Client는 제공자별 호출 구현.
type Client interface {
	Generate(ctx context.Context, key Key, model string, req Request) (string, error)
}

type Config struct {
	Keys    []Key
	Models  map[Provider]string // GEMINI_MODEL, OPENAI_MODEL. 비어 있으면 그 제공자 키는 건너뛴다.
	Clients map[Provider]Client
	Timeout time.Duration // 키 하나당 호출 시간 한도
	Now     func() time.Time
}

type Gateway struct {
	cfg  Config
	keys []Key
	mu   sync.Mutex
	cool map[string]time.Time // Label → 이때까지 쉼
}

func New(cfg Config) *Gateway {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 40 * time.Second
	}
	if cfg.Clients == nil {
		hc := &http.Client{}
		cfg.Clients = map[Provider]Client{Gemini: &GeminiClient{HTTP: hc}, OpenAI: &OpenAIClient{HTTP: hc}}
	}
	g := &Gateway{cfg: cfg, cool: map[string]time.Time{}}
	for _, k := range cfg.Keys {
		if cfg.Models[k.Provider] == "" || cfg.Clients[k.Provider] == nil {
			slog.Warn("llm key skipped: model not configured", "key", k.Label)
			continue
		}
		g.keys = append(g.keys, k)
	}
	return g
}

// Available: 쓸 수 있는 키 수.
func (g *Gateway) Available() int { return len(g.keys) }

// order: 쉬는 중이 아닌 키를 등록 순서대로, 모두 쉬는 중이면 가장 먼저 풀리는 순서로.
func (g *Gateway) order() []Key {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.cfg.Now()
	var ready, cooling []Key
	for _, k := range g.keys {
		if until, ok := g.cool[k.Label]; ok && now.Before(until) {
			cooling = append(cooling, k)
		} else {
			ready = append(ready, k)
		}
	}
	if len(ready) > 0 {
		return ready
	}
	for i := 1; i < len(cooling); i++ {
		for j := i; j > 0 && g.cool[cooling[j].Label].Before(g.cool[cooling[j-1].Label]); j-- {
			cooling[j], cooling[j-1] = cooling[j-1], cooling[j]
		}
	}
	return cooling
}

func (g *Gateway) rest(k Key, kind Kind) {
	d, ok := cooldowns[kind]
	if !ok {
		return
	}
	g.mu.Lock()
	g.cool[k.Label] = g.cfg.Now().Add(d)
	g.mu.Unlock()
}

// Generate는 첫 번째 키부터 시도하고, 한도·토큰·서버 오류면 다음 키로 넘긴다.
func (g *Gateway) Generate(ctx context.Context, req Request) (*Response, error) {
	keys := g.order()
	if len(keys) == 0 {
		return nil, ErrNoKeys
	}
	var errs []error
	for _, k := range keys {
		if ctx.Err() != nil {
			break
		}
		cctx, cancel := context.WithTimeout(ctx, g.cfg.Timeout)
		text, err := g.cfg.Clients[k.Provider].Generate(cctx, k, g.cfg.Models[k.Provider], req)
		cancel()
		if err == nil {
			return &Response{Text: text, Provider: k.Provider, KeyLabel: k.Label}, nil
		}
		le := asLLMError(k.Provider, err, ctx)
		slog.Warn("llm call failed", "key", k.Label, "kind", le.Kind, "status", le.Status)
		errs = append(errs, fmt.Errorf("%s: %w", k.Label, le))
		if !le.Fallback() {
			return nil, le
		}
		g.rest(k, le.Kind)
	}
	return nil, fmt.Errorf("llm: 모든 키 실패: %w", errors.Join(errs...))
}

func asLLMError(p Provider, err error, parent context.Context) *Error {
	var le *Error
	if errors.As(err, &le) {
		return le
	}
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) && parent.Err() == nil || errors.As(err, &ne) && ne.Timeout() {
		return &Error{Kind: KindTimeout, Provider: p, Msg: err.Error()}
	}
	return &Error{Kind: KindNetwork, Provider: p, Msg: err.Error()}
}
