package com.chaekjang.server.llm;

public enum Provider {
    GEMINI("gemini"),
    OPENAI("openai");

    private final String id;

    Provider(String id) {
        this.id = id;
    }

    public String id() {
        return id;
    }

    @Override
    public String toString() {
        return id;
    }
}
