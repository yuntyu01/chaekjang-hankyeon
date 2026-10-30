package com.chaekjang.server.sync;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import javax.sql.DataSource;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chaekjang.server.common.ApiException;
import com.chaekjang.server.sync.SyncDtos.Art;
import com.chaekjang.server.sync.SyncDtos.Binding;
import com.chaekjang.server.sync.SyncDtos.Bookmark;
import com.chaekjang.server.sync.SyncDtos.Edition;
import com.chaekjang.server.sync.SyncDtos.Layout;
import com.chaekjang.server.sync.SyncDtos.MyBook;
import com.chaekjang.server.sync.SyncDtos.Pull;
import com.chaekjang.server.sync.SyncDtos.Push;
import com.chaekjang.server.sync.SyncDtos.PushResult;
import com.chaekjang.server.sync.SyncDtos.Round;
import com.chaekjang.server.sync.SyncDtos.Session;

/**
 * 서재 동기화. 모든 쓰기는 (user_id, id) 단위 upsert이고, 쓸 때마다 rev를 올린다.
 * 충돌 규칙: 앱이 기록한 updated_at이 더 새로운(또는 같은) 쪽이 이긴다. 서버 값이 더 새로우면 건너뛰고 skipped로 알린다.
 * 올리는 순서는 참조 순서(판본 → 내 책 → 장정·회차 → 세션·갈피)이며 한 요청은 한 트랜잭션이다(일부만 반영되지 않는다).
 */
@Service
public class SyncService {

    static final int MAX_ITEMS = 1000;
    private static final String REV = "nextval('sync_rev_seq')";

    private final JdbcTemplate jdbc;

    public SyncService(DataSource ds) {
        this.jdbc = new JdbcTemplate(ds);
    }

    // ---------- 올리기 ----------

    @Transactional
    public PushResult push(long user, Push p) {
        List<String> skipped = new ArrayList<>();
        int applied = 0;
        try {
            List<Edition> editions = new ArrayList<>();
            applied += each("editions", user, p.editions(), Edition::id, Edition::deleted, Edition::updatedAt, skipped, EDITION_UPSERT, this::editionArgs, editions);
            writeAuthors(user, editions);
            applied += each("books", user, p.books(), MyBook::id, MyBook::deleted, MyBook::updatedAt, skipped, BOOK_UPSERT, this::bookArgs, null);
            applied += each("bindings", user, p.bindings(), Binding::id, Binding::deleted, Binding::updatedAt, skipped, BINDING_UPSERT, this::bindingArgs, null);
            applied += each("rounds", user, p.rounds(), Round::id, Round::deleted, Round::updatedAt, skipped, ROUND_UPSERT, this::roundArgs, null);
            applied += each("sessions", user, p.sessions(), Session::id, Session::deleted, Session::updatedAt, skipped, SESSION_UPSERT, this::sessionArgs, null);
            applied += each("bookmarks", user, p.bookmarks(), Bookmark::id, Bookmark::deleted, Bookmark::updatedAt, skipped, BOOKMARK_UPSERT, this::bookmarkArgs, null);
            if (p.layout() != null) {
                if (upsertLayout(user, p.layout())) applied++;
                else skipped.add("layout");
            }
        } catch (DataIntegrityViolationException e) {
            throw translate(e);
        }
        Long rev = jdbc.queryForObject("SELECT COALESCE(MAX(r), 0) FROM (SELECT MAX(rev) r FROM editions WHERE user_id = ? UNION ALL SELECT MAX(rev) FROM my_books WHERE user_id = ? "
                + "UNION ALL SELECT MAX(rev) FROM bindings WHERE user_id = ? UNION ALL SELECT MAX(rev) FROM rounds WHERE user_id = ? UNION ALL SELECT MAX(rev) FROM sessions WHERE user_id = ? "
                + "UNION ALL SELECT MAX(rev) FROM bookmarks WHERE user_id = ? UNION ALL SELECT MAX(rev) FROM shelf_layouts WHERE user_id = ?) t", Long.class,
                user, user, user, user, user, user, user);
        return new PushResult(rev == null ? 0 : rev, applied, skipped);
    }

    /** 한 항목을 upsert 문의 인자로 바꾼다(값이 규칙에 맞지 않으면 400). */
    private interface Args<T> {
        Object[] of(long user, T item, OffsetDateTime updatedAt);
    }

    // 한 종류를 묶어서 쓴다: 값 검사를 먼저 다 하고, upsert와 삭제 표시를 각각 한 번의 배치로 보낸다(항목마다 왕복하지 않게).
    // 반영된 upsert 항목은 applied에 담는다(판본 저자 표를 그 항목만 다시 쓰려고).
    private <T> int each(String kind, long user, List<T> items, Function<T, String> id, Function<T, Boolean> deleted, Function<T, String> updatedAt,
            List<String> skipped, String upsertSql, Args<T> args, List<T> applied) {
        if (items == null || items.isEmpty()) return 0;
        if (items.size() > MAX_ITEMS) throw ApiException.BAD_REQUEST;
        List<T> ups = new ArrayList<>();
        List<Object[]> upArgs = new ArrayList<>();
        List<String> dels = new ArrayList<>();
        List<Object[]> delArgs = new ArrayList<>();
        for (T item : items) {
            String key = id.apply(item);
            if (key == null || key.isBlank() || key.length() > 80) throw ApiException.BAD_REQUEST;
            OffsetDateTime at = ts(updatedAt.apply(item));
            if (at == null) throw ApiException.BAD_REQUEST;
            if (Boolean.TRUE.equals(deleted.apply(item))) {
                dels.add(key);
                delArgs.add(new Object[] {at, at, user, key, at});
            } else {
                ups.add(item);
                upArgs.add(args.of(user, item, at));
            }
        }
        int n = 0;
        int[] r = upArgs.isEmpty() ? new int[0] : jdbc.batchUpdate(upsertSql, upArgs);
        for (int i = 0; i < r.length; i++) {
            if (r[i] > 0) {
                n++;
                if (applied != null) applied.add(ups.get(i));
            } else skipped.add(kind + ":" + id.apply(ups.get(i)));
        }
        r = delArgs.isEmpty() ? new int[0]
                : jdbc.batchUpdate("UPDATE " + TABLE.get(kind) + " SET deleted_at = ?, updated_at = ?, rev = " + REV + " WHERE user_id = ? AND id = ? AND updated_at <= ?", delArgs);
        for (int i = 0; i < r.length; i++) {
            if (r[i] > 0) n++;
            else skipped.add(kind + ":" + dels.get(i));
        }
        return n;
    }

    private static final Map<String, String> TABLE = Map.of("editions", "editions", "books", "my_books", "bindings", "bindings", "rounds", "rounds",
            "sessions", "sessions", "bookmarks", "bookmarks");

    private static final String EDITION_UPSERT = """
            INSERT INTO editions (user_id, id, isbn13, title, publisher, published_at, page_count, width_mm, height_mm, category, series_title, cover_url,
                cover_file_id, cover_source, source, source_name, art_base_color, art_ink_color, art_accent_color, art_motif_id, art_layout, art_version,
                art_generated_at, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET isbn13 = EXCLUDED.isbn13, title = EXCLUDED.title, publisher = EXCLUDED.publisher,
                published_at = EXCLUDED.published_at, page_count = EXCLUDED.page_count, width_mm = EXCLUDED.width_mm, height_mm = EXCLUDED.height_mm,
                category = EXCLUDED.category, series_title = EXCLUDED.series_title, cover_url = EXCLUDED.cover_url, cover_file_id = EXCLUDED.cover_file_id,
                cover_source = EXCLUDED.cover_source, source = EXCLUDED.source, source_name = EXCLUDED.source_name, art_base_color = EXCLUDED.art_base_color,
                art_ink_color = EXCLUDED.art_ink_color, art_accent_color = EXCLUDED.art_accent_color, art_motif_id = EXCLUDED.art_motif_id,
                art_layout = EXCLUDED.art_layout, art_version = EXCLUDED.art_version, art_generated_at = EXCLUDED.art_generated_at,
                updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE editions.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] editionArgs(long user, Edition e, OffsetDateTime at) {
        if (e.title() == null || e.title().isBlank() || e.source() == null) throw ApiException.BAD_REQUEST;
        Art a = e.art();
        return new Object[] {user, e.id(), blank(e.isbn13()), e.title(), blank(e.publisher()), blank(e.publishedAt()), e.pageCount(), e.widthMm(), e.heightMm(),
                blank(e.category()), blank(e.seriesTitle()), blank(e.coverUrl()), blank(e.coverFileId()), blank(e.coverSource()), e.source(), blank(e.sourceName()),
                a == null ? null : a.baseColor(), a == null ? null : a.inkColor(), a == null ? null : a.accentColor(), a == null ? null : a.motifId(),
                a == null ? null : a.layoutVariant(), a == null ? null : a.version(), a == null ? null : ts(a.generatedAt()), ts(orNow(e.createdAt(), e.updatedAt())), at};
    }

    // 반영된 판본의 저자만 지우고 다시 넣는다(두 번의 배치)
    private void writeAuthors(long user, List<Edition> editions) {
        if (editions.isEmpty()) return;
        List<Object[]> del = new ArrayList<>();
        List<Object[]> ins = new ArrayList<>();
        for (Edition e : editions) {
            del.add(new Object[] {user, e.id()});
            List<String> names = e.authors() == null ? List.of() : e.authors();
            for (int i = 0; i < names.size(); i++) {
                if (names.get(i) == null || names.get(i).isBlank()) continue;
                ins.add(new Object[] {user, e.id(), i, names.get(i)});
            }
        }
        jdbc.batchUpdate("DELETE FROM edition_authors WHERE user_id = ? AND edition_id = ?", del);
        if (!ins.isEmpty()) jdbc.batchUpdate("INSERT INTO edition_authors (user_id, edition_id, position, name) VALUES (?, ?, ?, ?)", ins);
    }

    private static final String BOOK_UPSERT = """
            INSERT INTO my_books (user_id, id, edition_id, status, rating, note, current_page, binding_id, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET edition_id = EXCLUDED.edition_id, status = EXCLUDED.status, rating = EXCLUDED.rating, note = EXCLUDED.note,
                current_page = EXCLUDED.current_page, binding_id = EXCLUDED.binding_id, updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE my_books.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] bookArgs(long user, MyBook b, OffsetDateTime at) {
        if (b.editionId() == null || b.status() == null) throw ApiException.BAD_REQUEST;
        return new Object[] {user, b.id(), b.editionId(), b.status(), b.rating(), blank(b.note()), b.currentPage(), blank(b.bindingId()),
                ts(orNow(b.createdAt(), b.updatedAt())), at};
    }

    private static final String BINDING_UPSERT = """
            INSERT INTO bindings (user_id, id, my_book_id, spine_color, ink_color, accent_color, motif, layout, material, cover_art_id, source, status, seed, cover_art_file_id,
                spine_art_file_id, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET my_book_id = EXCLUDED.my_book_id, spine_color = EXCLUDED.spine_color, ink_color = EXCLUDED.ink_color,
                accent_color = EXCLUDED.accent_color, motif = EXCLUDED.motif, layout = EXCLUDED.layout, material = EXCLUDED.material, cover_art_id = EXCLUDED.cover_art_id, source = EXCLUDED.source, status = EXCLUDED.status,
                seed = EXCLUDED.seed, cover_art_file_id = EXCLUDED.cover_art_file_id, spine_art_file_id = EXCLUDED.spine_art_file_id,
                updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE bindings.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] bindingArgs(long user, Binding b, OffsetDateTime at) {
        if (b.myBookId() == null || b.spineColor() == null || b.motif() == null || b.source() == null || b.status() == null) throw ApiException.BAD_REQUEST;
        return new Object[] {user, b.id(), b.myBookId(), b.spineColor(), blank(b.inkColor()), blank(b.accentColor()), b.motif(), blank(b.layout()), blank(b.material()),
                blank(b.coverArtId()), b.source(), b.status(), b.seed() == null ? 0 : b.seed(), blank(b.coverArtFileId()), blank(b.spineArtFileId()),
                ts(orNow(b.createdAt(), b.updatedAt())), at};
    }

    private static final String ROUND_UPSERT = """
            INSERT INTO rounds (user_id, id, my_book_id, idx, started_on, finished_on, paused, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET my_book_id = EXCLUDED.my_book_id, idx = EXCLUDED.idx, started_on = EXCLUDED.started_on,
                finished_on = EXCLUDED.finished_on, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE rounds.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] roundArgs(long user, Round r, OffsetDateTime at) {
        if (r.myBookId() == null || r.index() == null) throw ApiException.BAD_REQUEST;
        return new Object[] {user, r.id(), r.myBookId(), r.index(), day(r.startedAt()), day(r.finishedAt()), Boolean.TRUE.equals(r.paused()),
                ts(orNow(r.createdAt(), r.updatedAt())), at};
    }

    private static final String SESSION_UPSERT = """
            INSERT INTO sessions (user_id, id, my_book_id, round_id, started_at, ended_at, duration_ms, pages_read, memo, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET my_book_id = EXCLUDED.my_book_id, round_id = EXCLUDED.round_id, started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at, duration_ms = EXCLUDED.duration_ms, pages_read = EXCLUDED.pages_read, memo = EXCLUDED.memo,
                updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE sessions.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] sessionArgs(long user, Session s, OffsetDateTime at) {
        OffsetDateTime start = ts(s.startedAt());
        OffsetDateTime end = ts(s.endedAt());
        if (start == null || end == null || s.durationMs() == null) throw ApiException.BAD_REQUEST;
        return new Object[] {user, s.id(), blank(s.myBookId()), blank(s.roundId()), start, end, s.durationMs(), s.pagesRead(), blank(s.memo()),
                ts(orNow(s.createdAt(), s.updatedAt())), at};
    }

    private static final String BOOKMARK_UPSERT = """
            INSERT INTO bookmarks (user_id, id, my_book_id, body, page, memo, photo_file_id, photo_ratio, created_at, updated_at, deleted_at, rev)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, %s)
            ON CONFLICT (user_id, id) DO UPDATE SET my_book_id = EXCLUDED.my_book_id, body = EXCLUDED.body, page = EXCLUDED.page, memo = EXCLUDED.memo,
                photo_file_id = EXCLUDED.photo_file_id, photo_ratio = EXCLUDED.photo_ratio, updated_at = EXCLUDED.updated_at, deleted_at = NULL, rev = EXCLUDED.rev
            WHERE bookmarks.updated_at <= EXCLUDED.updated_at
            """.formatted(REV);

    private Object[] bookmarkArgs(long user, Bookmark m, OffsetDateTime at) {
        if (m.myBookId() == null) throw ApiException.BAD_REQUEST;
        return new Object[] {user, m.id(), m.myBookId(), m.text() == null ? "" : m.text(), m.page(), blank(m.memo()), blank(m.photoFileId()),
                m.photoRatio() == null ? null : m.photoRatio().floatValue(), ts(orNow(m.createdAt(), m.updatedAt())), at};
    }

    // 배치는 한 벌 단위: 앱 시각이 더 새로우면 그 사용자의 선반·책 자리를 통째로 바꾼다.
    private boolean upsertLayout(long user, Layout l) {
        OffsetDateTime at = ts(l.updatedAt());
        if (at == null) throw ApiException.BAD_REQUEST;
        LayoutRows rows = LayoutRows.from(l);
        boolean ok = jdbc.update("""
                INSERT INTO shelf_layouts (user_id, version, client_updated_at, updated_at, rev) VALUES (?, ?, ?, now(), %s)
                ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, client_updated_at = EXCLUDED.client_updated_at, updated_at = now(), rev = EXCLUDED.rev
                WHERE shelf_layouts.client_updated_at <= EXCLUDED.client_updated_at
                """.formatted(REV), user, l.version() == null ? 2 : l.version(), at) > 0;
        if (!ok) return false;
        jdbc.update("DELETE FROM shelf_placements WHERE user_id = ?", user);
        jdbc.update("DELETE FROM shelves WHERE user_id = ?", user);
        jdbc.batchUpdate("INSERT INTO shelves (user_id, id, position) VALUES (?, ?, ?)", rows.shelves(user));
        jdbc.batchUpdate("""
                INSERT INTO shelf_placements (user_id, book_id, shelf_id, position, pose, tilt, stack_id, stack_order, pos, lean_angle, lean_on, depth, spin, pitch,
                    stack_dx, stack_dz, wall_lean) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, rows.placements(user));
        return true;
    }

    // ---------- 받기 ----------

    private record Row<T>(long rev, T dto) {
    }

    private record Fetched<T>(List<Row<T>> rows, boolean truncated) {
        long lastRev() {
            return rows.isEmpty() ? Long.MAX_VALUE : rows.get(rows.size() - 1).rev();
        }
    }

    @Transactional(readOnly = true)
    public Pull pull(long user, long since, int limit) {
        Fetched<Edition> editions = fetch("editions", user, since, limit, (rs, i) -> {
            boolean del = rs.getObject("deleted_at") != null;
            String at = iso(rs, "updated_at");
            if (del) return new Edition(rs.getString("id"), null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, at, true);
            Art art = rs.getString("art_base_color") == null ? null : new Art(rs.getString("art_base_color"), rs.getString("art_ink_color"), rs.getString("art_accent_color"),
                    rs.getString("art_motif_id"), rs.getString("art_layout"), (Integer) rs.getObject("art_version"), iso(rs, "art_generated_at"));
            return new Edition(rs.getString("id"), rs.getString("isbn13"), rs.getString("title"), List.of(), rs.getString("publisher"), rs.getString("published_at"),
                    (Integer) rs.getObject("page_count"), (Integer) rs.getObject("width_mm"), (Integer) rs.getObject("height_mm"), rs.getString("category"),
                    rs.getString("series_title"), rs.getString("cover_url"), rs.getString("cover_file_id"), rs.getString("cover_source"), rs.getString("source"),
                    rs.getString("source_name"), art, iso(rs, "created_at"), at, false);
        });
        Fetched<MyBook> books = fetch("my_books", user, since, limit, (rs, i) -> rs.getObject("deleted_at") != null
                ? new MyBook(rs.getString("id"), null, null, null, null, null, null, null, iso(rs, "updated_at"), true)
                : new MyBook(rs.getString("id"), rs.getString("edition_id"), rs.getString("status"), (Integer) rs.getObject("rating"), rs.getString("note"),
                        (Integer) rs.getObject("current_page"), rs.getString("binding_id"), iso(rs, "created_at"), iso(rs, "updated_at"), false));
        Fetched<Binding> bindings = fetch("bindings", user, since, limit, (rs, i) -> rs.getObject("deleted_at") != null
                ? new Binding(rs.getString("id"), null, null, null, null, null, null, null, null, null, null, null, null, null, null, iso(rs, "updated_at"), true)
                : new Binding(rs.getString("id"), rs.getString("my_book_id"), rs.getString("spine_color"), rs.getString("ink_color"), rs.getString("accent_color"),
                        rs.getString("motif"), rs.getString("layout"), rs.getString("material"), rs.getString("cover_art_id"), rs.getString("source"), rs.getString("status"), rs.getInt("seed"), rs.getString("cover_art_file_id"),
                        rs.getString("spine_art_file_id"), iso(rs, "created_at"), iso(rs, "updated_at"), false));
        Fetched<Round> rounds = fetch("rounds", user, since, limit, (rs, i) -> rs.getObject("deleted_at") != null
                ? new Round(rs.getString("id"), null, null, null, null, null, null, iso(rs, "updated_at"), true)
                : new Round(rs.getString("id"), rs.getString("my_book_id"), rs.getInt("idx"), rs.getString("started_on"), rs.getString("finished_on"), rs.getBoolean("paused"),
                        iso(rs, "created_at"), iso(rs, "updated_at"), false));
        Fetched<Session> sessions = fetch("sessions", user, since, limit, (rs, i) -> rs.getObject("deleted_at") != null
                ? new Session(rs.getString("id"), null, null, null, null, null, null, null, null, iso(rs, "updated_at"), true)
                : new Session(rs.getString("id"), rs.getString("my_book_id"), rs.getString("round_id"), iso(rs, "started_at"), iso(rs, "ended_at"), rs.getLong("duration_ms"),
                        (Integer) rs.getObject("pages_read"), rs.getString("memo"), iso(rs, "created_at"), iso(rs, "updated_at"), false));
        Fetched<Bookmark> bookmarks = fetch("bookmarks", user, since, limit, (rs, i) -> rs.getObject("deleted_at") != null
                ? new Bookmark(rs.getString("id"), null, null, null, null, null, null, null, iso(rs, "updated_at"), true)
                : new Bookmark(rs.getString("id"), rs.getString("my_book_id"), rs.getString("body"), (Integer) rs.getObject("page"), rs.getString("memo"),
                        rs.getString("photo_file_id"), rs.getObject("photo_ratio") == null ? null : (double) rs.getFloat("photo_ratio"), iso(rs, "created_at"),
                        iso(rs, "updated_at"), false));

        // 한 종류가 잘렸으면(more) 그 종류의 마지막 rev까지만 모든 종류에서 돌려준다 → 다음 since로 이어 받아도 빠지는 것이 없다.
        long cut = Long.MAX_VALUE;
        boolean more = false;
        for (Fetched<?> f : List.of(editions, books, bindings, rounds, sessions, bookmarks)) {
            if (f.truncated()) {
                more = true;
                cut = Math.min(cut, f.lastRev());
            }
        }
        long[] max = {since};
        List<Edition> ed = take(editions, cut, max);
        List<MyBook> bk = take(books, cut, max);
        List<Binding> bd = take(bindings, cut, max);
        List<Round> rd = take(rounds, cut, max);
        List<Session> ss = take(sessions, cut, max);
        List<Bookmark> bm = take(bookmarks, cut, max);
        Layout layout = null;
        List<Object[]> meta = jdbc.query("SELECT version, client_updated_at, rev FROM shelf_layouts WHERE user_id = ? AND rev > ? AND rev <= ?",
                (rs, i) -> new Object[] {rs.getInt(1), rs.getObject(2, OffsetDateTime.class).toInstant().toString(), rs.getLong(3)}, user, since, cut);
        if (!meta.isEmpty()) {
            layout = readLayout(user, (Integer) meta.get(0)[0], (String) meta.get(0)[1]);
            max[0] = Math.max(max[0], (Long) meta.get(0)[2]);
        }
        return new Pull(max[0], more, withAuthors(user, ed), bk, bd, rd, ss, bm, layout);
    }

    private static <T> List<T> take(Fetched<T> f, long cut, long[] max) {
        List<T> out = new ArrayList<>();
        for (Row<T> r : f.rows()) {
            if (r.rev() > cut) break;
            out.add(r.dto());
            max[0] = Math.max(max[0], r.rev());
        }
        return out;
    }

    private <T> Fetched<T> fetch(String table, long user, long since, int limit, RowMapper<T> mapper) {
        List<Row<T>> rows = jdbc.query("SELECT * FROM " + table + " WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?",
                (rs, i) -> new Row<>(rs.getLong("rev"), mapper.mapRow(rs, i)), user, since, limit + 1);
        boolean truncated = rows.size() > limit;
        return new Fetched<>(truncated ? rows.subList(0, limit) : rows, truncated);
    }

    // 선반 순서 → 선반 안 순서 → 쌓기 순서로 모은다(앱 normalize와 같은 순서). 서랍은 서랍 순서.
    private Layout readLayout(long user, int version, String updatedAt) {
        List<SyncDtos.Shelf> shelves = jdbc.query("SELECT id, position FROM shelves WHERE user_id = ? ORDER BY position, id",
                (rs, i) -> new SyncDtos.Shelf(rs.getString(1), rs.getInt(2)), user);
        List<SyncDtos.Placement> placements = new ArrayList<>();
        List<String> drawer = new ArrayList<>();
        jdbc.query("""
                SELECT p.* FROM shelf_placements p LEFT JOIN shelves s ON s.user_id = p.user_id AND s.id = p.shelf_id
                WHERE p.user_id = ? ORDER BY p.shelf_id IS NULL, s.position, p.shelf_id, p.position, p.stack_order NULLS FIRST, p.book_id
                """, (ResultSet rs) -> {
            if (rs.getString("shelf_id") == null) {
                drawer.add(rs.getString("book_id"));
                return;
            }
            Double leanAngle = dbl(rs, "lean_angle");
            placements.add(new SyncDtos.Placement(rs.getString("book_id"), rs.getString("shelf_id"), rs.getInt("position"), rs.getString("pose"), rs.getInt("tilt"),
                    rs.getString("stack_id"), (Integer) rs.getObject("stack_order"), dbl(rs, "pos"), leanAngle == null ? null : new SyncDtos.Lean(leanAngle, rs.getString("lean_on")),
                    dbl(rs, "depth"), dbl(rs, "spin"), dbl(rs, "stack_dx"), dbl(rs, "stack_dz"), rs.getBoolean("wall_lean") ? Boolean.TRUE : null, dbl(rs, "pitch")));
        }, user);
        return LayoutRows.withJson(new Layout(null, version, updatedAt, shelves, placements, drawer));
    }

    private static Double dbl(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    private List<Edition> withAuthors(long user, List<Edition> editions) {
        List<String> ids = editions.stream().filter(e -> !Boolean.TRUE.equals(e.deleted())).map(Edition::id).toList();
        if (ids.isEmpty()) return editions;
        Map<String, List<String>> names = new HashMap<>();
        jdbc.query(con -> {
            var ps = con.prepareStatement("SELECT edition_id, name FROM edition_authors WHERE user_id = ? AND edition_id = ANY (?) ORDER BY edition_id, position");
            ps.setLong(1, user);
            ps.setArray(2, ((Connection) con).createArrayOf("text", ids.toArray()));
            return ps;
        }, (ResultSet rs) -> {
            names.computeIfAbsent(rs.getString(1), k -> new ArrayList<>()).add(rs.getString(2));
        });
        return editions.stream().map(e -> Boolean.TRUE.equals(e.deleted()) ? e : new Edition(e.id(), e.isbn13(), e.title(), names.getOrDefault(e.id(), List.of()), e.publisher(),
                e.publishedAt(), e.pageCount(), e.widthMm(), e.heightMm(), e.category(), e.seriesTitle(), e.coverUrl(), e.coverFileId(), e.coverSource(), e.source(),
                e.sourceName(), e.art(), e.createdAt(), e.updatedAt(), false)).toList();
    }

    // ---------- 도우미 ----------

    private static String iso(ResultSet rs, String col) throws SQLException {
        OffsetDateTime t = rs.getObject(col, OffsetDateTime.class);
        return t == null ? null : t.toInstant().toString();
    }

    private static OffsetDateTime ts(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return OffsetDateTime.parse(s);
        } catch (DateTimeParseException e) {
            throw ApiException.BAD_REQUEST;
        }
    }

    private static String orNow(String created, String fallback) {
        return created == null || created.isBlank() ? fallback : created;
    }

    private static LocalDate day(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return LocalDate.parse(s);
        } catch (DateTimeParseException e) {
            throw ApiException.BAD_REQUEST;
        }
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /** 참조하는 항목이 서버에 아직 없으면 409(앱은 부모를 함께 올려 다시 시도), 값이 규칙에 맞지 않으면 400. */
    private static ApiException translate(DataIntegrityViolationException e) {
        Throwable root = e.getMostSpecificCause();
        String state = root instanceof SQLException s ? s.getSQLState() : null;
        if ("23503".equals(state)) return new ApiException(HttpStatus.CONFLICT, "missing_reference", "참조하는 항목이 서버에 아직 없어요");
        return ApiException.BAD_REQUEST;
    }
}
