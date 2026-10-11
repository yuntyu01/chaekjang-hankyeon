package com.chaekjang.server.account;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 카카오 로그인 설정. KAKAO_REST_KEY(책 검색과 같은 키)가 없으면 로그인은 503(not_configured).
 * KAKAO_CLIENT_SECRET: 카카오 콘솔 'REST API 키 > 클라이언트 시크릿(카카오 로그인)' 코드.
 * PUBLIC_BASE_URL: 카카오 콘솔 리다이렉트 URI의 앞부분(+ /auth/kakao/callback)과 같아야 한다.
 */
@Configuration
public class KakaoConfig {

    private static final Logger log = LoggerFactory.getLogger(KakaoConfig.class);

    public record Settings(String restKey, String clientSecret, String publicBaseUrl) {
    }

    @Bean
    Settings kakaoSettings(@Value("${KAKAO_REST_KEY:}") String restKey, @Value("${KAKAO_CLIENT_SECRET:}") String secret,
            @Value("${PUBLIC_BASE_URL:https://covebook.kodeploy.com}") String base) {
        if (!restKey.isEmpty() && secret.isEmpty()) log.warn("KAKAO_CLIENT_SECRET 없음: 클라이언트 시크릿이 켜진 앱이면 카카오 로그인이 실패해요");
        return new Settings(restKey, secret, base.replaceAll("/+$", ""));
    }

    @Bean
    KakaoOAuth kakaoOAuth(Settings s) {
        return new HttpKakaoOAuth(s.restKey(), s.clientSecret());
    }
}
