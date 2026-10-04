package com.chaekjang.server.books;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/** 테스트·DB 없는 로컬 실행용. */
public class MemBookStore implements BookStore {

    private final ConcurrentMap<String, Book> map = new ConcurrentHashMap<>();

    @Override
    public Book get(String isbn13) {
        return map.get(isbn13);
    }

    @Override
    public void put(Book book) {
        map.put(book.isbn13(), book.updatedAt() == null ? book.withUpdatedAt(Instant.now()) : book);
    }
}
