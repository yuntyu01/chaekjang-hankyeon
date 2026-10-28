package com.chaekjang.server.llm;

import static com.chaekjang.server.llm.HttpLlmSupport.JSON;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.chaekjang.server.llm.LlmException.Kind;

import tools.jackson.databind.JsonNode;

/** Gemini API generateContent (REST). */
public class GeminiClient implements LlmClient {

    private final HttpClient http;
    private final String baseUrl;

    public GeminiClient(HttpClient http) {
        this(http, "https://generativelanguage.googleapis.com");
    }

    public GeminiClient(HttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl;
    }

    @Override
    public String generate(LlmKey key, String model, LlmRequest req, Duration timeout) throws Exception {
        List<Object> parts = new ArrayList<>();
        parts.add(Map.of("text", req.prompt()));
        if (req.image() != null && req.image().length > 0) {
            parts.add(Map.of("inline_data", Map.of(
                    "mime_type", req.mimeType(), "data", Base64.getEncoder().encodeToString(req.image()))));
        }
        Map<String, Object> gen = new LinkedHashMap<>();
        if (req.json()) gen.put("responseMimeType", "application/json");
        if (req.maxTokens() > 0) gen.put("maxOutputTokens", req.maxTokens());

        var reply = HttpLlmSupport.post(http, baseUrl + "/v1beta/models/" + model + ":generateContent",
                Map.of("x-goog-api-key", key.secret()),
                Map.of("contents", List.of(Map.of("parts", parts)), "generationConfig", gen), timeout);
        if (reply.status() != 200) {
            throw LlmException.classifyStatus(Provider.GEMINI, reply.status(), HttpLlmSupport.errMessage(reply.body()).message());
        }
        JsonNode out;
        try {
            out = JSON.readTree(reply.body());
        } catch (RuntimeException e) {
            throw new LlmException(Kind.SERVER, reply.status(), Provider.GEMINI, "응답 해석 실패");
        }
        String block = out.path("promptFeedback").path("blockReason").asString("");
        JsonNode candidates = out.path("candidates");
        if (!block.isEmpty() || candidates.isEmpty()) {
            throw new LlmException(Kind.BLOCKED, reply.status(), Provider.GEMINI, block);
        }
        JsonNode cand = candidates.get(0);
        String finish = cand.path("finishReason").asString("");
        if (finish.equals("MAX_TOKENS")) {
            throw new LlmException(Kind.TOKENS, reply.status(), Provider.GEMINI, "MAX_TOKENS");
        }
        StringBuilder sb = new StringBuilder();
        for (JsonNode p : cand.path("content").path("parts")) sb.append(p.path("text").asString(""));
        if (sb.isEmpty()) throw new LlmException(Kind.BLOCKED, reply.status(), Provider.GEMINI, finish);
        return sb.toString();
    }
}
