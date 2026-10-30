package com.chaekjang.server.sync;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/** V6: 배치 JSON(shelf_layouts.layout)이 선반·책 자리 표로 옮겨지는지(빈 DB를 V5까지 올리고 JSON을 넣은 뒤 V6). */
class LayoutMigrationTest {

    @Test
    void 배치_JSON을_표로_옮긴다() throws Exception {
        try (EmbeddedPostgres pg = EmbeddedPostgres.start()) {
            DataSource ds = pg.getPostgresDatabase();
            Flyway.configure().dataSource(ds).locations("classpath:db/migration").target("5").load().migrate();
            JdbcTemplate jdbc = new JdbcTemplate(ds);
            long u = jdbc.queryForObject("INSERT INTO users DEFAULT VALUES RETURNING id", Long.class);
            jdbc.update("INSERT INTO editions (user_id, id, title, source, created_at, updated_at, rev) VALUES (?, 'ed1', '책', 'manual', now(), now(), 1)", u);
            for (String b : List.of("bk1", "bk2", "bk3", "bk4"))
                jdbc.update("INSERT INTO my_books (user_id, id, edition_id, status, created_at, updated_at, rev) VALUES (?, ?, 'ed1', 'want', now(), now(), 1)", u, b);
            String layout = """
                    {"version":2,"shelves":[{"id":"s1","order":0},{"id":"s2","order":1}],
                     "placements":[{"bookId":"bk1","shelfId":"s1","order":0,"pose":"spine","tilt":-7,"pos":3.5,"lean":{"angle":-5.5,"on":"bk2"},"x":0.1},
                                   {"bookId":"bk2","shelfId":"s1","order":1,"pose":"front","tilt":0,"pitch":12,"spin":4},
                                   {"bookId":"bk1","shelfId":"s2","order":0,"pose":"spine","tilt":0},
                                   {"bookId":"gone","shelfId":"s1","order":2,"pose":"spine","tilt":0}],
                     "drawer":["bk3","bk2","gone","bk4"]}""";
            jdbc.update("INSERT INTO shelf_layouts (user_id, layout, version, rev) VALUES (?, ?::jsonb, 2, 5)", u, layout);

            Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();

            assertThat(jdbc.queryForList("SELECT id FROM shelves WHERE user_id = ? ORDER BY position", String.class, u)).containsExactly("s1", "s2");
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT book_id, shelf_id, position, pose, tilt, pos, lean_angle, lean_on, pitch, spin FROM shelf_placements WHERE user_id = ? ORDER BY shelf_id NULLS LAST, position", u);
            assertThat(rows).extracting(r -> r.get("book_id")).containsExactly("bk1", "bk2", "bk3", "bk4");
            assertThat(rows.get(0)).containsEntry("shelf_id", "s1").containsEntry("tilt", -7).containsEntry("pos", 3.5).containsEntry("lean_angle", -5.5)
                    .containsEntry("lean_on", "bk2");
            assertThat(rows.get(1)).containsEntry("pose", "front").containsEntry("pitch", 12.0).containsEntry("spin", 4.0);
            assertThat(rows.get(2)).containsEntry("shelf_id", null).containsEntry("position", 0);
            assertThat(rows.get(3)).containsEntry("shelf_id", null).containsEntry("position", 3);
            assertThat(jdbc.queryForObject("SELECT rev FROM shelf_layouts WHERE user_id = ?", Long.class, u)).isEqualTo(5L);
        }
    }
}
