package com.chaekjang.server.book;

import org.springframework.data.jpa.repository.JpaRepository;

/** books 테이블. 키는 ISBN-13. */
public interface BookRepository extends JpaRepository<Book, String> {
}
