package com.chaekjang.server.llm;

import java.time.Duration;

/** 제공자별 호출 구현. */
public interface LlmClient {

    /** 실패는 {@link LlmException}이나 입출력 예외로 던진다(게이트웨이가 분류한다). */
    String generate(LlmKey key, String model, LlmRequest req, Duration timeout) throws Exception;
}
