package com.chaekjang.server.book;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;

/**
 * books 테이블 한 줄(전 사용자 공유, ISBN 기준 캐시).
 * 비어 있는 선택 값은 DB에 NULL로 두고, 읽을 때는 빈 문자열·0으로 돌려준다.
 */
@Entity
@Table(name = "books")
public class Book {

    @Id
    private String isbn13;

    @Column(nullable = false)
    private String title;

    // 저자는 순서가 있는 별도 표(book_authors)로 정규화했다.
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "book_authors", joinColumns = @JoinColumn(name = "isbn13"))
    @OrderColumn(name = "position")
    @Column(name = "name", nullable = false)
    private List<String> authors;

    private String publisher;
    private LocalDate publishedAt;
    private Integer pageCount;
    private String format;
    private String coverUrl;
    private String coverThumbUrl;
    private String description;

    @Column(nullable = false)
    private String themeColor;

    @Column(nullable = false)
    private String heightClass;

    @Column(nullable = false)
    private String thicknessClass;

    // 처음 저장한 값을 유지한다(갱신해도 책의 모티프가 바뀌지 않게).
    @Column(nullable = false, updatable = false)
    private String defaultMotifId;

    @Column(nullable = false)
    private String source;

    @Column(nullable = false)
    private Instant updatedAt;

    protected Book() {
    }

    /** publishedAt은 YYYY-MM-DD, 형식이 다르거나 비어 있으면 날짜 없음. */
    public Book(String isbn13, String title, List<String> authors, String publisher, String publishedAt, int pageCount,
            String format, String coverUrl, String coverThumbUrl, String description, String themeColor,
            String heightClass, String thicknessClass, String defaultMotifId, String source, Instant updatedAt) {
        this.isbn13 = isbn13;
        this.title = title;
        this.authors = new java.util.ArrayList<>(authors);
        this.publisher = nullIfEmpty(publisher);
        this.publishedAt = parseDate(publishedAt);
        this.pageCount = pageCount > 0 ? pageCount : null;
        this.format = nullIfEmpty(format);
        this.coverUrl = nullIfEmpty(coverUrl);
        this.coverThumbUrl = nullIfEmpty(coverThumbUrl);
        this.description = nullIfEmpty(description);
        this.themeColor = themeColor;
        this.heightClass = heightClass;
        this.thicknessClass = thicknessClass;
        this.defaultMotifId = defaultMotifId;
        this.source = source;
        this.updatedAt = updatedAt;
    }

    private static String nullIfEmpty(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static LocalDate parseDate(String s) {
        try {
            return LocalDate.parse(s);
        } catch (DateTimeParseException | NullPointerException e) {
            return null;
        }
    }

    public Book withUpdatedAt(Instant t) {
        return new Book(isbn13, title, authors, publisher, publishedAt(), pageCount(), format, coverUrl, coverThumbUrl,
                description, themeColor, heightClass, thicknessClass, defaultMotifId, source, t);
    }

    public String isbn13() {
        return isbn13;
    }

    public String title() {
        return title;
    }

    public List<String> authors() {
        return authors;
    }

    public String publisher() {
        return orEmpty(publisher);
    }

    public String publishedAt() {
        return publishedAt == null ? "" : publishedAt.toString();
    }

    public int pageCount() {
        return pageCount == null ? 0 : pageCount;
    }

    public String format() {
        return orEmpty(format);
    }

    public String coverUrl() {
        return orEmpty(coverUrl);
    }

    public String coverThumbUrl() {
        return orEmpty(coverThumbUrl);
    }

    public String description() {
        return orEmpty(description);
    }

    public String themeColor() {
        return themeColor;
    }

    public String heightClass() {
        return heightClass;
    }

    public String thicknessClass() {
        return thicknessClass;
    }

    public String defaultMotifId() {
        return defaultMotifId;
    }

    public String source() {
        return source;
    }

    public Instant updatedAt() {
        return updatedAt;
    }
}
