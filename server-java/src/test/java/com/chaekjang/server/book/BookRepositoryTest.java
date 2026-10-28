package com.chaekjang.server.book;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.chaekjang.server.PostgresIntegrationTest;

/** 진짜 Postgres에서 마이그레이션 적용, 스키마 검증(앱이 뜸), 저장·갱신·빈 값 처리를 확인한다. */
class BookRepositoryTest extends PostgresIntegrationTest {

    @Autowired
    BookRepository repo;

    @BeforeEach
    void clean() {
        repo.deleteAll();
    }

    @Test
    void saveUpdateAndFind() {
        var b = new Book(BookServiceTest.ISBN, "데미안", List.of("헤르만 헤세", "공동 저자"), "", "2000-12-20", 0, "", "", "", "",
                "#2F5A45", "medium", "thick", "leaf", "test", Instant.parse("2026-09-27T00:00:00Z"));
        repo.save(b);
        repo.save(new Book(b.isbn13(), "데미안(개정)", b.authors(), "", b.publishedAt(), 0, "", "", "", "", b.themeColor(),
                b.heightClass(), b.thicknessClass(), "moon", "test", Instant.parse("2026-09-28T00:00:00Z")));

        Book got = repo.findById(BookServiceTest.ISBN).orElseThrow();
        assertThat(got.title()).isEqualTo("데미안(개정)");
        assertThat(got.authors()).containsExactly("헤르만 헤세", "공동 저자");
        assertThat(got.defaultMotifId()).isEqualTo("leaf"); // 처음 저장한 모티프를 유지한다
        assertThat(got.publishedAt()).isEqualTo("2000-12-20");
        assertThat(got.updatedAt()).isEqualTo(Instant.parse("2026-09-28T00:00:00Z"));
        assertThat(repo.findById("9788996991342")).isEmpty();
    }

    @Test
    void emptyOptionalsComeBackEmpty() {
        repo.save(new Book(BookServiceTest.ISBN, "데미안", List.of(), "", "형식 아님", 0, "", "", "", "", "#2F5A45", "medium",
                "medium", "leaf", "test", Instant.now()));
        Book got = repo.findById(BookServiceTest.ISBN).orElseThrow();
        assertThat(got.authors()).isEmpty();
        assertThat(got.publisher()).isEmpty();
        assertThat(got.publishedAt()).isEmpty();
        assertThat(got.pageCount()).isZero();
        assertThat(got.coverUrl()).isEmpty();
    }
}
