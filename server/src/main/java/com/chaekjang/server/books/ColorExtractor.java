package com.chaekjang.server.books;

/** 표지 이미지에서 주조색을 뽑는다. */
public interface ColorExtractor {

    String themeColor(String imageUrl) throws Exception;
}
