package com.chaekjang.server.book;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chaekjang.server.external.SearchItem;

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
    BookResponse get(@PathVariable String isbn13) {
        return BookResponse.of(books.get(isbn13));
    }
}
