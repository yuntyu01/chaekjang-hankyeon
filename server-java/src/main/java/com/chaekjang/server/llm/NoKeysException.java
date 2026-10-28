package com.chaekjang.server.llm;

public class NoKeysException extends RuntimeException {

    public NoKeysException() {
        super("llm: 사용할 수 있는 키가 없어요");
    }
}
