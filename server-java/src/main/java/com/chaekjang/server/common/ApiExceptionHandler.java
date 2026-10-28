package com.chaekjang.server.common;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** 모든 오류를 {"error": {"code", "message"}} 형식으로 낸다. */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> api(ApiException e) {
        return body(e.status(), e.code(), e.getMessage());
    }

    /** 없는 경로(404)·허용 안 되는 메서드(405)·잘못된 파라미터(400) 등 Spring이 던지는 표준 오류. */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object ignored, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        if (status.is4xxClientError()) {
            ApiException known = status.value() == 404 ? ApiException.NOT_FOUND
                    : status.value() == 400 ? ApiException.BAD_REQUEST : null;
            if (known != null) return body(known.status(), known.code(), known.getMessage());
            HttpStatus s = HttpStatus.valueOf(status.value());
            return body(s, s.name().toLowerCase(), s.getReasonPhrase());
        }
        log.error("internal error", ex);
        return internalBody();
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> internal(Exception e) {
        log.error("internal error", e);
        return internalBody();
    }

    private static ResponseEntity<Object> internalBody() {
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "internal", "서버 오류가 났어요");
    }

    private static ResponseEntity<Object> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of("error", Map.of("code", code, "message", message)));
    }
}
