package com.chaekjang.server.file;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.sun.net.httpserver.HttpServer;

class FileStoreTest {

    @Test
    void 버킷이_없으면_디스크(@TempDir Path dir) throws Exception {
        FileStore store = new FileStore(dir.toString(), "", "", "", "", "");
        store.put("7/a.png", new byte[] {1, 2, 3});
        assertThat(Files.readAllBytes(dir.resolve("7/a.png"))).containsExactly(1, 2, 3);
        try (InputStream in = store.open("7/a.png")) {
            assertThat(in.readAllBytes()).containsExactly(1, 2, 3);
        }
        assertThatThrownBy(() -> store.put("../x", new byte[] {1})).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 버킷이_있으면_S3_경로_방식으로_서명해_올리고_받는다(@TempDir Path dir) throws Exception {
        Map<String, byte[]> objects = new ConcurrentHashMap<>();
        List<String> seen = new ArrayList<>();
        HttpServer srv = HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        srv.createContext("/", ex -> {
            String path = ex.getRequestURI().getPath();
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            synchronized (seen) {
                seen.add(ex.getRequestMethod() + " " + path + " " + (auth != null && auth.startsWith("AWS4-HMAC-SHA256 Credential=ak/")));
            }
            if ("PUT".equals(ex.getRequestMethod())) {
                objects.put(path, ex.getRequestBody().readAllBytes());
                ex.getResponseHeaders().add("ETag", "\"e\"");
                ex.sendResponseHeaders(200, -1);
            } else if (objects.containsKey(path)) {
                byte[] body = objects.get(path);
                ex.getResponseHeaders().add("Content-Type", "image/png");
                ex.sendResponseHeaders(200, body.length);
                ex.getResponseBody().write(body);
            } else {
                byte[] body = "<Error><Code>NoSuchKey</Code></Error>".getBytes();
                ex.sendResponseHeaders(404, body.length);
                ex.getResponseBody().write(body);
            }
            ex.close();
        });
        srv.start();
        try {
            String endpoint = "http://127.0.0.1:" + srv.getAddress().getPort();
            FileStore store = new FileStore(dir.toString(), "kd-covebook", endpoint, "auto", "ak", "sk");
            store.put("7/page-1.png", new byte[] {9, 8, 7});
            assertThat(objects.get("/kd-covebook/7/page-1.png")).containsExactly(9, 8, 7);
            try (InputStream in = store.open("7/page-1.png")) {
                assertThat(in.readAllBytes()).containsExactly(9, 8, 7);
            }
            assertThat(seen).containsExactly("PUT /kd-covebook/7/page-1.png true", "GET /kd-covebook/7/page-1.png true");
            // 디스크에는 아무것도 쓰지 않는다
            try (var files = Files.list(dir)) {
                assertThat(files).isEmpty();
            }
            assertThatThrownBy(() -> store.open("7/none.png")).isInstanceOf(IOException.class);
        } finally {
            srv.stop(0);
        }
    }
}
