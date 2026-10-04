package com.chaekjang.server.books;

/** books 테이블. */
public interface BookStore {

    /** 없으면 null. */
    Book get(String isbn13);

    void put(Book book);
}
