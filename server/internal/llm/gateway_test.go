package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fake는 키별로 정해 둔 응답을 돌려주는 가짜 Gemini/OpenAI 서버.
type fake struct {
	mu    sync.Mutex
	plan  map[string]func(w http.ResponseWriter) // 키 → 응답
	calls []string
}

func (f *fake) handler(p Provider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("x-goog-api-key")
		if p == OpenAI {
			key = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		}
		f.mu.Lock()
		f.calls = append(f.calls, key)
		h := f.plan[key]
		f.mu.Unlock()
		h(w)
	}
}

func geminiOK(text string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{
			"content": map[string]any{"parts": []any{map[string]string{"text": text}}}, "finishReason": "STOP"}}})
	}
}

func openaiOK(text string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"message": map[string]string{"content": text}, "finish_reason": "stop"}}})
	}
}

func status(code int, body string) func(http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func setup(t *testing.T, raw string, plan map[string]func(http.ResponseWriter)) (*Gateway, *fake, *clock) {
	t.Helper()
	f := &fake{plan: plan}
	gs := httptest.NewServer(f.handler(Gemini))
	os := httptest.NewServer(f.handler(OpenAI))
	t.Cleanup(gs.Close)
	t.Cleanup(os.Close)
	keys, err := ParseKeys(raw)
	if err != nil {
		t.Fatal(err)
	}
	c := &clock{t: time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)}
	g := New(Config{
		Keys:    keys,
		Models:  map[Provider]string{Gemini: "gemini-test", OpenAI: "gpt-test"},
		Clients: map[Provider]Client{Gemini: &GeminiClient{HTTP: gs.Client(), BaseURL: gs.URL}, OpenAI: &OpenAIClient{HTTP: os.Client(), BaseURL: os.URL}},
		Timeout: 300 * time.Millisecond,
		Now:     c.now,
	})
	return g, f, c
}

func TestParseKeys(t *testing.T) {
	keys, err := ParseKeys("AIzaA, sk-B\nAIzaC,openai:custom-D")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"gemini#1", "openai#1", "gemini#2", "openai#2"}
	for i, k := range keys {
		if k.Label != want[i] {
			t.Fatalf("%d: %s want %s", i, k.Label, want[i])
		}
	}
	if keys[3].Secret != "custom-D" || keys[1].Provider != OpenAI {
		t.Fatalf("%+v", keys)
	}
	if _, err := ParseKeys("mystery-key"); err == nil || strings.Contains(err.Error(), "mystery") {
		t.Fatal("unknown key must fail without echoing the secret")
	}
}

func TestFirstKeyWins(t *testing.T) {
	g, f, _ := setup(t, "AIza1,sk-2", map[string]func(http.ResponseWriter){"AIza1": geminiOK(`{"ok":1}`), "sk-2": openaiOK("x")})
	r, err := g.Generate(context.Background(), Request{Prompt: "p", JSON: true})
	if err != nil || r.Text != `{"ok":1}` || r.KeyLabel != "gemini#1" || len(f.calls) != 1 {
		t.Fatalf("%v %+v %v", err, r, f.calls)
	}
}

func TestFallbackOnQuotaTokensAndServer(t *testing.T) {
	g, f, _ := setup(t, "AIza1,AIza2,sk-3,sk-4", map[string]func(http.ResponseWriter){
		"AIza1": status(429, `{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}`),
		"AIza2": func(w http.ResponseWriter) {
			_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{}}, "finishReason": "MAX_TOKENS"}}})
		},
		"sk-3": status(503, `{"error":{"message":"overloaded"}}`),
		"sk-4": openaiOK("done"),
	})
	r, err := g.Generate(context.Background(), Request{Prompt: "p"})
	if err != nil || r.KeyLabel != "openai#2" {
		t.Fatalf("%v %+v", err, r)
	}
	if strings.Join(f.calls, ",") != "AIza1,AIza2,sk-3,sk-4" {
		t.Fatalf("calls %v", f.calls)
	}
}

func TestOpenAITokenLimitFallsBack(t *testing.T) {
	g, _, _ := setup(t, "sk-1,AIza2", map[string]func(http.ResponseWriter){
		"sk-1":  status(400, `{"error":{"message":"too long","code":"context_length_exceeded"}}`),
		"AIza2": geminiOK("ok"),
	})
	if r, err := g.Generate(context.Background(), Request{Prompt: "p"}); err != nil || r.KeyLabel != "gemini#1" {
		t.Fatalf("%v %+v", err, r)
	}
}

func TestBadRequestStops(t *testing.T) {
	g, f, _ := setup(t, "AIza1,sk-2", map[string]func(http.ResponseWriter){
		"AIza1": status(400, `{"error":{"message":"bad image","status":"INVALID_ARGUMENT"}}`),
		"sk-2":  openaiOK("never"),
	})
	_, err := g.Generate(context.Background(), Request{Prompt: "p"})
	var le *Error
	if !errors.As(err, &le) || le.Kind != KindBadRequest || len(f.calls) != 1 {
		t.Fatalf("%v %v", err, f.calls)
	}
}

func TestTimeoutFallsBack(t *testing.T) {
	g, _, _ := setup(t, "AIza1,sk-2", map[string]func(http.ResponseWriter){
		"AIza1": func(w http.ResponseWriter) { time.Sleep(500 * time.Millisecond); geminiOK("late")(w) },
		"sk-2":  openaiOK("fast"),
	})
	if r, err := g.Generate(context.Background(), Request{Prompt: "p"}); err != nil || r.Text != "fast" {
		t.Fatalf("%v %+v", err, r)
	}
}

func TestCooldownSkipsFailedKey(t *testing.T) {
	g, f, c := setup(t, "AIza1,sk-2", map[string]func(http.ResponseWriter){
		"AIza1": status(429, `{"error":{"message":"quota"}}`),
		"sk-2":  openaiOK("ok"),
	})
	ctx := context.Background()
	_, _ = g.Generate(ctx, Request{Prompt: "p"})
	_, _ = g.Generate(ctx, Request{Prompt: "p"}) // 쉬는 중이라 AIza1 건너뜀
	if strings.Join(f.calls, ",") != "AIza1,sk-2,sk-2" {
		t.Fatalf("calls %v", f.calls)
	}
	c.t = c.t.Add(2 * time.Minute) // 쉬는 시간이 지나면 다시 첫 키부터
	_, _ = g.Generate(ctx, Request{Prompt: "p"})
	if f.calls[len(f.calls)-2] != "AIza1" {
		t.Fatalf("calls %v", f.calls)
	}
}

func TestAllFailAndNoKeys(t *testing.T) {
	g, _, _ := setup(t, "AIza1,sk-2", map[string]func(http.ResponseWriter){
		"AIza1": status(500, `{}`),
		"sk-2":  status(401, `{"error":{"message":"bad key"}}`),
	})
	_, err := g.Generate(context.Background(), Request{Prompt: "p"})
	if err == nil || !strings.Contains(err.Error(), "gemini#1") || !strings.Contains(err.Error(), "openai#1") || strings.Contains(err.Error(), "AIza1") {
		t.Fatalf("err %v", err)
	}
	empty := New(Config{Models: map[Provider]string{}})
	if _, err := empty.Generate(context.Background(), Request{}); !errors.Is(err, ErrNoKeys) {
		t.Fatal(err)
	}
	// 모델이 설정 안 된 제공자의 키는 건너뛴다
	keys, _ := ParseKeys("AIza1,sk-2")
	if n := New(Config{Keys: keys, Models: map[Provider]string{OpenAI: "gpt"}}).Available(); n != 1 {
		t.Fatalf("available %d", n)
	}
}

func TestImageIsSent(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&got)
		geminiOK("ok")(w)
	}))
	defer srv.Close()
	c := &GeminiClient{HTTP: srv.Client(), BaseURL: srv.URL}
	if _, err := c.Generate(context.Background(), Key{Secret: "AIza"}, "m", Request{Prompt: "p", Image: []byte{1, 2}, MimeType: "image/jpeg", JSON: true}); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(got)
	if !strings.Contains(string(b), `"inline_data":{"data":"AQI=","mime_type":"image/jpeg"}`) || !strings.Contains(string(b), "application/json") {
		t.Fatalf("body %s", b)
	}
}
