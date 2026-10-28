package com.chaekjang.server.account;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Server-only admin credential; used solely for authenticating withdrawal callbacks and unlinking deleted accounts. */
@Component
public class KakaoConnectionManager {
    private final String admin, appId;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    public KakaoConnectionManager(@Value("${KAKAO_ADMIN_KEY:}") String admin,@Value("${KAKAO_APP_ID:}") String appId) {
        this.admin=admin;this.appId=appId;
    }
    public boolean ready() { return !admin.isBlank()&&!appId.isBlank(); }
    public boolean verified(String header,String incomingApp) {
        return ready()&&appId.equals(incomingApp)&&header!=null&&MessageDigest.isEqual(
                header.getBytes(StandardCharsets.UTF_8),("KakaoAK "+admin).getBytes(StandardCharsets.UTF_8));
    }
    public void unlink(String subject) throws IOException,InterruptedException {
        if(!ready())throw new IOException("kakao_unlink_not_configured");
        String body="target_id_type=user_id&target_id="+URLEncoder.encode(subject,StandardCharsets.UTF_8);
        var result=http.send(HttpRequest.newBuilder(URI.create("https://kapi.kakao.com/v1/user/unlink"))
                .timeout(Duration.ofSeconds(8)).header("Authorization","KakaoAK "+admin)
                .header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
        if(result.statusCode()==200)return;
        if(result.statusCode()==400&&JsonMapper.builder().build().readTree(result.body()).path("code").asInt()==-101)return;
        throw new IOException("kakao_unlink_failed");
    }
}
