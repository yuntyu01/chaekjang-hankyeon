package com.chaekjang.server.account;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;

import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import com.chaekjang.server.common.ApiException;

@Service
public class GoogleLoginService {
    private final JdbcTemplate jdbc;
    private final AccountService accounts;
    private final GoogleOAuth oauth;
    private final GoogleConfig.Settings settings;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ApiException EXPIRED = new ApiException(HttpStatus.BAD_REQUEST, "login_expired", "로그인 시간이 지났어요. 다시 시도해 주세요");

    public GoogleLoginService(DataSource ds, AccountService accounts, GoogleOAuth oauth, GoogleConfig.Settings settings) {
        this.jdbc = new JdbcTemplate(ds); this.accounts = accounts; this.oauth = oauth; this.settings = settings;
    }
    public boolean enabled() { return settings.enabled(); }

    public String start(long user, String returnUrl) {
        if (!enabled()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "not_configured", "Google 로그인이 아직 준비되지 않았어요");
        if (!"chaekjang://auth/google".equals(returnUrl)) throw ApiException.BAD_REQUEST;
        cleanup();
        String state = random(), nonce = random(), verifier = random();
        jdbc.update("INSERT INTO google_logins(state_hash,user_id,return_url,nonce_hash,upstream_verifier) VALUES (?,?,?,?,?)",
                AccountService.sha256(state), user, returnUrl, AccountService.sha256(nonce), verifier);
        return "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=" + enc(settings.clientId())
                + "&redirect_uri=" + enc(settings.publicBaseUrl() + "/auth/google/callback")
                + "&scope=" + enc("openid profile") + "&state=" + enc(state) + "&nonce=" + enc(nonce)
                + "&code_challenge=" + enc(challenge(verifier)) + "&code_challenge_method=S256";
    }

    public String callback(String code, String state, String error) {
        if (state == null || state.isEmpty() || state.length() > 200) throw EXPIRED;
        // Consume before contacting Google: a callback can be exchanged only once, including failures.
        List<String[]> pending = jdbc.query("DELETE FROM google_logins WHERE state_hash=? AND expires_at>now() RETURNING user_id,return_url,nonce_hash,upstream_verifier",
                (rs, i) -> new String[]{rs.getString(1),rs.getString(2),rs.getString(3),rs.getString(4)}, AccountService.sha256(state));
        if (pending.isEmpty()) throw EXPIRED;
        String[] row = pending.get(0);
        if (error != null || code == null || code.isEmpty() || code.length() > 4096) return back(row[1], "error", "denied");
        GoogleOAuth.Identity identity;
        try {
            identity = oauth.exchange(code, settings.publicBaseUrl() + "/auth/google/callback", row[3], row[2]);
        } catch (IOException e) {
            LoggerFactory.getLogger(GoogleLoginService.class).warn("google_exchange_failed");
            return back(row[1], "error", "failed");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); return back(row[1], "error", "failed");
        }
        long source = Long.parseLong(row[0]);
        // Identity is provider+subject, never a matching email or nickname.
        jdbc.update("INSERT INTO auth_identities(provider,subject,user_id) VALUES ('google',?,?) ON CONFLICT DO NOTHING", identity.subject(), source);
        long result = jdbc.queryForObject("SELECT user_id FROM auth_identities WHERE provider='google' AND subject=?", Long.class, identity.subject());
        if (identity.nickname() != null) jdbc.update("UPDATE users SET nickname=? WHERE id=?", identity.nickname(), result);
        String ticket = random();
        jdbc.update("INSERT INTO google_login_tickets(ticket_hash,source_user_id,result_user_id) VALUES (?,?,?)", AccountService.sha256(ticket), source, result);
        return back(row[1], "ticket", ticket);
    }

    public Map<String,Object> claim(long source, String ticket) {
        if (ticket == null || ticket.isEmpty() || ticket.length() > 200) throw ApiException.BAD_REQUEST;
        List<Long> result = jdbc.queryForList("DELETE FROM google_login_tickets WHERE ticket_hash=? AND source_user_id=? AND expires_at>now() RETURNING result_user_id",
                Long.class, AccountService.sha256(ticket), source);
        if (result.isEmpty()) throw EXPIRED;
        long user = result.get(0);
        accounts.recordSwitch(source,user);
        List<String> names = jdbc.queryForList("SELECT nickname FROM users WHERE id=? AND nickname IS NOT NULL", String.class, user);
        return Map.of("userId",user,"token",accounts.issueToken(user),"switched",user!=source,"nickname",names.isEmpty()?"":names.get(0));
    }

    @Scheduled(fixedDelay = 3600000)
    public void cleanup() {
        jdbc.update("DELETE FROM google_logins WHERE expires_at<=now()");
        jdbc.update("DELETE FROM google_login_tickets WHERE expires_at<=now()");
    }
    private static String random() { byte[] b = new byte[32]; RANDOM.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    private static String challenge(String s) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.US_ASCII))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static String enc(String s) { return URLEncoder.encode(s,StandardCharsets.UTF_8); }
    private static String back(String target,String key,String value) { return URI.create(target).toString()+"?"+key+"="+enc(value); }
}
