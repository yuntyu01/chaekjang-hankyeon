package com.chaekjang.server.external;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** KAKAO_REST_KEY가 있으면 카카오 검색, 없으면 가짜 도서 목록(개발용)으로 뜬다. */
@Configuration
public class ExternalConfig {

    private static final Logger log = LoggerFactory.getLogger(ExternalConfig.class);

    @Bean
    Searcher searcher(@Value("${KAKAO_REST_KEY:}") String kakaoKey) {
        if (!kakaoKey.isEmpty()) return new KakaoSearcher(kakaoKey);
        log.warn("KAKAO_REST_KEY 없음: 가짜 도서 목록으로 실행");
        return new MockBooks.MockSearcher();
    }

    @Bean
    @ConditionalOnExpression("'${KAKAO_REST_KEY:}'.isEmpty()")
    Detailer mockDetailer() {
        return new MockBooks.MockDetailer();
    }

    @Bean
    ColorExtractor colorExtractor() {
        return new HttpColorExtractor();
    }
}
