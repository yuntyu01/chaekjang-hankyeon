package llm

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestFallbackAndCooldown(t *testing.T) {
	var mu sync.Mutex
	calls := []string{}
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		key := r.Header.Get("Authorization")
		calls = append(calls, key)
		status := 200
		body := `{"choices":[{"finish_reason":"stop","message":{"content":"ok"}}]}`
		if key == "Bearer sk-first" {
			status = 429
			body = `{"error":{"message":"quota"}}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	g, e := New("sk-first,sk-second", "", "model", client)
	if e != nil {
		t.Fatal(e)
	}
	if g.Available() != 2 {
		t.Fatal(g.Available())
	}
	for i := 0; i < 2; i++ {
		out, e := g.Generate(context.Background(), Request{Prompt: "hello", JSON: true})
		if e != nil || out.Text != "ok" || out.KeyLabel != "openai#2" {
			t.Fatalf("%+v %v", out, e)
		}
	}
	if len(calls) != 3 || calls[0] != "Bearer sk-first" || calls[2] != "Bearer sk-second" {
		t.Fatalf("cooldown calls: %v", calls)
	}
}
func TestBadRequestStopsFallback(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 400, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"bad"}}`)), Header: make(http.Header)}, nil
	})}
	g, e := New("gemini:one,openai:two", "gemini-model", "openai-model", client)
	if e != nil {
		t.Fatal(e)
	}
	_, e = g.Generate(context.Background(), Request{Prompt: "hi"})
	if e == nil || calls != 1 {
		t.Fatalf("error=%v calls=%d", e, calls)
	}
}
func TestKeyConfiguration(t *testing.T) {
	if _, e := New("unknown", "x", "x", nil); e == nil {
		t.Fatal("invalid key accepted")
	}
	g, e := New("AIzaabc,sk-test", "", "model", nil)
	if e != nil || g.Available() != 1 {
		t.Fatalf("gateway=%+v error=%v", g, e)
	}
}
