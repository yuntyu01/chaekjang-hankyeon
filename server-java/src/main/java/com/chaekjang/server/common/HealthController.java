package com.chaekjang.server.common;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.chaekjang.server.book.BookService;
import com.chaekjang.server.llm.LlmGateway;

@RestController
public class HealthController {

    private final BookService books;
    private final LlmGateway llm;

    public HealthController(BookService books, LlmGateway llm) {
        this.books = books;
        this.llm = llm;
    }

    @GetMapping("/healthz")
    Map<String, Object> healthz() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        body.put("books", books.source());
        body.put("llmKeys", llm.available());
        return body;
    }
}
