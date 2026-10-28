package com.chaekjang.server.book;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.chaekjang.server.common.ApiException;
import com.chaekjang.server.external.ColorExtractor;
import com.chaekjang.server.external.Detail;
import com.chaekjang.server.external.Detailer;
import com.chaekjang.server.external.SearchItem;
import com.chaekjang.server.external.Searcher;

/**
 * ISBN당 외부 조회·색 추출을 한 번만 하고 공유 캐시에 넣는다.
 * 카카오 운영정책(캐시는 최신 데이터로 유지)에 맞춰 TTL이 지나면 다시 조회한다.
 */
@Service
public class BookService {

    private static final Logger log = LoggerFactory.getLogger(BookService.class);
    private static final int SEARCH_CACHE_MAX = 500;

    private final BookRepository repo;
    private final Searcher searcher;
    private final Detailer detailer; // null 가능
    private final ColorExtractor colors;
    private final Duration ttl; // books 캐시 갱신 주기
    private final Duration searchTtl; // 검색 결과 메모리 캐시
    private final Clock clock;

    private final KeyedLock locks = new KeyedLock();
    private final Map<String, SearchEntry> searchCache = new HashMap<>();

    private record SearchEntry(List<SearchItem> items, Instant at) {
    }

    @Autowired
    public BookService(BookRepository repo, Searcher searcher, ObjectProvider<Detailer> detailer, ColorExtractor colors,
            @Value("${BOOKS_CACHE_TTL:720h}") Duration ttl, @Value("${SEARCH_CACHE_TTL:10m}") Duration searchTtl) {
        this(repo, searcher, detailer.getIfAvailable(), colors, ttl, searchTtl, Clock.systemUTC());
    }

    BookService(BookRepository repo, Searcher searcher, Detailer detailer, ColorExtractor colors,
            Duration ttl, Duration searchTtl, Clock clock) {
        this.repo = repo;
        this.searcher = searcher;
        this.detailer = detailer;
        this.colors = colors;
        this.ttl = ttl;
        this.searchTtl = searchTtl;
        this.clock = clock;
    }

    public String source() {
        return searcher.source();
    }

    public List<SearchItem> search(String q) {
        q = q == null ? "" : q.strip();
        if (q.isEmpty() || q.codePointCount(0, q.length()) > 100) throw ApiException.BAD_REQUEST;
        synchronized (searchCache) {
            SearchEntry e = searchCache.get(q);
            if (e != null && Duration.between(e.at, clock.instant()).compareTo(searchTtl) < 0) return e.items;
        }
        List<SearchItem> items;
        try {
            items = searcher.search(q);
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            log.warn("search failed", e);
            throw ApiException.UPSTREAM;
        }
        if (items == null) items = List.of();
        synchronized (searchCache) {
            if (searchCache.size() >= SEARCH_CACHE_MAX) {
                Instant now = clock.instant();
                searchCache.values().removeIf(e -> Duration.between(e.at, now).compareTo(searchTtl) >= 0);
                if (searchCache.size() >= SEARCH_CACHE_MAX) searchCache.remove(searchCache.keySet().iterator().next());
            }
            searchCache.put(q, new SearchEntry(items, clock.instant()));
        }
        return items;
    }

    static boolean validIsbn13(String s) {
        if (s.length() != 13) return false;
        int sum = 0;
        for (int i = 0; i < 13; i++) {
            char ch = s.charAt(i);
            if (ch < '0' || ch > '9') return false;
            sum += (ch - '0') * (i % 2 == 1 ? 3 : 1);
        }
        return sum % 10 == 0;
    }

    private boolean fresh(Book b) {
        return b != null && Duration.between(b.updatedAt(), clock.instant()).compareTo(ttl) < 0;
    }

    public Book get(String isbn13) {
        if (!validIsbn13(isbn13)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_isbn", "ISBN-13 형식이 아니에요");
        }
        Book cached = repo.findById(isbn13).orElse(null);
        if (fresh(cached)) return cached;
        try (var ignored = locks.lock(isbn13)) {
            // 기다리는 동안 다른 요청이 채웠을 수 있다.
            Book again = repo.findById(isbn13).orElse(null);
            if (fresh(again)) return again;
            Book b;
            try {
                b = fetch(isbn13, cached);
            } catch (ApiException e) {
                if (cached == null) throw e;
                log.warn("refresh failed, serving stale isbn={} err={}", isbn13, e.getMessage());
                return cached;
            }
            return repo.save(b);
        }
    }

    private Book fetch(String isbn13, Book prev) {
        SearchItem it;
        try {
            it = searcher.lookupIsbn(isbn13);
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            log.warn("lookup failed isbn={}", isbn13, e);
            throw ApiException.UPSTREAM;
        }
        if (it == null) throw ApiException.NOT_FOUND;

        Detail d = Detail.EMPTY;
        if (detailer != null) {
            try {
                Detail got = detailer.detail(isbn13);
                if (got != null) d = got;
            } catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                log.warn("detail failed isbn={}", isbn13, e);
            }
        }
        String cover = d.coverUrl().isEmpty() ? it.thumbnailUrl() : d.coverUrl();
        String desc = d.description().isEmpty() ? it.description() : d.description();

        // 색 추출도 한 번만: 표지가 그대로면 이전 색을 쓴다.
        String color = "";
        if (prev != null && prev.coverUrl().equals(cover)) {
            color = prev.themeColor();
        } else if (!cover.isEmpty() && colors != null) {
            try {
                color = colors.themeColor(cover);
            } catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                log.warn("color failed isbn={}", isbn13, e);
            }
        }
        if (color == null || color.isEmpty()) color = BookClasses.fallbackColor(isbn13);

        return new Book(isbn13, it.title(), it.authors() == null ? List.of() : it.authors(), it.publisher(),
                it.publishedAt(), d.pageCount(), d.format(), cover, it.thumbnailUrl(), desc, color,
                BookClasses.heightFromFormat(d.format()), BookClasses.thicknessFromPages(d.pageCount()),
                prev != null ? prev.defaultMotifId() : BookClasses.defaultMotifFor(isbn13), searcher.source(),
                clock.instant());
    }

    /** 같은 ISBN 요청이 동시에 와도 외부 조회는 한 번. */
    private static final class KeyedLock {
        private static final class Entry {
            final ReentrantLock lock = new ReentrantLock();
            int refs;
        }

        private final Map<String, Entry> map = new HashMap<>();

        interface Unlock extends AutoCloseable {
            @Override
            void close();
        }

        Unlock lock(String key) {
            Entry e;
            synchronized (map) {
                e = map.computeIfAbsent(key, k -> new Entry());
                e.refs++;
            }
            e.lock.lock();
            return () -> {
                e.lock.unlock();
                synchronized (map) {
                    if (--e.refs == 0) map.remove(key);
                }
            };
        }
    }
}
