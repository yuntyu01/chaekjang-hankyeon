package com.chaekjang.server.config;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

/**
 * DATABASE_URL(Postgres)로 연결 풀을 만들고, 풀을 JPA에 넘기기 전에 마이그레이션(Flyway)을 돌린다.
 * DB가 없으면 서버는 뜨지 않는다.
 */
@Configuration
public class DatabaseConfig {

    @Bean(destroyMethod = "close")
    HikariDataSource dataSource(@Value("${DATABASE_URL}") String url) {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(toJdbcUrl(url));
        String[] user = userInfo(url);
        if (user != null) {
            cfg.setUsername(user[0]);
            cfg.setPassword(user[1]);
        }
        cfg.setConnectionTimeout(10_000); // 시작 때 DB에 못 붙으면 빨리 실패한다
        HikariDataSource ds = new HikariDataSource(cfg);
        // JPA(스키마 검증)가 이 풀을 쓰기 전에 테이블이 만들어져 있어야 한다.
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        return ds;
    }

    /**
     * Go 서버와 같은 형식(postgres://user:pass@host:5432/db?sslmode=disable)과
     * jdbc:postgresql://... 를 모두 받는다. 계정 정보는 URL에서 떼어낸다.
     */
    static String toJdbcUrl(String url) {
        if (url.startsWith("jdbc:")) return url;
        URI u = URI.create(url);
        int port = u.getPort() < 0 ? 5432 : u.getPort();
        String query = u.getRawQuery() == null ? "" : "?" + u.getRawQuery();
        return "jdbc:postgresql://" + u.getHost() + ":" + port + u.getRawPath() + query;
    }

    static String[] userInfo(String url) {
        if (url.startsWith("jdbc:")) return null;
        String raw = URI.create(url).getRawUserInfo();
        if (raw == null) return null;
        int colon = raw.indexOf(':');
        String user = colon < 0 ? raw : raw.substring(0, colon);
        String pass = colon < 0 ? "" : raw.substring(colon + 1);
        return new String[] {URLDecoder.decode(user, StandardCharsets.UTF_8), URLDecoder.decode(pass, StandardCharsets.UTF_8)};
    }
}
