package com.chaekjang.server.dev;

import org.springframework.boot.SpringApplication;

import com.chaekjang.server.ServerApplication;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * 개발용: 내장 Postgres(고정 포트 54329, 데이터는 종료하면 사라짐)와 함께 서버를 띄운다. `./gradlew devServer`.
 * 실제 배포는 DATABASE_URL을 쓰는 보통 실행(bootRun/jar)이다.
 */
public class DevServer {

    public static void main(String[] args) throws Exception {
        EmbeddedPostgres pg = EmbeddedPostgres.builder().setPort(54329).start();
        System.setProperty("DATABASE_URL", pg.getJdbcUrl("postgres", "postgres"));
        System.setProperty("FILE_DIR", System.getProperty("java.io.tmpdir") + "/chaekjang-dev-files");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                pg.close();
            } catch (Exception ignored) {
                // 종료 중
            }
        }));
        SpringApplication.run(ServerApplication.class, args);
    }
}
