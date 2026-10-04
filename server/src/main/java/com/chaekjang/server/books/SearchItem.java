package com.chaekjang.server.books;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

/** 검색 결과 한 건. 같은 책의 여러 판은 출판사·출간일로 구분해 보여준다. */
public record SearchItem(
        String isbn13,
        String title,
        List<String> authors,
        @JsonInclude(Include.NON_EMPTY) String publisher,
        @JsonInclude(Include.NON_EMPTY) String publishedAt,
        @JsonInclude(Include.NON_EMPTY) String thumbnailUrl,
        @JsonInclude(Include.NON_EMPTY) String description) {
}
