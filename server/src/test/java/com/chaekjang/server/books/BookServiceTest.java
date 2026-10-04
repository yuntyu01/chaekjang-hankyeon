package com.chaekjang.server.books;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.chaekjang.server.common.ApiException;
import com.chaekjang.server.common.ApiExceptionHandler;

class BookServiceTest {

    static final String ISBN = "9788937460449";

    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-09-27T00:00:00Z");

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    static class CountingSearcher implements Searcher {
        final AtomicInteger lookups = new AtomicInteger();
        final AtomicBoolean fail = new AtomicBoolean();

        @Override
        public List<SearchItem> search(String q) {
            return List.of();
        }

        @Override
        public SearchItem lookupIsbn(String isbn) throws Exception {
            lookups.incrementAndGet();
            Thread.sleep(10);
            if (fail.get()) throw new Exception("down");
            if (!isbn.equals(ISBN)) return null;
            return new SearchItem(ISBN, "데미안", List.of("헤르만 헤세"), "", "", "https://img/c.jpg", "");
        }
    }

    static class CountingColors implements ColorExtractor {
        final AtomicInteger n = new AtomicInteger();

        @Override
        public String themeColor(String url) {
            n.incrementAndGet();
            return "#2F5A45";
        }
    }

    /** 저장 시각을 테스트 시계로 찍는다. */
    static class ClockStore extends MemBookStore {
        final MutableClock clock;

        ClockStore(MutableClock clock) {
            this.clock = clock;
        }

        @Override
        public void put(Book b) {
            super.put(b.withUpdatedAt(clock.now));
        }
    }

    final MutableClock clock = new MutableClock();
    final CountingSearcher searcher = new CountingSearcher();
    final CountingColors colors = new CountingColors();
    final BookService svc = new BookService(new ClockStore(clock), searcher, null, colors, "test",
            Duration.ofDays(30), Duration.ofMinutes(1), clock);

    @Test
    void sameIsbnFetchedOnce() {
        List<CompletableFuture<Book>> all = new ArrayList<>();
        for (int i = 0; i < 20; i++) all.add(CompletableFuture.supplyAsync(() -> svc.get(ISBN)));
        all.forEach(CompletableFuture::join);
        Book b = svc.get(ISBN); // 두 번째 사용자 요청도 캐시에서
        assertThat(searcher.lookups.get()).isEqualTo(1);
        assertThat(colors.n.get()).isEqualTo(1);
        assertThat(b.themeColor()).isEqualTo("#2F5A45");
        assertThat(b.thicknessClass()).isEqualTo("medium");
        assertThat(b.defaultMotifId()).isNotEmpty();
    }

    @Test
    void ttlRefreshKeepsColor() {
        svc.get(ISBN);
        clock.now = clock.now.plus(Duration.ofDays(31));
        svc.get(ISBN);
        assertThat(searcher.lookups.get()).isEqualTo(2);
        assertThat(colors.n.get()).isEqualTo(1);
        // 갱신 실패 시 이전 데이터
        clock.now = clock.now.plus(Duration.ofDays(31));
        searcher.fail.set(true);
        assertThat(svc.get(ISBN).title()).isEqualTo("데미안");
    }

    @Test
    void getErrors() {
        assertThatThrownBy(() -> svc.get("123")).isInstanceOfSatisfying(ApiException.class,
                e -> assertThat(e.code()).isEqualTo("invalid_isbn"));
        assertThatThrownBy(() -> svc.get("9788996991342")).isSameAs(ApiException.NOT_FOUND);
        searcher.fail.set(true);
        assertThatThrownBy(() -> svc.get(ISBN)).isSameAs(ApiException.UPSTREAM);
    }

    @Test
    void errorJsonFormat() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new BookController(svc)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/books/9788996991342"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("not_found"))
                .andExpect(jsonPath("$.error.message").value("찾을 수 없어요"));
    }

    @Test
    void bookJsonOmitsEmptyOptionals() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new BookController(svc)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/books/" + ISBN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isbn13").value(ISBN))
                .andExpect(jsonPath("$.authors[0]").value("헤르만 헤세"))
                .andExpect(jsonPath("$.publisher").doesNotExist())
                .andExpect(jsonPath("$.pageCount").doesNotExist())
                .andExpect(jsonPath("$.updatedAt").doesNotExist())
                .andExpect(jsonPath("$.source").value("test"));
    }

    @Test
    void searchCacheAndValidation() throws Exception {
        BookService s = new BookService(new MemBookStore(), new MockBooks.MockSearcher(), null, null, "mock",
                Duration.ofDays(30), Duration.ofMinutes(1), clock);
        assertThat(s.search(" 여름의 숲 ")).hasSize(2);
        assertThatThrownBy(() -> s.search("  ")).isSameAs(ApiException.BAD_REQUEST);
        for (SearchItem b : MockBooks.BOOKS) assertThat(BookService.validIsbn13(b.isbn13())).as(b.isbn13()).isTrue();

        MockMvc mvc = MockMvcBuilders.standaloneSetup(new BookController(s)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/books/search").param("q", "달과"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].isbn13").value("9790000000032"));
        mvc.perform(get("/books/search")).andExpect(status().isBadRequest());
    }
}
