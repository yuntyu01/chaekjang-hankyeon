package com.chaekjang.server;

import java.io.IOException;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/** 진짜 Postgres(내장 바이너리)에 Flyway 마이그레이션을 돌리고 JPA 스키마 검증까지 거치는 통합 시험의 바탕. */
@SpringBootTest
public abstract class PostgresIntegrationTest {

    private static final EmbeddedPostgres PG = start();

    private static EmbeddedPostgres start() {
        try {
            EmbeddedPostgres pg = EmbeddedPostgres.start();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    pg.close();
                } catch (IOException ignored) {
                    // 종료 중이라 무시
                }
            }));
            return pg;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("DATABASE_URL", () -> PG.getJdbcUrl("postgres", "postgres"));
    }
}
