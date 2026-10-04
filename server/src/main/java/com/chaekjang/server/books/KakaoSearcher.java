package com.chaekjang.server.books;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 카카오(다음) 책 검색 API 클라이언트. */
public class KakaoSearcher implements Searcher {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String key;
    private final String baseUrl;
    private final HttpClient http;

    public KakaoSearcher(String key) {
        this(key, "https://dapi.kakao.com", HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build());
    }

    public KakaoSearcher(String key, String baseUrl, HttpClient http) {
        this.key = key;
        this.baseUrl = baseUrl;
        this.http = http;
    }

    private List<SearchItem> call(Map<String, String> params) throws IOException, InterruptedException {
        String query = params.entrySet().stream()
                .map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/v3/search/book?" + query))
                .timeout(Duration.ofSeconds(6))
                .header("Authorization", "KakaoAK " + key)
                .GET().build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) throw new IOException("kakao search: status " + res.statusCode());
        List<SearchItem> items = new ArrayList<>();
        for (JsonNode doc : JSON.readTree(res.body()).path("documents")) {
            items.add(toItem(doc));
        }
        return items;
    }

    private static String isbn13Of(String s) {
        for (String part : s.trim().split("\\s+")) {
            if (part.length() == 13) return part;
        }
        return "";
    }

    private static SearchItem toItem(JsonNode d) {
        String date = d.path("datetime").asString("");
        if (date.length() >= 10) date = date.substring(0, 10);
        List<String> authors = new ArrayList<>();
        d.path("authors").forEach(a -> authors.add(a.asString("")));
        return new SearchItem(isbn13Of(d.path("isbn").asString("")), d.path("title").asString(""), authors,
                d.path("publisher").asString(""), date, d.path("thumbnail").asString(""), d.path("contents").asString(""));
    }

    @Override
    public List<SearchItem> search(String query) throws IOException, InterruptedException {
        return call(Map.of("query", query, "size", "30")).stream().filter(it -> !it.isbn13().isEmpty()).toList();
    }

    @Override
    public SearchItem lookupIsbn(String isbn13) throws IOException, InterruptedException {
        return call(Map.of("query", isbn13, "target", "isbn")).stream()
                .filter(it -> it.isbn13().equals(isbn13)).findFirst().orElse(null);
    }
}
