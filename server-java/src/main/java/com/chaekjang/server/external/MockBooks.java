package com.chaekjang.server.external;

import java.util.List;
import java.util.Map;

/** 키가 없을 때 쓰는 가짜 도서 목록(개발용). 실제 ISBN이 아니며 source는 "mock". */
public final class MockBooks {

    private MockBooks() {
    }

    public static final List<SearchItem> BOOKS = List.of(
            mock("9790000000018", "여름의 숲", List.of("가짜 작가"), "샘플 출판", "2021-06-01"),
            mock("9790000000025", "여름의 숲", List.of("가짜 작가"), "샘플 출판 개정판", "2025-03-15"),
            mock("9790000000032", "달과 나", List.of("시험 저자"), "개발 문고", "2019-11-20"),
            mock("9790000000049", "고요한 우연", List.of("시험 저자"), "개발 문고", "2023-02-08"),
            mock("9790000000056", "작은 것들의 깊이", List.of("목업 작가", "공동 저자"), "샘플 출판", "2024-09-01"));

    private static final Map<String, Integer> PAGES = Map.of(
            "9790000000018", 180, "9790000000025", 196, "9790000000032", 312, "9790000000049", 460, "9790000000056", 240);

    private static SearchItem mock(String isbn, String title, List<String> authors, String publisher, String publishedAt) {
        return new SearchItem(isbn, title, authors, publisher, publishedAt, "", "");
    }

    public static class MockSearcher implements Searcher {
        @Override
        public String source() {
            return "mock";
        }

        @Override
        public List<SearchItem> search(String q) {
            return BOOKS.stream()
                    .filter(b -> b.title().contains(q) || String.join(" ", b.authors()).contains(q))
                    .toList();
        }

        @Override
        public SearchItem lookupIsbn(String isbn13) {
            return BOOKS.stream().filter(b -> b.isbn13().equals(isbn13)).findFirst().orElse(null);
        }
    }

    public static class MockDetailer implements Detailer {
        @Override
        public Detail detail(String isbn13) {
            Integer pages = PAGES.get(isbn13);
            return pages == null ? null : new Detail("", pages, "", "", "");
        }
    }
}
