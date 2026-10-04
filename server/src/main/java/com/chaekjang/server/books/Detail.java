package com.chaekjang.server.books;

/**
 * 카카오 검색에 없는 정보(고해상도 표지, 쪽수, 판형)를 보강한다.
 * 알라딘 OpenAPI는 2026-10-30 종료라 쓰지 않는다. 대체 출처는 미정(Detailer 구현만 바꾸면 된다).
 */
public record Detail(String coverUrl, int pageCount, String format, String description, String link) {

    public static final Detail EMPTY = new Detail("", 0, "", "", "");
}
