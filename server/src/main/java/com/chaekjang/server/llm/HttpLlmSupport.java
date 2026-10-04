package com.chaekjang.server.llm;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 제공자 클라이언트가 함께 쓰는 JSON POST·오류 본문 해석. */
final class HttpLlmSupport {

    static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int MAX_BODY = 4 << 20;

    private HttpLlmSupport() {
    }

    record Reply(int status, String body) {
    }

    static Reply post(HttpClient http, String url, Map<String, String> headers, Object body, Duration timeout)
            throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
        headers.forEach(b::header);
        HttpResponse<byte[]> res = http.send(b.build(), HttpResponse.BodyHandlers.ofByteArray());
        byte[] data = res.body();
        int n = Math.min(data.length, MAX_BODY);
        return new Reply(res.statusCode(), new String(data, 0, n, java.nio.charset.StandardCharsets.UTF_8));
    }

    /** 오류 본문에서 메시지와 코드만 뽑는다(키 값은 들어 있지 않다). */
    record ErrInfo(String message, String code) {
    }

    static ErrInfo errMessage(String body) {
        try {
            JsonNode e = JSON.readTree(body).path("error");
            String code = e.path("status").asString("");
            if (e.path("code").isString()) code = e.path("code").asString();
            return new ErrInfo(e.path("message").asString(""), code);
        } catch (RuntimeException ex) {
            return new ErrInfo("", "");
        }
    }
}
