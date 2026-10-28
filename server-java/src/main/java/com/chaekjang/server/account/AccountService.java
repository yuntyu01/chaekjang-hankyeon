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
 * 소셜 로그인은 auth_identities의 공급자·회원번호로 연결한다(카카오·Google). 이메일이 같다고 자동 연결하지 않는다.
 * 토큰 원문은 저장하지 않고 SHA-256만 둔다.
 */
@Service
public class AccountService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ApiException UNAUTHORIZED = new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "로그인이 필요해요");

    private final JdbcTemplate jdbc;
    private final AccountDeletionService deletions;

    public AccountService(DataSource ds,AccountDeletionService deletions) {
        this.jdbc = new JdbcTemplate(ds);
        this.deletions = deletions;
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
        // An upload/sync transaction holds this lock until its metadata is committed. Erasure
        // locks the same user before enumerating files, so an in-flight upload cannot be orphaned.
        List<Object[]> ids = jdbc.query("SELECT u.id,u.created_at FROM api_tokens t JOIN users u ON t.user_id=u.id WHERE t.token_hash=? FOR KEY SHARE OF u",
                (rs,i)->new Object[]{rs.getLong(1),rs.getTimestamp(2).toInstant().toString()},sha256(token));
        if (ids.isEmpty()) throw UNAUTHORIZED;
        long id=(Long)ids.get(0)[0];
        if(deletions.blocked(id,(String)ids.get(0)[1]))throw UNAUTHORIZED;
        if (jdbc.update("UPDATE api_tokens SET last_used_at=now() WHERE token_hash=?",sha256(token)) != 1) throw UNAUTHORIZED;
        return id;
    }

    @Transactional
    public void recordSwitch(long source,long target) {
        if(source==target)return;
        var locked=jdbc.queryForList("SELECT id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE",Long.class,source,target);
        if(locked.size()!=2||!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM api_tokens WHERE user_id=?)",Boolean.class,target))||!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM api_tokens WHERE user_id=?)",Boolean.class,source)))throw new ApiException(HttpStatus.CONFLICT,"account_unavailable","연결할 계정을 사용할 수 없어요");
        boolean linked=Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM auth_identities WHERE user_id=?)",Boolean.class,source));
        if(linked)throw new ApiException(HttpStatus.CONFLICT,"account_link_conflict","다른 계정에 이미 연결된 로그인입니다. 현재 계정의 연결은 유지됩니다");
        jdbc.update("INSERT INTO account_predecessors(source_id,target_id) VALUES (?,?) ON CONFLICT DO NOTHING",source,target);
        jdbc.update("DELETE FROM api_tokens WHERE user_id=?",source);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
