package com.chaekjang.server.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import com.chaekjang.server.PostgresIntegrationTest;

import com.jayway.jsonpath.JsonPath;

/** 인증·동기화·파일 API를 진짜 Postgres(내장)에서 HTTP 형식 그대로 시험한다. */
class SyncApiTest extends PostgresIntegrationTest {

    @Autowired
    WebApplicationContext ctx;
    @Autowired
    JdbcTemplate dummy;

    MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(ctx).build();
    }

    String newToken() throws Exception {
        MvcResult r = mvc.perform(post("/auth/device")).andExpect(status().isCreated()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.token");
    }

    static String bearer(String t) {
        return "Bearer " + t;
    }

    String push(String token, String json) throws Exception {
        return mvc.perform(post("/sync/push").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON).content(json)).andReturn().getResponse().getContentAsString();
    }

    String pull(String token, long since, int limit) throws Exception {
        return mvc.perform(get("/sync/pull?since=" + since + "&limit=" + limit).header("Authorization", bearer(token))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    static final String T1 = "2026-10-05T01:00:00Z";
    static final String T2 = "2026-10-05T02:00:00Z";
    static final String T3 = "2026-10-05T03:00:00Z";

    static String edition(String id, String title, String at) {
        return """
                {"id":"%s","isbn13":"9788937462788","title":"%s","authors":["한강","번역가"],"publisher":"문학동네","publishedAt":"2007-10","pageCount":188,"widthMm":128,"heightMm":205,
                 "category":"813.7","source":"search","art":{"baseColor":"#6B7F92","inkColor":"#F7EEDC","accentColor":"#C9A46A","motifId":"moon","layoutVariant":"spine_b","version":1,"generatedAt":"%s"},
                 "createdAt":"%s","updatedAt":"%s"}""".formatted(id, title, at, T1, at);
    }

    static String book(String id, String editionId, String status, String at) {
        return """
                {"id":"%s","editionId":"%s","status":"%s","rating":4,"note":"좋았다","bindingId":"bd1","createdAt":"%s","updatedAt":"%s"}""".formatted(id, editionId, status, T1, at);
    }

    static String full(String at) {
        return """
                {"editions":[%s],"books":[%s],
                 "bindings":[{"id":"bd1","myBookId":"bk1","spineColor":"#6B7F92","inkColor":"#F7EEDC","accentColor":"#C9A46A","motif":"moon","layout":"spine_b","material":"cloth","coverArtId":"moon-lake","source":"custom","status":"ready","seed":0,"createdAt":"%s","updatedAt":"%s"}],
                 "rounds":[{"id":"rd1","myBookId":"bk1","index":1,"startedAt":"2026-09-01","finishedAt":"2026-09-20","paused":false,"createdAt":"%s","updatedAt":"%s"}],
                 "sessions":[{"id":"ss1","myBookId":"bk1","roundId":"rd1","startedAt":"2026-09-02T10:00:00Z","endedAt":"2026-09-02T10:30:00Z","durationMs":1800000,"pagesRead":20,"createdAt":"%s","updatedAt":"%s"}],
                 "bookmarks":[{"id":"bm1","myBookId":"bk1","text":"서두르지 않아도 괜찮아.","page":128,"memo":"메모","createdAt":"%s","updatedAt":"%s"}],
                 "layout":{"layoutJson":"{\\"version\\":2,\\"shelves\\":[{\\"id\\":\\"s1\\",\\"order\\":0}],\\"placements\\":[],\\"drawer\\":[\\"bk1\\"]}","version":2,"updatedAt":"%s"}}"""
                .formatted(edition("ed1", "채식주의자", at), book("bk1", "ed1", "read", at), T1, at, T1, at, T1, at, T1, at, at);
    }

    @Test
    void 인증_없이는_401() throws Exception {
        mvc.perform(get("/sync/pull")).andExpect(status().isUnauthorized());
        mvc.perform(get("/sync/pull").header("Authorization", "Bearer ck_wrong")).andExpect(status().isUnauthorized());
        mvc.perform(post("/sync/push").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(get("/files/x")).andExpect(status().isUnauthorized());
    }

    @Test
    void 올린_서재를_그대로_받는다_저자_순서와_장정_포함() throws Exception {
        String t = newToken();
        String res = push(t, full(T2));
        assertThat((Integer) JsonPath.read(res, "$.applied")).isEqualTo(7);
        assertThat((List<?>) JsonPath.read(res, "$.skipped")).isEmpty();
        String p = pull(t, 0, 500);
        assertThat((Boolean) JsonPath.read(p, "$.more")).isFalse();
        assertThat((String) JsonPath.read(p, "$.editions[0].title")).isEqualTo("채식주의자");
        assertThat((List<String>) JsonPath.read(p, "$.editions[0].authors")).containsExactly("한강", "번역가");
        assertThat((String) JsonPath.read(p, "$.editions[0].art.motifId")).isEqualTo("moon");
        assertThat((String) JsonPath.read(p, "$.editions[0].art.layoutVariant")).isEqualTo("spine_b");
        assertThat((String) JsonPath.read(p, "$.bindings[0].source")).isEqualTo("custom");
        assertThat((String) JsonPath.read(p, "$.bindings[0].material")).isEqualTo("cloth");
        assertThat((String) JsonPath.read(p, "$.bindings[0].coverArtId")).isEqualTo("moon-lake");
        assertThat((String) JsonPath.read(p, "$.rounds[0].finishedAt")).isEqualTo("2026-09-20");
        assertThat((Integer) JsonPath.read(p, "$.sessions[0].durationMs")).isEqualTo(1800000);
        assertThat((String) JsonPath.read(p, "$.bookmarks[0].text")).isEqualTo("서두르지 않아도 괜찮아.");
        assertThat((String) JsonPath.read(p, "$.layout.layoutJson")).contains("\"drawer\"");
        long rev = ((Number) JsonPath.read(p, "$.rev")).longValue();
        // 이후에는 바뀐 것이 없다
        String again = pull(t, rev, 500);
        assertThat((List<?>) JsonPath.read(again, "$.editions")).isEmpty();
        assertThat((Object) JsonPath.read(again, "$.layout")).isNull();
    }

    @Test
    void 더_새로운_쪽이_이긴다() throws Exception {
        String t = newToken();
        push(t, "{\"editions\":[" + edition("ed1", "새 제목", T3) + "]}");
        String res = push(t, "{\"editions\":[" + edition("ed1", "옛 제목", T2) + "]}");
        assertThat((List<String>) JsonPath.read(res, "$.skipped")).containsExactly("editions:ed1");
        assertThat((String) JsonPath.read(pull(t, 0, 500), "$.editions[0].title")).isEqualTo("새 제목");
    }

    @Test
    void 삭제는_표시로_전달되고_더_새로운_수정은_되살린다() throws Exception {
        String t = newToken();
        push(t, "{\"editions\":[" + edition("ed1", "책", T1) + "]}");
        long r1 = ((Number) JsonPath.read(pull(t, 0, 500), "$.rev")).longValue();
        push(t, "{\"editions\":[{\"id\":\"ed1\",\"deleted\":true,\"updatedAt\":\"" + T2 + "\"}]}");
        String p = pull(t, r1, 500);
        assertThat((Boolean) JsonPath.read(p, "$.editions[0].deleted")).isTrue();
        // 삭제보다 오래된 수정은 무시
        String old = push(t, "{\"editions\":[" + edition("ed1", "되살리기 실패", T1) + "]}");
        assertThat((List<?>) JsonPath.read(old, "$.skipped")).hasSize(1);
        // 더 새로운 수정은 되살림
        push(t, "{\"editions\":[" + edition("ed1", "되살림", T3) + "]}");
        String q = pull(t, 0, 500);
        assertThat((Boolean) JsonPath.read(q, "$.editions[0].deleted")).isFalse();
        assertThat((String) JsonPath.read(q, "$.editions[0].title")).isEqualTo("되살림");
    }

    @Test
    void 다른_사용자의_데이터는_보이지도_참조되지도_않는다() throws Exception {
        String a = newToken();
        String b = newToken();
        push(a, full(T2));
        assertThat((List<?>) JsonPath.read(pull(b, 0, 500), "$.editions")).isEmpty();
        // B가 A의 판본 id를 참조해 내 책을 만들 수 없다
        mvc.perform(post("/sync/push").header("Authorization", bearer(b)).contentType(MediaType.APPLICATION_JSON).content("{\"books\":[" + book("bkX", "ed1", "want", T2) + "]}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("missing_reference"));
    }

    @Test
    void 잘못된_값은_400이고_일부만_반영되지_않는다() throws Exception {
        String t = newToken();
        String bad = "{\"editions\":[" + edition("ed1", "책", T2) + "],\"books\":[" + book("bk1", "ed1", "finished-ish", T2) + "]}";
        mvc.perform(post("/sync/push").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(bad)).andExpect(status().isBadRequest());
        assertThat((List<?>) JsonPath.read(pull(t, 0, 500), "$.editions")).isEmpty(); // 앞의 판본도 반영되지 않았다
        mvc.perform(post("/sync/push").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content("{\"editions\":[{\"id\":\"e\",\"title\":\"t\",\"source\":\"manual\",\"updatedAt\":\"어제\"}]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void 쪽으로_나눠_받아도_빠지는_것이_없다() throws Exception {
        String t = newToken();
        StringBuilder eds = new StringBuilder();
        StringBuilder bks = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            eds.append(i > 0 ? "," : "").append(edition("e" + i, "책" + i, T2));
            bks.append(i > 0 ? "," : "").append(book("b" + i, "e" + i, "want", T2));
        }
        push(t, "{\"editions\":[" + eds + "],\"books\":[" + bks + "]}");
        Set<String> seen = new HashSet<>();
        long since = 0;
        for (int guard = 0; guard < 20; guard++) {
            String p = pull(t, since, 2);
            for (Object id : (List<?>) JsonPath.read(p, "$.editions[*].id")) seen.add("e:" + id);
            for (Object id : (List<?>) JsonPath.read(p, "$.books[*].id")) seen.add("b:" + id);
            since = ((Number) JsonPath.read(p, "$.rev")).longValue();
            if (!(Boolean) JsonPath.read(p, "$.more")) break;
        }
        assertThat(seen).hasSize(10);
    }

    static String layout(String at, String placements, String drawer) {
        return """
                {"layout":{"version":2,"updatedAt":"%s","shelves":[{"id":"s1","order":0},{"id":"s2","order":1}],"placements":[%s],"drawer":[%s]}}""".formatted(at, placements, drawer);
    }

    @Test
    void 배치는_표로_저장되고_같은_모양으로_돌아온다() throws Exception {
        String t = newToken();
        StringBuilder eds = new StringBuilder();
        StringBuilder bks = new StringBuilder();
        for (int i = 1; i <= 4; i++) {
            eds.append(i > 1 ? "," : "").append(edition("ed" + i, "책" + i, T1));
            bks.append(i > 1 ? "," : "").append(book("bk" + i, "ed" + i, "want", T1));
        }
        push(t, "{\"editions\":[" + eds + "],\"books\":[" + bks + "]}");
        String places = """
                {"bookId":"bk2","shelfId":"s2","order":0,"pose":"front","tilt":0,"pos":10.5,"depth":40.25,"spin":-12,"pitch":8.5},
                {"bookId":"bk1","shelfId":"s1","order":0,"pose":"spine","tilt":7,"pos":3,"lean":{"angle":6.25,"on":"bk3"},"x":0.12},
                {"bookId":"bk3","shelfId":"s1","order":1,"pose":"horizontal","tilt":0,"stackId":"st","stackOrder":0},
                {"bookId":"bk1","shelfId":"s2","order":5,"pose":"spine","tilt":0},
                {"bookId":"bk9","shelfId":"없는선반","order":0,"pose":"spine","tilt":0}""";
        String res = push(t, layout(T2, places, "\"bk4\",\"bk3\""));
        assertThat((Integer) JsonPath.read(res, "$.applied")).isEqualTo(1);
        String p = pull(t, 0, 500);
        // 선반 순서 → 자리 순서, 같은 책은 먼저 나온 자리, 없는 선반 자리는 버림, 서랍에서 이미 놓인 책은 뺌
        assertThat((List<String>) JsonPath.read(p, "$.layout.placements[*].bookId")).containsExactly("bk1", "bk3", "bk2");
        assertThat((List<String>) JsonPath.read(p, "$.layout.drawer")).containsExactly("bk4");
        assertThat(((Number) JsonPath.read(p, "$.layout.placements[0].lean.angle")).doubleValue()).isEqualTo(6.25);
        assertThat((String) JsonPath.read(p, "$.layout.placements[0].lean.on")).isEqualTo("bk3");
        assertThat((Integer) JsonPath.read(p, "$.layout.placements[0].tilt")).isEqualTo(7);
        assertThat((String) JsonPath.read(p, "$.layout.placements[1].stackId")).isEqualTo("st");
        assertThat(((Number) JsonPath.read(p, "$.layout.placements[2].pitch")).doubleValue()).isEqualTo(8.5);
        assertThat(((Number) JsonPath.read(p, "$.layout.placements[2].spin")).doubleValue()).isEqualTo(-12.0);
        assertThat(p).doesNotContain("\"x\":"); // 계산값은 저장하지 않는다
        // 예전 앱을 위한 같은 내용의 JSON
        String json = JsonPath.read(p, "$.layout.layoutJson");
        assertThat((List<String>) JsonPath.read(json, "$.placements[*].bookId")).containsExactly("bk1", "bk3", "bk2");
        assertThat((Integer) JsonPath.read(json, "$.version")).isEqualTo(2);
        // 더 오래된 배치는 건너뛴다
        String old = push(t, layout(T1, "", "\"bk1\""));
        assertThat((List<String>) JsonPath.read(old, "$.skipped")).containsExactly("layout");
        // 서버에 없는 책을 가리키면 409(앱은 서재를 전부 올리고 다시 시도)
        mvc.perform(post("/sync/push").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(layout(T3, "", "\"bkX\"")))
                .andExpect(status().isConflict());
    }

    @Test
    void 예전_앱의_배치_JSON도_표로_풀어_저장한다() throws Exception {
        String t = newToken();
        push(t, full(T2));
        String json = "{\\\"version\\\":2,\\\"shelves\\\":[{\\\"id\\\":\\\"s1\\\",\\\"order\\\":0}],\\\"placements\\\":[{\\\"bookId\\\":\\\"bk1\\\",\\\"shelfId\\\":\\\"s1\\\",\\\"order\\\":0,\\\"pose\\\":\\\"front\\\",\\\"tilt\\\":0,\\\"wallLean\\\":true,\\\"x\\\":0.5}],\\\"drawer\\\":[]}";
        String res = push(t, "{\"layout\":{\"layoutJson\":\"" + json + "\",\"version\":2,\"updatedAt\":\"" + T3 + "\"}}");
        assertThat((Integer) JsonPath.read(res, "$.applied")).isEqualTo(1);
        String p = pull(t, 0, 500);
        assertThat((String) JsonPath.read(p, "$.layout.placements[0].pose")).isEqualTo("front");
        assertThat((Boolean) JsonPath.read(p, "$.layout.placements[0].wallLean")).isTrue();
        assertThat((List<?>) JsonPath.read(p, "$.layout.drawer")).isEmpty();
    }

    @Test
    void 사진_파일_올리기와_받기_사진_갈피_참조() throws Exception {
        String a = newToken();
        String b = newToken();
        byte[] jpg = {(byte) 0xFF, (byte) 0xD8, 1, 2, 3, 4};
        mvc.perform(put("/files/page-1.jpg").header("Authorization", bearer(a)).contentType("image/jpeg").content(jpg)).andExpect(status().isNoContent());
        byte[] back = mvc.perform(get("/files/page-1.jpg").header("Authorization", bearer(a))).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        assertThat(back).isEqualTo(jpg);
        mvc.perform(get("/files/page-1.jpg").header("Authorization", bearer(b))).andExpect(status().isNotFound());
        mvc.perform(put("/files/bad.txt").header("Authorization", bearer(a)).contentType("text/plain").content("x")).andExpect(status().isBadRequest());
        mvc.perform(put("/files/..%2Fx").header("Authorization", bearer(a)).contentType("image/png").content(jpg)).andExpect(status().is4xxClientError());
        // 사진 갈피: 문장 없이 사진만으로 저장, 사진이 없으면 문장이 있어야 한다
        push(a, "{\"editions\":[" + edition("ed1", "책", T1) + "],\"books\":[" + book("bk1", "ed1", "read", T1) + "]}");
        String ok = push(a, "{\"bookmarks\":[{\"id\":\"bm1\",\"myBookId\":\"bk1\",\"text\":\"\",\"photoFileId\":\"page-1.jpg\",\"photoRatio\":1.32,\"createdAt\":\"" + T1 + "\",\"updatedAt\":\"" + T1 + "\"}]}");
        assertThat((Integer) JsonPath.read(ok, "$.applied")).isEqualTo(1);
        String p = pull(a, 0, 500);
        assertThat((String) JsonPath.read(p, "$.bookmarks[0].photoFileId")).isEqualTo("page-1.jpg");
        assertThat(((Number) JsonPath.read(p, "$.bookmarks[0].photoRatio")).doubleValue()).isBetween(1.31, 1.33);
        mvc.perform(post("/sync/push").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookmarks\":[{\"id\":\"bm2\",\"myBookId\":\"bk1\",\"text\":\"\",\"createdAt\":\"" + T1 + "\",\"updatedAt\":\"" + T1 + "\"}]}")).andExpect(status().isBadRequest());
        // 없는 파일을 가리키면 409
        mvc.perform(post("/sync/push").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookmarks\":[{\"id\":\"bm3\",\"myBookId\":\"bk1\",\"text\":\"\",\"photoFileId\":\"none.jpg\",\"createdAt\":\"" + T1 + "\",\"updatedAt\":\"" + T1 + "\"}]}")).andExpect(status().isConflict());
    }
}
