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
 * 소셜 로그인은 auth_identities에 연결한다(kakao는 KakaoLoginService, apple/google 검증기는 아직 없다).
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
        return new Created(id, issueToken(id));
    }

    /** 그 사용자의 새 토큰을 만든다(원문은 반환값으로만 한 번 나간다). */
    public String issueToken(long userId) {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String token = "ck_" + Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        jdbc.update("INSERT INTO api_tokens (token_hash, user_id) VALUES (?, ?)", sha256(token), userId);
        return token;
    }

    /** Authorization: Bearer ck_... → 사용자 id. 없거나 틀리면 401. */
    @Transactional
    public long authenticate(String header) {
        if (header == null || !header.startsWith("Bearer ")) throw UNAUTHORIZED;
        String token = header.substring(7).trim();
        if (token.isEmpty() || token.length() > 200) throw UNAUTHORIZED;
        // 요청마다 쓰지 않게 마지막 사용 시각은 한 시간에 한 번만 고친다(읽기는 기본키 조회 한 번)
        String hash = sha256(token);
        List<Object[]> rows = jdbc.query("SELECT user_id, last_used_at < now() - interval '1 hour' FROM api_tokens WHERE token_hash = ?",
                (rs, i) -> new Object[] {rs.getLong(1), rs.getBoolean(2)}, hash);
        if (rows.isEmpty()) throw UNAUTHORIZED;
        if ((Boolean) rows.get(0)[1]) jdbc.update("UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ?", hash);
        return (Long) rows.get(0)[0];
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
