package com.chaekjang.server.books;

import java.util.List;

/** 도서 검색(카카오). */
public interface Searcher {

    List<SearchItem> search(String query) throws Exception;

    /** 없으면 null. */
    SearchItem lookupIsbn(String isbn13) throws Exception;
}
