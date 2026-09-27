// Package llm은 Gemini·GPT 키 여러 개를 등록 순서대로 쓰고, 한도·오류가 나면 다음 키로 넘기는 게이트웨이다.
// 키는 서버에만 둔다(앱 → Go → LLM).
package llm

import (
	"fmt"
	"strings"
)

type Provider string

const (
	Gemini Provider = "gemini"
	OpenAI Provider = "openai"
)

type Key struct {
	Provider Provider
	Secret   string
	Label    string // 로그용: "gemini#1" (비밀값은 로그에 남기지 않는다)
}

// DetectProvider는 키 형식으로 제공자를 고른다. Gemini(Google AI Studio) 키는 "AIza", OpenAI 키는 "sk-"로 시작한다.
func DetectProvider(secret string) (Provider, bool) {
	switch {
	case strings.HasPrefix(secret, "AIza"):
		return Gemini, true
	case strings.HasPrefix(secret, "sk-"):
		return OpenAI, true
	}
	return "", false
}

// ParseKeys는 LLM_KEYS(쉼표·줄바꿈 구분)를 읽는다. 순서가 곧 우선순위다.
// 형식을 알 수 없는 키는 "gemini:키" 또는 "openai:키"처럼 제공자를 붙여 쓴다.
func ParseKeys(raw string) ([]Key, error) {
	var keys []Key
	count := map[Provider]int{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' }) {
		s := strings.TrimSpace(part)
		if s == "" {
			continue
		}
		var p Provider
		if name, rest, ok := strings.Cut(s, ":"); ok && (name == string(Gemini) || name == string(OpenAI)) {
			p, s = Provider(name), strings.TrimSpace(rest)
		} else if d, ok := DetectProvider(s); ok {
			p = d
		} else {
			return nil, fmt.Errorf("LLM_KEYS %d번째 키: 제공자를 알 수 없어요(앞에 gemini: 또는 openai: 를 붙여 주세요)", len(keys)+1)
		}
		count[p]++
		keys = append(keys, Key{Provider: p, Secret: s, Label: fmt.Sprintf("%s#%d", p, count[p])})
	}
	return keys, nil
}
