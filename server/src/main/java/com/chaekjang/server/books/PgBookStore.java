package com.chaekjang.server.books;

import java.sql.Date;
import java.sql.Types;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;

public class PgBookStore implements BookStore {

    private static final String COLS = """
            isbn13, title, authors, coalesce(publisher, ''), coalesce(to_char(published_at, 'YYYY-MM-DD'), ''),
            coalesce(page_count, 0), coalesce(format, ''), coalesce(cover_url, ''), coalesce(cover_thumb_url, ''), coalesce(description, ''),
            theme_color, height_class, thickness_class, default_motif_id, source, updated_at""";

    private final JdbcTemplate jdbc;

    public PgBookStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Book get(String isbn13) {
        List<Book> rows = jdbc.query("SELECT " + COLS + " FROM books WHERE isbn13 = ?", (rs, i) -> new Book(
                rs.getString(1), rs.getString(2), List.of((String[]) rs.getArray(3).getArray()),
                rs.getString(4), rs.getString(5), rs.getInt(6), rs.getString(7), rs.getString(8), rs.getString(9),
                rs.getString(10), rs.getString(11), rs.getString(12), rs.getString(13), rs.getString(14),
                rs.getString(15), rs.getObject(16, OffsetDateTime.class).toInstant()), isbn13);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static String nullable(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    private static Date parseDate(String s) {
        try {
            return Date.valueOf(LocalDate.parse(s));
        } catch (DateTimeParseException | NullPointerException e) {
            return null; // 날짜가 없거나 형식이 다르면 NULL
        }
    }

    // default_motif_id는 처음 저장한 값을 유지한다(갱신해도 책의 모티프가 바뀌지 않게).
    @Override
    public void put(Book b) {
        Date published = parseDate(b.publishedAt());
        jdbc.update(con -> {
            var ps = con.prepareStatement("""
                    INSERT INTO books (isbn13, title, authors, publisher, published_at, page_count, format, cover_url, cover_thumb_url,
                        description, theme_color, height_class, thickness_class, default_motif_id, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (isbn13) DO UPDATE SET
                        title = excluded.title, authors = excluded.authors, publisher = excluded.publisher,
                        published_at = excluded.published_at, page_count = excluded.page_count, format = excluded.format,
                        cover_url = excluded.cover_url, cover_thumb_url = excluded.cover_thumb_url, description = excluded.description,
                        theme_color = excluded.theme_color, height_class = excluded.height_class,
                        thickness_class = excluded.thickness_class, source = excluded.source, updated_at = now()""");
            ps.setString(1, b.isbn13());
            ps.setString(2, b.title());
            ps.setArray(3, con.createArrayOf("text", b.authors().toArray()));
            ps.setString(4, nullable(b.publisher()));
            if (published == null) ps.setNull(5, Types.DATE); else ps.setDate(5, published);
            if (b.pageCount() > 0) ps.setInt(6, b.pageCount()); else ps.setNull(6, Types.INTEGER);
            ps.setString(7, nullable(b.format()));
            ps.setString(8, nullable(b.coverUrl()));
            ps.setString(9, nullable(b.coverThumbUrl()));
            ps.setString(10, nullable(b.description()));
            ps.setString(11, b.themeColor());
            ps.setString(12, b.heightClass());
            ps.setString(13, b.thicknessClass());
            ps.setString(14, b.defaultMotifId());
            ps.setString(15, b.source());
            return ps;
        });
    }
}
