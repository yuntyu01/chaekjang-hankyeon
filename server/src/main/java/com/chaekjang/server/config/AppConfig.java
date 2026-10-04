package com.chaekjang.server.config;

import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import com.chaekjang.server.books.BookService;
import com.chaekjang.server.books.BookStore;
import com.chaekjang.server.books.Detailer;
import com.chaekjang.server.books.HttpColorExtractor;
import com.chaekjang.server.books.KakaoSearcher;
import com.chaekjang.server.books.MemBookStore;
import com.chaekjang.server.books.MockBooks;
import com.chaekjang.server.books.PgBookStore;
import com.chaekjang.server.books.Searcher;
import com.chaekjang.server.llm.LlmGateway;
import com.chaekjang.server.llm.LlmKey;
import com.chaekjang.server.llm.Provider;

/** 환경변수(.env.example)로 저장소·도서 출처·LLM 키를 고른다. 비어 있으면 개발용 대체로 뜬다. */
@Configuration
public class AppConfig {

    private static final Logger log = LoggerFactory.getLogger(AppConfig.class);

    @Bean
    BookStore bookStore(ObjectProvider<JdbcTemplate> jdbc) {
        JdbcTemplate t = jdbc.getIfAvailable();
        if (t != null) return new PgBookStore(t);
        log.warn("DATABASE_URL 없음: 메모리 저장소로 실행");
        return new MemBookStore();
    }

    @Bean
    BookService bookService(BookStore store,
            @Value("${KAKAO_REST_KEY:}") String kakaoKey,
            @Value("${BOOKS_CACHE_TTL:720h}") Duration ttl,
            @Value("${SEARCH_CACHE_TTL:10m}") Duration searchTtl) {
        Searcher searcher;
        Detailer detailer = null;
        String source;
        if (!kakaoKey.isEmpty()) {
            searcher = new KakaoSearcher(kakaoKey);
            source = "kakao";
        } else {
            log.warn("KAKAO_REST_KEY 없음: 가짜 도서 목록으로 실행");
            searcher = new MockBooks.MockSearcher();
            detailer = new MockBooks.MockDetailer();
            source = "mock";
        }
        return new BookService(store, searcher, detailer, new HttpColorExtractor(), source, ttl, searchTtl, Clock.systemUTC());
    }

    @Bean
    LlmGateway llmGateway(@Value("${LLM_KEYS:}") String rawKeys,
            @Value("${GEMINI_MODEL:}") String geminiModel,
            @Value("${OPENAI_MODEL:}") String openaiModel) {
        List<LlmKey> keys = LlmKey.parse(rawKeys);
        LlmGateway gw = new LlmGateway(keys, Map.of(Provider.GEMINI, geminiModel, Provider.OPENAI, openaiModel), null, null, null);
        log.info("llm keys registered={} usable={}", keys.size(), gw.available());
        return gw;
    }
}
