package com.chaekjang.server.llm;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.chaekjang.server.llm.LlmException.Kind;

/**
 * Gemini·GPT 키 여러 개를 등록 순서대로 쓰고, 한도·오류가 나면 다음 키로 넘기는 게이트웨이다.
 * 키는 서버에만 둔다(앱 → 서버 → LLM).
 */
public class LlmGateway {

    private static final Logger log = LoggerFactory.getLogger(LlmGateway.class);

    private final Map<Provider, String> models;
    private final Map<Provider, LlmClient> clients;
    private final Duration timeout; // 키 하나당 호출 시간 한도
    private final Clock clock;
    private final List<LlmKey> keys = new ArrayList<>();
    private final Map<String, Instant> cool = new HashMap<>(); // label → 이때까지 쉼

    /**
     * @param models GEMINI_MODEL, OPENAI_MODEL. 비어 있으면 그 제공자 키는 건너뛴다.
     * @param clients null이면 실제 HTTP 클라이언트를 쓴다.
     */
    public LlmGateway(List<LlmKey> allKeys, Map<Provider, String> models, Map<Provider, LlmClient> clients,
            Duration timeout, Clock clock) {
        if (clients == null) {
            HttpClient http = HttpClient.newHttpClient();
            clients = Map.of(Provider.GEMINI, new GeminiClient(http), Provider.OPENAI, new OpenAiClient(http));
        }
        this.models = models;
        this.clients = clients;
        this.timeout = timeout == null ? Duration.ofSeconds(40) : timeout;
        this.clock = clock == null ? Clock.systemUTC() : clock;
        for (LlmKey k : allKeys) {
            String model = models.get(k.provider());
            if (model == null || model.isEmpty() || clients.get(k.provider()) == null) {
                log.warn("llm key skipped: model not configured key={}", k.label());
                continue;
            }
            keys.add(k);
        }
    }

    /** 쓸 수 있는 키 수. */
    public int available() {
        return keys.size();
    }

    /** 쉬는 중이 아닌 키를 등록 순서대로, 모두 쉬는 중이면 가장 먼저 풀리는 순서로. */
    private synchronized List<LlmKey> order() {
        Instant now = clock.instant();
        List<LlmKey> ready = new ArrayList<>();
        List<LlmKey> cooling = new ArrayList<>();
        for (LlmKey k : keys) {
            Instant until = cool.get(k.label());
            if (until != null && now.isBefore(until)) cooling.add(k);
            else ready.add(k);
        }
        if (!ready.isEmpty()) return ready;
        cooling.sort(Comparator.comparing(k -> cool.get(k.label()))); // 안정 정렬
        return cooling;
    }

    private synchronized void rest(LlmKey k, Kind kind) {
        Duration d = LlmException.COOLDOWNS.get(kind);
        if (d != null) cool.put(k.label(), clock.instant().plus(d));
    }

    /** 첫 번째 키부터 시도하고, 한도·토큰·서버 오류면 다음 키로 넘긴다. */
    public LlmResponse generate(LlmRequest req) {
        List<LlmKey> order = order();
        if (order.isEmpty()) throw new NoKeysException();
        List<String> errs = new ArrayList<>();
        for (LlmKey k : order) {
            if (Thread.currentThread().isInterrupted()) break;
            try {
                String text = clients.get(k.provider()).generate(k, models.get(k.provider()), req, timeout);
                return new LlmResponse(text, k.provider(), k.label());
            } catch (Exception e) {
                LlmException le = asLlmException(k.provider(), e);
                log.warn("llm call failed key={} kind={} status={}", k.label(), le.kind(), le.status());
                errs.add(k.label() + ": " + le.getMessage());
                if (!le.fallback()) throw le;
                rest(k, le.kind());
            }
        }
        throw new IllegalStateException("llm: 모든 키 실패: " + String.join("; ", errs));
    }

    private static LlmException asLlmException(Provider p, Exception e) {
        if (e instanceof LlmException le) return le;
        if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        if (e instanceof HttpTimeoutException) return new LlmException(Kind.TIMEOUT, 0, p, e.getMessage());
        if (e instanceof IOException) return new LlmException(Kind.NETWORK, 0, p, String.valueOf(e.getMessage()));
        return new LlmException(Kind.NETWORK, 0, p, e.toString());
    }
}
