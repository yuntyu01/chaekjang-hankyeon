package com.chaekjang.server.books;

/** 보강 정보 조회. 없으면 null. */
public interface Detailer {

    Detail detail(String isbn13) throws Exception;
}
