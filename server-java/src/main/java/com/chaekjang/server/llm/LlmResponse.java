package com.chaekjang.server.llm;

public record LlmResponse(String text, Provider provider, String keyLabel) {
}
