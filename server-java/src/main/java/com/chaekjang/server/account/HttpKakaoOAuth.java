package com.chaekjang.server.account;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** kauth(토큰 교환) → kapi(/v2/user/me). 클라이언트 시크릿이 켜져 있어 토큰 요청에 함께 보낸다. */
public class HttpKakaoOAuth implements KakaoOAuth {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String restKey;
    private final String clientSecret;
    private final HttpClient http;

    public HttpKakaoOAuth(String restKey, String clientSecret) {
        this(restKey, clientSecret, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build());
    }

    public HttpKakaoOAuth(String restKey, String clientSecret, HttpClient http) {
        this.restKey = restKey;
        this.clientSecret = clientSecret;
        this.http = http;
    }

    @Override
    public Identity exchange(String code, String redirectUri) throws IOException, InterruptedException {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("client_id", restKey);
        form.put("redirect_uri", redirectUri);
        form.put("code", code);
        if (!clientSecret.isEmpty()) form.put("client_secret", clientSecret);
        String body = form.entrySet().stream()
                .map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        HttpResponse<String> tok = http.send(HttpRequest.newBuilder(URI.create("https://kauth.kakao.com/oauth/token"))
                .timeout(Duration.ofSeconds(8)).header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        if (tok.statusCode() != 200) throw new IOException("kakao token: status " + tok.statusCode());
        String access = JSON.readTree(tok.body()).path("access_token").asString("");
        if (access.isEmpty()) throw new IOException("kakao token: no access_token");

        HttpResponse<String> me = http.send(HttpRequest.newBuilder(URI.create("https://kapi.kakao.com/v2/user/me"))
                .timeout(Duration.ofSeconds(8)).header("Authorization", "Bearer " + access).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (me.statusCode() != 200) throw new IOException("kakao me: status " + me.statusCode());
        JsonNode j = JSON.readTree(me.body());
        String id = j.path("id").asString("");
        if (id.isEmpty()) throw new IOException("kakao me: no id");
        String nick = j.path("kakao_account").path("profile").path("nickname").asString("");
        if (nick.isEmpty()) nick = j.path("properties").path("nickname").asString("");
        return new Identity(id, nick.isEmpty() ? null : nick);
    }
}
