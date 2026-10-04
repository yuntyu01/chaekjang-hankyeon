package com.chaekjang.server.llm;

import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** LLM_KEYS(공급자:키 목록)로 게이트웨이를 만든다. 비어 있으면 사용 가능한 키 0개로 뜬다. */
@Configuration
public class LlmConfig {

    private static final Logger log = LoggerFactory.getLogger(LlmConfig.class);

    @Bean
    LlmGateway llmGateway(@Value("${LLM_KEYS:}") String rawKeys,
            @Value("${GEMINI_MODEL:}") String geminiModel,
            @Value("${OPENAI_MODEL:}") String openaiModel) {
        List<LlmKey> keys = LlmKey.parse(rawKeys);
        LlmGateway gw = new LlmGateway(keys, Map.of(Provider.GEMINI, geminiModel, Provider.OPENAI, openaiModel), null, null, null);
        log.info("llm keys registered={} usable={}", keys.size(), gw.available());
        return gw;
    }
}
