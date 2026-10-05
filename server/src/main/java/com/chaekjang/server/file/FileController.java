package com.chaekjang.server.file;

import java.io.IOException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import javax.sql.DataSource;

import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.chaekjang.server.account.AccountService;
import com.chaekjang.server.common.ApiException;

/**
 * 사진 갈피·직접 찍은 표지 같은 사용자 파일. id는 앱이 정한다(같은 id로 다시 올리면 덮어쓴다 → 재시도해도 안전).
 * 다른 사용자의 파일은 보이지 않는다(항상 인증된 사용자의 (user_id, id)로만 찾는다).
 */
@RestController
public class FileController {

    static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_.-]{1,80}");
    private static final Set<String> TYPES = Set.of("image/jpeg", "image/png", "image/webp", "image/heic");

    private final AccountService accounts;
    private final FileStore store;
    private final JdbcTemplate jdbc;

    public FileController(AccountService accounts, FileStore store, DataSource ds) {
        this.accounts = accounts;
        this.store = store;
        this.jdbc = new JdbcTemplate(ds);
    }

    @PutMapping(value = "/files/{id}", consumes = MediaType.ALL_VALUE)
    @Transactional
    ResponseEntity<Void> put(@RequestHeader(value = "Authorization", required = false) String auth, @PathVariable String id,
            @RequestHeader(value = "Content-Type", required = false) String contentType, @RequestBody byte[] body) throws IOException {
        long user = accounts.authenticate(auth);
        String type = contentType == null ? "" : contentType.split(";")[0].trim().toLowerCase();
        if (!ID.matcher(id).matches() || !TYPES.contains(type) || body.length == 0) throw ApiException.BAD_REQUEST;
        if (body.length > MAX_BYTES) throw new ApiException(HttpStatus.CONTENT_TOO_LARGE, "too_large", "파일이 너무 커요(최대 10MB)");
        String key = user + "/" + id;
        String sha;
        try {
            sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        store.put(key, body);
        jdbc.update("""
                INSERT INTO files (user_id, id, content_type, size_bytes, sha256, storage_key) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, id) DO UPDATE SET content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes,
                    sha256 = EXCLUDED.sha256, storage_key = EXCLUDED.storage_key
                """, user, id, type, body.length, sha, key);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/files/{id}")
    ResponseEntity<InputStreamResource> get(@RequestHeader(value = "Authorization", required = false) String auth, @PathVariable String id) throws IOException {
        long user = accounts.authenticate(auth);
        List<String[]> rows = jdbc.query("SELECT content_type, storage_key, sha256 FROM files WHERE user_id = ? AND id = ?",
                (rs, i) -> new String[] {rs.getString(1), rs.getString(2), rs.getString(3)}, user, id);
        if (rows.isEmpty()) throw ApiException.NOT_FOUND;
        String[] r = rows.get(0);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(r[0])).eTag("\"" + r[2] + "\"")
                .header("Cache-Control", "private, max-age=3600").body(new InputStreamResource(store.open(r[1])));
    }
}
