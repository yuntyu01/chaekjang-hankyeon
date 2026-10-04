package com.chaekjang.server.books;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** TEST_DATABASE_URL(jdbc:postgresql://...)이 있을 때만 실제 Postgres로 마이그레이션·저장·갱신을 확인한다. */
@EnabledIfEnvironmentVariable(named = "TEST_DATABASE_URL", matches = ".+")
class PgBookStoreTest {

    @Test
    void migrateAndStore() {
        var ds = new DriverManagerDataSource(System.getenv("TEST_DATABASE_URL"));
        for (int i = 0; i < 2; i++) { // 두 번 돌려도 한 번만 적용
            Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        }
        var jdbc = new JdbcTemplate(ds);
        var s = new PgBookStore(jdbc);
        var b = new Book(BookServiceTest.ISBN, "데미안", List.of("헤르만 헤세"), "", "2000-12-20", 0, "", "", "", "",
                "#2F5A45", "medium", "thick", "leaf", "test", null);
        s.put(b);
        s.put(new Book(b.isbn13(), "데미안(개정)", b.authors(), "", b.publishedAt(), 0, "", "", "", "", b.themeColor(),
                b.heightClass(), b.thicknessClass(), "moon", "test", null));
        Book got = s.get(BookServiceTest.ISBN);
        assertThat(got.title()).isEqualTo("데미안(개정)");
        assertThat(got.defaultMotifId()).isEqualTo("leaf");
        assertThat(got.publishedAt()).isEqualTo("2000-12-20");
        assertThat(got.updatedAt()).isNotNull();
        assertThat(s.get("9788996991342")).isNull();
        jdbc.update("DELETE FROM books WHERE isbn13 = ?", BookServiceTest.ISBN);
    }
}
