package com.chaekjang.server.account;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

import javax.sql.DataSource;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chaekjang.server.common.ApiException;

/**
 * 계정과 기기 토큰. 지금은 앱이 처음 켜질 때 기기 계정을 하나 만들고 토큰(Bearer)으로 접근한다.
 * 소셜 로그인(apple/google/kakao)은 auth_identities에 연결하면 같은 사용자로 합칠 수 있게 표를 미리 나눠 두었다(검증기는 아직 없다).
 * 토큰 원문은 저장하지 않고 SHA-256만 둔다.
 */
@Service
public class AccountService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ApiException UNAUTHORIZED = new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "로그인이 필요해요");

    private final JdbcTemplate jdbc;

    public AccountService(DataSource ds) {
        this.jdbc = new JdbcTemplate(ds);
    }

    public record Created(long userId, String token) {
    }

    @Transactional
    public Created createDeviceAccount() {
        Long id = jdbc.queryForObject("INSERT INTO users DEFAULT VALUES RETURNING id", Long.class);
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String token = "ck_" + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        jdbc.update("INSERT INTO api_tokens (token_hash, user_id) VALUES (?, ?)", sha256(token), id);
        return new Created(id, token);
    }

    /** Authorization: Bearer ck_... → 사용자 id. 없거나 틀리면 401. */
    @Transactional
    public long authenticate(String header) {
        if (header == null || !header.startsWith("Bearer ")) throw UNAUTHORIZED;
        String token = header.substring(7).trim();
        if (token.isEmpty() || token.length() > 200) throw UNAUTHORIZED;
        List<Long> ids = jdbc.queryForList("UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ? RETURNING user_id", Long.class, sha256(token));
        if (ids.isEmpty()) throw UNAUTHORIZED;
        return ids.get(0);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
