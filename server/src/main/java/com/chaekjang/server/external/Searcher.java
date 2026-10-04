package com.chaekjang.server.external;

import java.util.List;

/** 도서 검색(카카오). */
public interface Searcher {

    /** 도서 출처 이름(books.source에 저장): kakao | mock. */
    String source();

    List<SearchItem> search(String query) throws Exception;

    /** 없으면 null. */
    SearchItem lookupIsbn(String isbn13) throws Exception;
}
