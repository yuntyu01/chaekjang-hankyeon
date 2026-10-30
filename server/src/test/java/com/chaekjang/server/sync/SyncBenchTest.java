package com.chaekjang.server.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import com.chaekjang.server.PostgresIntegrationTest;
import com.jayway.jsonpath.JsonPath;

/**
 * 동기화 속도 측정(평소에는 건너뛴다): SYNC_BENCH=1 ./gradlew test --tests '*SyncBenchTest'
 * 책 300권(판본·내 책·장정·회차) + 세션 1000 + 갈피 600 + 배치를 한 번에 올리고, 처음부터 받는 시간을 잰다.
 */
@EnabledIfEnvironmentVariable(named = "SYNC_BENCH", matches = ".+")
class SyncBenchTest extends PostgresIntegrationTest {

    static final int BOOKS = 300;
    static final int SESSIONS = 1000;
    static final int BOOKMARKS = 600;
    static final String T = "2026-10-05T01:00:00Z";

    @Autowired
    WebApplicationContext ctx;

    static String body() {
        StringBuilder ed = new StringBuilder(), bk = new StringBuilder(), bd = new StringBuilder(), rd = new StringBuilder(), ss = new StringBuilder(), bm = new StringBuilder();
        StringBuilder shelves = new StringBuilder(), places = new StringBuilder(), drawer = new StringBuilder();
        for (int i = 0; i < BOOKS; i++) {
            String c = i > 0 ? "," : "";
            ed.append(c).append("""
                    {"id":"ed%d","isbn13":"9788937462788","title":"책 %d","authors":["지은이 %d","옮긴이"],"publisher":"출판사","publishedAt":"2007-10","pageCount":%d,
                     "source":"search","art":{"baseColor":"#6B7F92","inkColor":"#F7EEDC","accentColor":"#C9A46A","motifId":"moon","layoutVariant":"spine_b","version":1,"generatedAt":"%s"},
                     "createdAt":"%s","updatedAt":"%s"}""".formatted(i, i, i, 150 + i, T, T, T));
            bk.append(c).append("""
                    {"id":"bk%d","editionId":"ed%d","status":"read","rating":4,"note":"좋았다","bindingId":"bd%d","createdAt":"%s","updatedAt":"%s"}""".formatted(i, i, i, T, T));
            bd.append(c).append("""
                    {"id":"bd%d","myBookId":"bk%d","spineColor":"#6B7F92","motif":"moon","source":"default","status":"ready","seed":0,"createdAt":"%s","updatedAt":"%s"}""".formatted(i, i, T, T));
            rd.append(c).append("""
                    {"id":"rd%d","myBookId":"bk%d","index":1,"startedAt":"2026-09-01","finishedAt":"2026-09-20","createdAt":"%s","updatedAt":"%s"}""".formatted(i, i, T, T));
            if (i < 240) places.append(places.length() > 0 ? "," : "").append("""
                    {"bookId":"bk%d","shelfId":"s%d","order":%d,"pose":"spine","tilt":0,"pos":%d.5,"depth":12.25}""".formatted(i, i / 20, i % 20, (i % 20) * 30));
            else drawer.append(drawer.length() > 0 ? "," : "").append("\"bk").append(i).append('"');
        }
        for (int s = 0; s < 12; s++) shelves.append(s > 0 ? "," : "").append("{\"id\":\"s").append(s).append("\",\"order\":").append(s).append('}');
        for (int i = 0; i < SESSIONS; i++) ss.append(i > 0 ? "," : "").append("""
                {"id":"ss%d","myBookId":"bk%d","roundId":"rd%d","startedAt":"2026-09-02T10:00:00Z","endedAt":"2026-09-02T10:30:00Z","durationMs":1800000,"pagesRead":20,"createdAt":"%s","updatedAt":"%s"}"""
                .formatted(i, i % BOOKS, i % BOOKS, T, T));
        for (int i = 0; i < BOOKMARKS; i++) bm.append(i > 0 ? "," : "").append("""
                {"id":"bm%d","myBookId":"bk%d","text":"서두르지 않아도 괜찮아. %d","page":%d,"createdAt":"%s","updatedAt":"%s"}""".formatted(i, i % BOOKS, i, 1 + i % 300, T, T));
        String layout = "{\"version\":2,\"shelves\":[" + shelves + "],\"placements\":[" + places + "],\"drawer\":[" + drawer + "]}";
        return "{\"editions\":[" + ed + "],\"books\":[" + bk + "],\"bindings\":[" + bd + "],\"rounds\":[" + rd + "],\"sessions\":[" + ss + "],\"bookmarks\":[" + bm
                + "],\"layout\":{\"layoutJson\":" + quote(layout) + ",\"version\":2,\"updatedAt\":\"" + T + "\"}}";
    }

    static String quote(String s) {
        return '"' + s.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }

    @Test
    void 측정() throws Exception {
        MockMvc mvc = MockMvcBuilders.webAppContextSetup(ctx).build();
        String json = body();
        // 첫 회는 JIT·연결 풀 데우기라 버리고, 사용자를 바꿔 가며 잰다
        long[] push = new long[4], pull = new long[4], small = new long[4];
        for (int r = 0; r < push.length; r++) {
            MvcResult a = mvc.perform(post("/auth/device")).andExpect(status().isCreated()).andReturn();
            String token = "Bearer " + JsonPath.read(a.getResponse().getContentAsString(), "$.token");
            long t0 = System.nanoTime();
            String res = mvc.perform(post("/sync/push").header("Authorization", token).contentType(MediaType.APPLICATION_JSON).content(json))
                    .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            push[r] = (System.nanoTime() - t0) / 1_000_000;
            assertThat((Integer) JsonPath.read(res, "$.applied")).isEqualTo(BOOKS * 4 + SESSIONS + BOOKMARKS + 1);
            t0 = System.nanoTime();
            long since = 0;
            int got = 0;
            for (int guard = 0; guard < 50; guard++) {
                String p = mvc.perform(get("/sync/pull?since=" + since + "&limit=500").header("Authorization", token)).andExpect(status().isOk()).andReturn().getResponse()
                        .getContentAsString();
                got += ((java.util.List<?>) JsonPath.read(p, "$.sessions")).size();
                since = ((Number) JsonPath.read(p, "$.rev")).longValue();
                if (!(Boolean) JsonPath.read(p, "$.more")) break;
            }
            pull[r] = (System.nanoTime() - t0) / 1_000_000;
            assertThat(got).isEqualTo(SESSIONS);
            // 평소 동기화: 한 권 고치고 올린 뒤 받기(인증 포함 왕복 두 번)
            t0 = System.nanoTime();
            mvc.perform(post("/sync/push").header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"books\":[{\"id\":\"bk1\",\"editionId\":\"ed1\",\"status\":\"reading\",\"createdAt\":\"" + T + "\",\"updatedAt\":\"2026-10-06T01:00:00Z\"}]}"))
                    .andExpect(status().isOk());
            mvc.perform(get("/sync/pull?since=" + since + "&limit=500").header("Authorization", token)).andExpect(status().isOk());
            small[r] = (System.nanoTime() - t0) / 1_000_000;
        }
        System.out.printf("[bench] push(full) ms=%s pull(full) ms=%s small push+pull ms=%s%n", java.util.Arrays.toString(push), java.util.Arrays.toString(pull),
                java.util.Arrays.toString(small));
    }
}
