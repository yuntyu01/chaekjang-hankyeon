package com.chaekjang.server.books;

import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonInclude.Include;

/** books 테이블 한 줄(전 사용자 공유). 비어 있는 선택 필드는 JSON에서 뺀다. */
public record Book(
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
        String source,
        @JsonIgnore Instant updatedAt) {

    public Book withUpdatedAt(Instant t) {
        return new Book(isbn13, title, authors, publisher, publishedAt, pageCount, format, coverUrl, coverThumbUrl,
                description, themeColor, heightClass, thicknessClass, defaultMotifId, source, t);
    }
}
