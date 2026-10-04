package com.chaekjang.server.books;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpServer;

class KakaoSearcherTest {

    @Test
    void searchAndLookup() throws Exception {
        HttpServer srv = HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            if (!"KakaoAK k1".equals(ex.getRequestHeaders().getFirst("Authorization"))) {
                ex.sendResponseHeaders(401, -1);
            } else {
                byte[] body = """
                        {"documents":[{"title":"데미안","isbn":"8937460440 9788937460449","datetime":"2000-12-20T00:00:00.000+09:00","authors":["헤르만 헤세"],"publisher":"민음사","thumbnail":"https://t/x.jpg"},{"title":"isbn 없음","isbn":""}]}"""
                        .getBytes(StandardCharsets.UTF_8);
                ex.getResponseHeaders().add("Content-Type", "application/json");
                ex.sendResponseHeaders(200, body.length);
                ex.getResponseBody().write(body);
            }
            ex.close();
        });
        srv.start();
        try {
            String base = "http://127.0.0.1:" + srv.getAddress().getPort();
            var http = HttpClient.newHttpClient();
            var k = new KakaoSearcher("k1", base, http);
            var items = k.search("데미안");
            assertThat(items).hasSize(1);
            assertThat(items.get(0).isbn13()).isEqualTo(BookServiceTest.ISBN);
            assertThat(items.get(0).publishedAt()).isEqualTo("2000-12-20");
            assertThat(k.lookupIsbn(BookServiceTest.ISBN).publisher()).isEqualTo("민음사");
            assertThat(k.lookupIsbn("9788996991342")).isNull();
            assertThatThrownBy(() -> new KakaoSearcher("bad", base, http).search("x")).hasMessageContaining("401");
        } finally {
            srv.stop(0);
        }
    }
}
