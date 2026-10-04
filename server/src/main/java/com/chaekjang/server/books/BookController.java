package com.chaekjang.server.books;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BookController {

    private final BookService books;

    public BookController(BookService books) {
        this.books = books;
    }

    @GetMapping("/books/search")
    Map<String, List<SearchItem>> search(@RequestParam(name = "q", defaultValue = "") String q) {
        return Map.of("items", books.search(q));
    }

    @GetMapping("/books/{isbn13}")
    Book get(@PathVariable String isbn13) {
        return books.get(isbn13);
    }
}
