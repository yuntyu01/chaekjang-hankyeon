package com.chaekjang.server.external;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.imageio.ImageIO;

/** 표지 이미지를 받아 주조색을 뽑는다(최대 5MB). */
public class HttpColorExtractor implements ColorExtractor {

    private static final int MAX_BYTES = 5 << 20;

    private final HttpClient http;

    public HttpColorExtractor() {
        this(HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(8)).build());
    }

    public HttpColorExtractor(HttpClient http) {
        this.http = http;
    }

    @Override
    public String themeColor(String url) throws IOException, InterruptedException {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).GET().build();
        HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream in = res.body()) {
            if (res.statusCode() != 200) throw new IOException("cover " + url + ": " + res.statusCode());
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(in.readNBytes(MAX_BYTES)));
            if (img == null) throw new IOException("cover " + url + ": 이미지를 해석할 수 없어요");
            return dominantColor(img);
        }
    }

    private record Acc(int n, int r, int g, int b) {
    }

    /**
     * 표지의 주조색을 고른다. 거의 흰색·검은색(여백, 글자)은 빼고
     * 채널당 16단계로 묶은 색 중 가장 많은 묶음의 평균을 쓴다. 전부 빠지면 전체에서 고른다.
     */
    public static String dominantColor(BufferedImage img) {
        Acc best = pick(img, true);
        if (best == null) best = pick(img, false);
        if (best == null) return ""; // 못 고르면 비워 두고 BookService가 기본색을 쓴다
        return String.format("#%02X%02X%02X", best.r / best.n, best.g / best.n, best.b / best.n);
    }

    private static Acc pick(BufferedImage img, boolean skipExtremes) {
        Map<Integer, Acc> buckets = new LinkedHashMap<>(); // 같은 개수면 먼저 나온 묶음이 이긴다
        int w = img.getWidth(), h = img.getHeight();
        int step = Math.max(1, w / 80);
        for (int y = 0; y < h; y += step) {
            for (int x = 0; x < w; x += step) {
                int argb = img.getRGB(x, y);
                if ((argb >>> 24) < 0x80) continue;
                int r = (argb >> 16) & 0xFF, g = (argb >> 8) & 0xFF, b = argb & 0xFF;
                if (skipExtremes && ((r > 238 && g > 238 && b > 238) || (r < 22 && g < 22 && b < 22))) continue;
                int k = (r >> 4) << 8 | (g >> 4) << 4 | b >> 4;
                buckets.merge(k, new Acc(1, r, g, b),
                        (a, c) -> new Acc(a.n + 1, a.r + c.r, a.g + c.g, a.b + c.b));
            }
        }
        Acc best = null;
        for (Acc a : buckets.values()) {
            if (best == null || a.n > best.n) best = a;
        }
        return best;
    }
}
