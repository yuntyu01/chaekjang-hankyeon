package com.chaekjang.server.llm;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * @param label 로그용: "gemini#1" (비밀값은 로그에 남기지 않는다)
 */
public record LlmKey(Provider provider, String secret, String label) {

    @Override
    public String toString() {
        return label;
    }

    /** 키 형식으로 제공자를 고른다. Gemini(Google AI Studio) 키는 "AIza", OpenAI 키는 "sk-"로 시작한다. */
    public static Optional<Provider> detectProvider(String secret) {
        if (secret.startsWith("AIza")) return Optional.of(Provider.GEMINI);
        if (secret.startsWith("sk-")) return Optional.of(Provider.OPENAI);
        return Optional.empty();
    }

    /**
     * LLM_KEYS(쉼표·줄바꿈 구분)를 읽는다. 순서가 곧 우선순위다.
     * 형식을 알 수 없는 키는 "gemini:키" 또는 "openai:키"처럼 제공자를 붙여 쓴다.
     */
    public static List<LlmKey> parse(String raw) {
        List<LlmKey> keys = new ArrayList<>();
        Map<Provider, Integer> count = new EnumMap<>(Provider.class);
        for (String part : (raw == null ? "" : raw).split("[,\\n]")) {
            String s = part.strip();
            if (s.isEmpty()) continue;
            Provider p = null;
            int colon = s.indexOf(':');
            if (colon >= 0) {
                String name = s.substring(0, colon);
                for (Provider candidate : Provider.values()) {
                    if (candidate.id().equals(name)) {
                        p = candidate;
                        s = s.substring(colon + 1).strip();
                    }
                }
            }
            if (p == null) {
                p = detectProvider(s).orElseThrow(() -> new IllegalArgumentException(
                        "LLM_KEYS 쉼표로 구분한 키 중 제공자를 알 수 없는 키가 있어요(앞에 gemini: 또는 openai: 를 붙여 주세요)"));
            }
            int n = count.merge(p, 1, Integer::sum);
            keys.add(new LlmKey(p, s, p.id() + "#" + n));
        }
        return keys;
    }
}
