package com.chaekjang.server.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.chaekjang.server.llm.LlmException.Kind;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

class LlmGatewayTest {

    /** 키별로 정해 둔 응답을 돌려주는 가짜 Gemini/OpenAI 서버. */
    static class Fake {
        final Map<String, Consumer<HttpExchange>> plan;
        final List<String> calls = Collections.synchronizedList(new ArrayList<>());

        Fake(Map<String, Consumer<HttpExchange>> plan) {
            this.plan = plan;
        }

        HttpServer start(Provider p) throws Exception {
            HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            srv.createContext("/", ex -> {
                String key = p == Provider.OPENAI
                        ? ex.getRequestHeaders().getFirst("Authorization").replaceFirst("^Bearer ", "")
                        : ex.getRequestHeaders().getFirst("x-goog-api-key");
                calls.add(key);
                plan.get(key).accept(ex);
                ex.close();
            });
            srv.start();
            return srv;
        }
    }

    static void reply(HttpExchange ex, int code, String body) {
        try {
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(code, b.length == 0 ? -1 : b.length);
            if (b.length > 0) ex.getResponseBody().write(b);
        } catch (java.io.IOException e) {
            throw new RuntimeException(e);
        }
    }

    static Consumer<HttpExchange> geminiOk(String text) {
        return ex -> reply(ex, 200, "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"" + text.replace("\"", "\\\"")
                + "\"}]},\"finishReason\":\"STOP\"}]}");
    }

    static Consumer<HttpExchange> openaiOk(String text) {
        return ex -> reply(ex, 200, "{\"choices\":[{\"message\":{\"content\":\"" + text + "\"},\"finish_reason\":\"stop\"}]}");
    }

    static Consumer<HttpExchange> status(int code, String body) {
        return ex -> reply(ex, code, body);
    }

    static class TestClock extends Clock {
        Instant now = Instant.parse("2026-09-27T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    final List<HttpServer> servers = new ArrayList<>();
    Fake fake;
    TestClock clock = new TestClock();

    @AfterEach
    void stop() {
        servers.forEach(s -> s.stop(0));
    }

    LlmGateway setup(String raw, Map<String, Consumer<HttpExchange>> plan) throws Exception {
        fake = new Fake(plan);
        HttpServer gs = fake.start(Provider.GEMINI), os = fake.start(Provider.OPENAI);
        servers.add(gs);
        servers.add(os);
        var http = HttpClient.newHttpClient();
        return new LlmGateway(LlmKey.parse(raw),
                Map.of(Provider.GEMINI, "gemini-test", Provider.OPENAI, "gpt-test"),
                Map.of(Provider.GEMINI, new GeminiClient(http, "http://127.0.0.1:" + gs.getAddress().getPort()),
                        Provider.OPENAI, new OpenAiClient(http, "http://127.0.0.1:" + os.getAddress().getPort())),
                Duration.ofMillis(300), clock);
    }

    @Test
    void parseKeys() {
        var keys = LlmKey.parse("AIzaA, sk-B\nAIzaC,openai:custom-D");
        assertThat(keys).extracting(LlmKey::label).containsExactly("gemini#1", "openai#1", "gemini#2", "openai#2");
        assertThat(keys.get(3).secret()).isEqualTo("custom-D");
        assertThat(keys.get(1).provider()).isEqualTo(Provider.OPENAI);
        assertThatThrownBy(() -> LlmKey.parse("mystery-key"))
                .isInstanceOf(IllegalArgumentException.class)
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("mystery"));
    }

    @Test
    void firstKeyWins() throws Exception {
        var g = setup("AIza1,sk-2", Map.of("AIza1", geminiOk("{\"ok\":1}"), "sk-2", openaiOk("x")));
        var r = g.generate(new LlmRequest("p", null, null, true, 0));
        assertThat(r.text()).isEqualTo("{\"ok\":1}");
        assertThat(r.keyLabel()).isEqualTo("gemini#1");
        assertThat(fake.calls).hasSize(1);
    }

    @Test
    void fallbackOnQuotaTokensAndServer() throws Exception {
        var g = setup("AIza1,AIza2,sk-3,sk-4", Map.of(
                "AIza1", status(429, "{\"error\":{\"code\":429,\"message\":\"quota\",\"status\":\"RESOURCE_EXHAUSTED\"}}"),
                "AIza2", status(200, "{\"candidates\":[{\"content\":{\"parts\":[]},\"finishReason\":\"MAX_TOKENS\"}]}"),
                "sk-3", status(503, "{\"error\":{\"message\":\"overloaded\"}}"),
                "sk-4", openaiOk("done")));
        var r = g.generate(LlmRequest.of("p"));
        assertThat(r.keyLabel()).isEqualTo("openai#2");
        assertThat(fake.calls).containsExactly("AIza1", "AIza2", "sk-3", "sk-4");
    }

    @Test
    void openAiTokenLimitFallsBack() throws Exception {
        var g = setup("sk-1,AIza2", Map.of(
                "sk-1", status(400, "{\"error\":{\"message\":\"too long\",\"code\":\"context_length_exceeded\"}}"),
                "AIza2", geminiOk("ok")));
        assertThat(g.generate(LlmRequest.of("p")).keyLabel()).isEqualTo("gemini#1");
    }

    @Test
    void badRequestStops() throws Exception {
        var g = setup("AIza1,sk-2", Map.of(
                "AIza1", status(400, "{\"error\":{\"message\":\"bad image\",\"status\":\"INVALID_ARGUMENT\"}}"),
                "sk-2", openaiOk("never")));
        assertThatThrownBy(() -> g.generate(LlmRequest.of("p")))
                .isInstanceOfSatisfying(LlmException.class, e -> assertThat(e.kind()).isEqualTo(Kind.BAD_REQUEST));
        assertThat(fake.calls).hasSize(1);
    }

    @Test
    void timeoutFallsBack() throws Exception {
        var g = setup("AIza1,sk-2", Map.of(
                "AIza1", ex -> {
                    try {
                        Thread.sleep(600);
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                    }
                    geminiOk("late").accept(ex);
                },
                "sk-2", openaiOk("fast")));
        assertThat(g.generate(LlmRequest.of("p")).text()).isEqualTo("fast");
    }

    @Test
    void cooldownSkipsFailedKey() throws Exception {
        var g = setup("AIza1,sk-2", Map.of(
                "AIza1", status(429, "{\"error\":{\"message\":\"quota\"}}"),
                "sk-2", openaiOk("ok")));
        g.generate(LlmRequest.of("p"));
        g.generate(LlmRequest.of("p")); // 쉬는 중이라 AIza1 건너뜀
        assertThat(fake.calls).containsExactly("AIza1", "sk-2", "sk-2");
        clock.now = clock.now.plus(Duration.ofMinutes(2)); // 쉬는 시간이 지나면 다시 첫 키부터
        g.generate(LlmRequest.of("p"));
        assertThat(fake.calls.get(fake.calls.size() - 2)).isEqualTo("AIza1");
    }

    @Test
    void allFailAndNoKeys() throws Exception {
        var g = setup("AIza1,sk-2", Map.of(
                "AIza1", status(500, "{}"),
                "sk-2", status(401, "{\"error\":{\"message\":\"bad key\"}}")));
        assertThatThrownBy(() -> g.generate(LlmRequest.of("p")))
                .hasMessageContaining("gemini#1").hasMessageContaining("openai#1").hasMessageNotContaining("AIza1");
        var empty = new LlmGateway(List.of(), Map.of(), null, null, null);
        assertThatThrownBy(() -> empty.generate(LlmRequest.of("p"))).isInstanceOf(NoKeysException.class);
        // 모델이 설정 안 된 제공자의 키는 건너뛴다
        var one = new LlmGateway(LlmKey.parse("AIza1,sk-2"), Map.of(Provider.OPENAI, "gpt"), null, null, null);
        assertThat(one.available()).isEqualTo(1);
    }

    @Test
    void imageIsSent() throws Exception {
        var body = new java.util.concurrent.atomic.AtomicReference<String>();
        HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            try {
                body.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            } catch (java.io.IOException e) {
                throw new RuntimeException(e);
            }
            geminiOk("ok").accept(ex);
            ex.close();
        });
        srv.start();
        servers.add(srv);
        var c = new GeminiClient(HttpClient.newHttpClient(), "http://127.0.0.1:" + srv.getAddress().getPort());
        c.generate(new LlmKey(Provider.GEMINI, "AIza", "gemini#1"), "m",
                new LlmRequest("p", new byte[] {1, 2}, "image/jpeg", true, 0), Duration.ofSeconds(2));
        var sent = new tools.jackson.databind.json.JsonMapper().readTree(body.get());
        var inline = sent.path("contents").get(0).path("parts").get(1).path("inline_data");
        assertThat(inline.path("data").asString()).isEqualTo("AQI=");
        assertThat(inline.path("mime_type").asString()).isEqualTo("image/jpeg");
        assertThat(sent.path("generationConfig").path("responseMimeType").asString()).isEqualTo("application/json");
    }
}
