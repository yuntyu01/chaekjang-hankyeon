// Package llm implements the server-side provider fallback used by the Java server.
package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

type Request struct {
	Prompt    string
	Image     []byte
	MIMEType  string
	JSON      bool
	MaxTokens int
}
type Response struct{ Text, Provider, KeyLabel string }
type key struct{ provider, secret, label, model string }
type Error struct {
	Kind     string
	Status   int
	Provider string
	Message  string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s %s (%d): %s", e.Provider, e.Kind, e.Status, e.Message)
}

type Gateway struct {
	keys   []key
	client *http.Client
	mu     sync.Mutex
	cool   map[string]time.Time
}

func New(raw, geminiModel, openaiModel string, client *http.Client) (*Gateway, error) {
	g := &Gateway{client: client, cool: map[string]time.Time{}}
	if g.client == nil {
		g.client = &http.Client{Timeout: 40 * time.Second}
	}
	counts := map[string]int{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' }) {
		secret := strings.TrimSpace(part)
		if secret == "" {
			continue
		}
		provider := ""
		if strings.HasPrefix(secret, "gemini:") {
			provider = "gemini"
			secret = strings.TrimSpace(strings.TrimPrefix(secret, "gemini:"))
		} else if strings.HasPrefix(secret, "openai:") {
			provider = "openai"
			secret = strings.TrimSpace(strings.TrimPrefix(secret, "openai:"))
		} else if strings.HasPrefix(secret, "AIza") {
			provider = "gemini"
		} else if strings.HasPrefix(secret, "sk-") {
			provider = "openai"
		} else {
			return nil, errors.New("LLM_KEYS에 알 수 없는 키 형식이 있어요")
		}
		counts[provider]++
		model := openaiModel
		if provider == "gemini" {
			model = geminiModel
		}
		if model != "" {
			g.keys = append(g.keys, key{provider, secret, fmt.Sprintf("%s#%d", provider, counts[provider]), model})
		}
	}
	return g, nil
}
func (g *Gateway) Available() int { return len(g.keys) }
func (g *Gateway) order() []key {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	ready := []key{}
	cool := []key{}
	for _, k := range g.keys {
		if now.Before(g.cool[k.label]) {
			cool = append(cool, k)
		} else {
			ready = append(ready, k)
		}
	}
	if len(ready) > 0 {
		return ready
	}
	sort.SliceStable(cool, func(i, j int) bool { return g.cool[cool[i].label].Before(g.cool[cool[j].label]) })
	return cool
}
func (g *Gateway) rest(k key, kind string) {
	d := map[string]time.Duration{"quota": time.Minute, "auth": 30 * time.Minute, "server": 15 * time.Second, "timeout": 15 * time.Second, "network": 15 * time.Second}[kind]
	if d > 0 {
		g.mu.Lock()
		g.cool[k.label] = time.Now().Add(d)
		g.mu.Unlock()
	}
}
func (g *Gateway) Generate(ctx context.Context, request Request) (Response, error) {
	order := g.order()
	if len(order) == 0 {
		return Response{}, errors.New("LLM 키가 설정되지 않았어요")
	}
	var last error
	for _, k := range order {
		if ctx.Err() != nil {
			return Response{}, ctx.Err()
		}
		text, err := g.call(ctx, k, request)
		if err == nil {
			return Response{text, k.provider, k.label}, nil
		}
		last = err
		var le *Error
		if errors.As(err, &le) {
			if le.Kind == "bad_request" {
				return Response{}, err
			}
			g.rest(k, le.Kind)
		} else {
			g.rest(k, "network")
		}
	}
	return Response{}, fmt.Errorf("llm: 모든 키 실패: %w", last)
}
func statusError(provider string, status int, msg, code string) *Error {
	kind := "bad_request"
	switch {
	case code == "context_length_exceeded":
		kind = "tokens"
	case status == 429:
		kind = "quota"
	case status == 401 || status == 403:
		kind = "auth"
	case status == 408 || status == 504:
		kind = "timeout"
	case status >= 500:
		kind = "server"
	}
	return &Error{kind, status, provider, msg}
}
func (g *Gateway) call(ctx context.Context, k key, input Request) (string, error) {
	var endpoint string
	var body map[string]any
	if k.provider == "gemini" {
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + url.PathEscape(k.model) + ":generateContent"
		parts := []any{map[string]any{"text": input.Prompt}}
		if len(input.Image) > 0 {
			parts = append(parts, map[string]any{"inline_data": map[string]any{"mime_type": input.MIMEType, "data": base64.StdEncoding.EncodeToString(input.Image)}})
		}
		gen := map[string]any{}
		if input.JSON {
			gen["responseMimeType"] = "application/json"
		}
		if input.MaxTokens > 0 {
			gen["maxOutputTokens"] = input.MaxTokens
		}
		body = map[string]any{"contents": []any{map[string]any{"parts": parts}}, "generationConfig": gen}
	} else {
		endpoint = "https://api.openai.com/v1/chat/completions"
		parts := []any{map[string]any{"type": "text", "text": input.Prompt}}
		if len(input.Image) > 0 {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + input.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(input.Image)}})
		}
		body = map[string]any{"model": k.model, "messages": []any{map[string]any{"role": "user", "content": parts}}}
		if input.JSON {
			body["response_format"] = map[string]any{"type": "json_object"}
		}
		if input.MaxTokens > 0 {
			body["max_completion_tokens"] = input.MaxTokens
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(encoded))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if k.provider == "gemini" {
		req.Header.Set("x-goog-api-key", k.secret)
	} else {
		req.Header.Set("Authorization", "Bearer "+k.secret)
	}
	res, err := g.client.Do(req)
	if err != nil {
		kind := "network"
		if errors.Is(err, context.DeadlineExceeded) {
			kind = "timeout"
		}
		return "", &Error{kind, 0, k.provider, "요청 실패"}
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return "", &Error{"network", 0, k.provider, "응답 읽기 실패"}
	}
	if res.StatusCode != 200 {
		var j struct {
			Error struct {
				Message string `json:"message"`
				Code    any    `json:"code"`
				Status  string `json:"status"`
			} `json:"error"`
		}
		_ = json.Unmarshal(data, &j)
		code := j.Error.Status
		if c, ok := j.Error.Code.(string); ok {
			code = c
		}
		return "", statusError(k.provider, res.StatusCode, j.Error.Message, code)
	}
	if k.provider == "gemini" {
		var j struct {
			PromptFeedback struct {
				BlockReason string `json:"blockReason"`
			} `json:"promptFeedback"`
			Candidates []struct {
				FinishReason string `json:"finishReason"`
				Content      struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if json.Unmarshal(data, &j) != nil {
			return "", &Error{"server", 200, k.provider, "응답 해석 실패"}
		}
		if j.PromptFeedback.BlockReason != "" || len(j.Candidates) == 0 {
			return "", &Error{"blocked", 200, k.provider, j.PromptFeedback.BlockReason}
		}
		c := j.Candidates[0]
		if c.FinishReason == "MAX_TOKENS" {
			return "", &Error{"tokens", 200, k.provider, "MAX_TOKENS"}
		}
		var out strings.Builder
		for _, p := range c.Content.Parts {
			out.WriteString(p.Text)
		}
		if out.Len() == 0 {
			return "", &Error{"blocked", 200, k.provider, c.FinishReason}
		}
		return out.String(), nil
	}
	var j struct {
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message struct {
				Content string `json:"content"`
				Refusal string `json:"refusal"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &j) != nil || len(j.Choices) == 0 {
		return "", &Error{"server", 200, k.provider, "응답 해석 실패"}
	}
	c := j.Choices[0]
	if c.Finish == "length" {
		return "", &Error{"tokens", 200, k.provider, "length"}
	}
	if c.Message.Refusal != "" || c.Finish == "content_filter" {
		return "", &Error{"blocked", 200, k.provider, c.Finish}
	}
	return c.Message.Content, nil
}
