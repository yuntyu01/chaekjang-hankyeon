package com.chaekjang.server.common;

import org.springframework.http.HttpStatus;

/** 응답 오류 형식: {"error": {"code": "...", "message": "..."}} */
public class ApiException extends RuntimeException {

    public static final ApiException NOT_FOUND = new ApiException(HttpStatus.NOT_FOUND, "not_found", "찾을 수 없어요");
    public static final ApiException BAD_REQUEST = new ApiException(HttpStatus.BAD_REQUEST, "bad_request", "요청 형식이 올바르지 않아요");
    public static final ApiException UPSTREAM = new ApiException(HttpStatus.BAD_GATEWAY, "upstream_error", "외부 서비스 응답이 없어요");

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        // 공유 상수라 스택 트레이스는 쓰지 않는다.
        super(message, null, false, false);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
