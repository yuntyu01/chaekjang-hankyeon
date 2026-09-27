package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func post(ctx context.Context, hc *http.Client, url string, headers map[string]string, body any) (int, []byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	return res.StatusCode, data, err
}

// 오류 본문에서 메시지만 뽑는다(키 값은 들어 있지 않다).
func errMessage(data []byte) (msg, code string) {
	var e struct {
		Error struct {
			Message string `json:"message"`
			Status  string `json:"status"`
			Code    any    `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &e)
	code = e.Error.Status
	if s, ok := e.Error.Code.(string); ok {
		code = s
	}
	return e.Error.Message, code
}

// GeminiClient: Gemini API generateContent (REST).
type GeminiClient struct {
	HTTP    *http.Client
	BaseURL string // 기본 https://generativelanguage.googleapis.com
}

func (c *GeminiClient) Generate(ctx context.Context, key Key, model string, req Request) (string, error) {
	base := c.BaseURL
	if base == "" {
		base = "https://generativelanguage.googleapis.com"
	}
	parts := []map[string]any{{"text": req.Prompt}}
	if len(req.Image) > 0 {
		parts = append(parts, map[string]any{"inline_data": map[string]string{
			"mime_type": req.MimeType, "data": base64.StdEncoding.EncodeToString(req.Image),
		}})
	}
	gen := map[string]any{}
	if req.JSON {
		gen["responseMimeType"] = "application/json"
	}
	if req.MaxTokens > 0 {
		gen["maxOutputTokens"] = req.MaxTokens
	}
	status, data, err := post(ctx, c.HTTP, base+"/v1beta/models/"+model+":generateContent",
		map[string]string{"x-goog-api-key": key.Secret},
		map[string]any{"contents": []any{map[string]any{"parts": parts}}, "generationConfig": gen})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		msg, _ := errMessage(data)
		return "", classifyStatus(Gemini, status, msg)
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", &Error{Kind: KindServer, Status: status, Provider: Gemini, Msg: "응답 해석 실패"}
	}
	if out.PromptFeedback.BlockReason != "" || len(out.Candidates) == 0 {
		return "", &Error{Kind: KindBlocked, Status: status, Provider: Gemini, Msg: out.PromptFeedback.BlockReason}
	}
	cand := out.Candidates[0]
	if cand.FinishReason == "MAX_TOKENS" {
		return "", &Error{Kind: KindTokens, Status: status, Provider: Gemini, Msg: "MAX_TOKENS"}
	}
	var sb strings.Builder
	for _, p := range cand.Content.Parts {
		sb.WriteString(p.Text)
	}
	if sb.Len() == 0 {
		return "", &Error{Kind: KindBlocked, Status: status, Provider: Gemini, Msg: cand.FinishReason}
	}
	return sb.String(), nil
}

// OpenAIClient: Chat Completions API.
type OpenAIClient struct {
	HTTP    *http.Client
	BaseURL string // 기본 https://api.openai.com
}

func (c *OpenAIClient) Generate(ctx context.Context, key Key, model string, req Request) (string, error) {
	base := c.BaseURL
	if base == "" {
		base = "https://api.openai.com"
	}
	content := []map[string]any{{"type": "text", "text": req.Prompt}}
	if len(req.Image) > 0 {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]string{
			"url": "data:" + req.MimeType + ";base64," + base64.StdEncoding.EncodeToString(req.Image),
		}})
	}
	body := map[string]any{
		"model":    model,
		"messages": []any{map[string]any{"role": "user", "content": content}},
	}
	if req.JSON {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	if req.MaxTokens > 0 {
		body["max_completion_tokens"] = req.MaxTokens
	}
	status, data, err := post(ctx, c.HTTP, base+"/v1/chat/completions", map[string]string{"Authorization": "Bearer " + key.Secret}, body)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		msg, code := errMessage(data)
		e := classifyStatus(OpenAI, status, msg)
		if code == "context_length_exceeded" {
			e.Kind = KindTokens
		}
		return "", e
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
				Refusal string `json:"refusal"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &out); err != nil || len(out.Choices) == 0 {
		return "", &Error{Kind: KindServer, Status: status, Provider: OpenAI, Msg: "응답 해석 실패"}
	}
	ch := out.Choices[0]
	switch {
	case ch.FinishReason == "length":
		return "", &Error{Kind: KindTokens, Status: status, Provider: OpenAI, Msg: "length"}
	case ch.Message.Refusal != "" || ch.FinishReason == "content_filter":
		return "", &Error{Kind: KindBlocked, Status: status, Provider: OpenAI, Msg: ch.FinishReason}
	}
	return ch.Message.Content, nil
}
