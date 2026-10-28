package com.chaekjang.server.llm;

/**
 * @param image 선택. 긴 변 1024px로 줄인 사진
 * @param mimeType image/jpeg 등
 * @param json JSON 응답 강제
 */
public record LlmRequest(String prompt, byte[] image, String mimeType, boolean json, int maxTokens) {

    public static LlmRequest of(String prompt) {
        return new LlmRequest(prompt, null, null, false, 0);
    }
}
