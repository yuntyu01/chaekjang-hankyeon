package com.chaekjang.server.llm;

import java.time.Duration;
import java.util.Map;

public class LlmException extends RuntimeException {

    public enum Kind {
        QUOTA("quota"), // 429, 사용량·요금 한도
        AUTH("auth"), // 401/403, 키 문제
        SERVER("server"), // 5xx
        TIMEOUT("timeout"), // 응답 없음
        TOKENS("tokens"), // 입력/출력 토큰 한도
        BLOCKED("blocked"), // 안전 필터 등으로 응답 거부
        NETWORK("network"), // 연결 실패
        BAD_REQUEST("bad_request"); // 요청 자체가 잘못됨(다른 키로도 같음)

        private final String id;

        Kind(String id) {
            this.id = id;
        }

        @Override
        public String toString() {
            return id;
        }
    }

    /** 실패한 키를 쉬게 하는 시간. 여기 없는 종류는 쉬지 않는다. */
    static final Map<Kind, Duration> COOLDOWNS = Map.of(
            Kind.QUOTA, Duration.ofMinutes(1),
            Kind.AUTH, Duration.ofMinutes(30),
            Kind.SERVER, Duration.ofSeconds(15),
            Kind.TIMEOUT, Duration.ofSeconds(15),
            Kind.NETWORK, Duration.ofSeconds(15));

    private final Kind kind;
    private final int status;
    private final Provider provider;

    public LlmException(Kind kind, int status, Provider provider, String msg) {
        super(provider + " " + kind + " (" + status + "): " + msg);
        this.kind = kind;
        this.status = status;
        this.provider = provider;
    }

    public Kind kind() {
        return kind;
    }

    public int status() {
        return status;
    }

    public Provider provider() {
        return provider;
    }

    /** 다음 키로 넘겨도 되는 오류인가. 요청 자체가 잘못된 경우만 멈춘다. */
    public boolean fallback() {
        return kind != Kind.BAD_REQUEST;
    }

    static LlmException classifyStatus(Provider p, int status, String msg) {
        Kind k = Kind.BAD_REQUEST;
        if (status == 429) k = Kind.QUOTA;
        else if (status == 401 || status == 403) k = Kind.AUTH;
        else if (status == 408 || status == 504) k = Kind.TIMEOUT;
        else if (status >= 500) k = Kind.SERVER;
        return new LlmException(k, status, p, msg);
    }
}
