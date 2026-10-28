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

/** Chat Completions API. */
public class OpenAiClient implements LlmClient {

    private final HttpClient http;
    private final String baseUrl;

    public OpenAiClient(HttpClient http) {
        this(http, "https://api.openai.com");
    }

    public OpenAiClient(HttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl;
    }

    @Override
    public String generate(LlmKey key, String model, LlmRequest req, Duration timeout) throws Exception {
        List<Object> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", req.prompt()));
        if (req.image() != null && req.image().length > 0) {
            content.add(Map.of("type", "image_url", "image_url", Map.of(
                    "url", "data:" + req.mimeType() + ";base64," + Base64.getEncoder().encodeToString(req.image()))));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("messages", List.of(Map.of("role", "user", "content", content)));
        if (req.json()) body.put("response_format", Map.of("type", "json_object"));
        if (req.maxTokens() > 0) body.put("max_completion_tokens", req.maxTokens());

        var reply = HttpLlmSupport.post(http, baseUrl + "/v1/chat/completions",
                Map.of("Authorization", "Bearer " + key.secret()), body, timeout);
        if (reply.status() != 200) {
            var info = HttpLlmSupport.errMessage(reply.body());
            LlmException e = LlmException.classifyStatus(Provider.OPENAI, reply.status(), info.message());
            if (info.code().equals("context_length_exceeded")) {
                e = new LlmException(Kind.TOKENS, reply.status(), Provider.OPENAI, info.message());
            }
            throw e;
        }
        JsonNode choices;
        try {
            choices = JSON.readTree(reply.body()).path("choices");
        } catch (RuntimeException e) {
            choices = null;
        }
        if (choices == null || choices.isEmpty()) {
            throw new LlmException(Kind.SERVER, reply.status(), Provider.OPENAI, "응답 해석 실패");
        }
        JsonNode ch = choices.get(0);
        String finish = ch.path("finish_reason").asString("");
        JsonNode message = ch.path("message");
        if (finish.equals("length")) {
            throw new LlmException(Kind.TOKENS, reply.status(), Provider.OPENAI, "length");
        }
        if (!message.path("refusal").asString("").isEmpty() || finish.equals("content_filter")) {
            throw new LlmException(Kind.BLOCKED, reply.status(), Provider.OPENAI, finish);
        }
        return message.path("content").asString("");
    }
}
