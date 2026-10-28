package com.chaekjang.server.book;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

/** GET /books/{isbn13} 응답. 비어 있는 선택 필드는 JSON에서 뺀다. */
public record BookResponse(
        String isbn13,
        String title,
        List<String> authors,
        @JsonInclude(Include.NON_EMPTY) String publisher,
        @JsonInclude(Include.NON_EMPTY) String publishedAt, // YYYY-MM-DD
        @JsonInclude(Include.NON_DEFAULT) int pageCount,
        @JsonInclude(Include.NON_EMPTY) String format,
        @JsonInclude(Include.NON_EMPTY) String coverUrl,
        @JsonInclude(Include.NON_EMPTY) String coverThumbUrl,
        @JsonInclude(Include.NON_EMPTY) String description,
        String themeColor,
        String heightClass,
        String thicknessClass,
        String defaultMotifId,
        String source) {

    static BookResponse of(Book b) {
        return new BookResponse(b.isbn13(), b.title(), b.authors(), b.publisher(), b.publishedAt(), b.pageCount(),
                b.format(), b.coverUrl(), b.coverThumbUrl(), b.description(), b.themeColor(), b.heightClass(),
                b.thicknessClass(), b.defaultMotifId(), b.source());
    }
}
