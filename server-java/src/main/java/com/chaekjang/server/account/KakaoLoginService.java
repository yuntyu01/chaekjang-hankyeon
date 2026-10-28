package com.chaekjang.server.account;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.chaekjang.server.common.ApiException;

/**
 * 카카오 로그인(웹 OAuth). 앱 → start(기기 토큰으로 state 발급, 인가 주소 반환) → 브라우저에서 카카오 동의 →
 * 서버 callback(코드 교환, 이 기기 계정에 카카오를 잇거나 이미 이은 계정을 찾음) → 앱 주소로 티켓을 실어 돌려보냄 →
 * 앱 claim(기기 토큰 + 티켓 → 그 계정의 새 토큰). 티켓은 시작한 기기 토큰으로만 쓸 수 있어 주소 가로채기로는 못 쓴다.
 */
@Service
public class KakaoLoginService {

    private static final Logger log = LoggerFactory.getLogger(KakaoLoginService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Set<String> RETURN_SCHEMES = Set.of("chaekjang", "exp", "exps"); // exp(s): Expo Go 개발용
    private static final ApiException NOT_CONFIGURED = new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "not_configured", "카카오 로그인이 아직 준비되지 않았어요");
    private static final ApiException EXPIRED = new ApiException(HttpStatus.BAD_REQUEST, "login_expired", "로그인 시간이 지났어요. 다시 시도해 주세요");

    private final JdbcTemplate jdbc;
    private final AccountService accounts;
    private final KakaoOAuth oauth;
    private final String restKey;
    private final String redirectUri;
    private final KakaoConnectionManager connections;

    public KakaoLoginService(DataSource ds, AccountService accounts, KakaoOAuth oauth, KakaoConfig.Settings cfg,KakaoConnectionManager connections) {
        this.jdbc = new JdbcTemplate(ds);
        this.accounts = accounts;
        this.oauth = oauth;
        this.restKey = cfg.restKey();
        this.redirectUri = cfg.publicBaseUrl() + "/auth/kakao/callback";
        this.connections=connections;
    }

    /** 인가 주소를 만든다. returnUrl은 로그인이 끝난 뒤 브라우저가 돌아갈 앱 주소(허용된 스킴만). */
    public boolean enabled() { return !restKey.isEmpty()&&connections.ready(); }

    public String start(long userId, String returnUrl) {
        if (!enabled()) throw NOT_CONFIGURED;
        if (!validReturn(returnUrl)) throw ApiException.BAD_REQUEST;
        jdbc.update("DELETE FROM kakao_logins WHERE created_at < now() - interval '15 minutes'");
        String state = random();
        jdbc.update("INSERT INTO kakao_logins (state_hash, user_id, return_url) VALUES (?, ?, ?)", AccountService.sha256(state), userId, returnUrl);
        return "https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=" + enc(restKey) + "&redirect_uri=" + enc(redirectUri)
                + "&state=" + enc(state);
    }

    /** 카카오가 돌려준 코드를 처리하고, 브라우저를 보낼 앱 주소(티켓 또는 error 포함)를 돌려준다. */
    public String callback(String code, String state, String error) {
        if (state == null || state.isEmpty() || state.length() > 200) throw EXPIRED;
        String stateHash = AccountService.sha256(state);
        List<Object[]> rows = jdbc.query("UPDATE kakao_logins SET exchange_started=true WHERE state_hash = ? AND exchange_started=false AND ticket_hash IS NULL AND created_at > now() - interval '10 minutes' RETURNING user_id, return_url",
                (rs, i) -> new Object[] {rs.getLong(1), rs.getString(2)}, stateHash);
        if (rows.isEmpty()) throw EXPIRED;
        long userId = (Long) rows.get(0)[0];
        String returnUrl = (String) rows.get(0)[1];

        if (error != null || code == null || code.isEmpty()) {
            jdbc.update("DELETE FROM kakao_logins WHERE state_hash = ?", stateHash);
            return withParam(returnUrl, "error", "denied");
        }
        KakaoOAuth.Identity who;
        try {
            who = oauth.exchange(code, redirectUri);
        } catch (IOException e) {
            log.warn("kakao_login_exchange_failed");
            jdbc.update("DELETE FROM kakao_logins WHERE state_hash = ?", stateHash);
            return withParam(returnUrl, "error", "failed");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            jdbc.update("DELETE FROM kakao_logins WHERE state_hash = ?", stateHash);
            return withParam(returnUrl, "error", "failed");
        }

        jdbc.update("INSERT INTO auth_identities (provider, subject, user_id) VALUES ('kakao', ?, ?) ON CONFLICT DO NOTHING", who.subject(), userId);
        long result = jdbc.queryForObject("SELECT user_id FROM auth_identities WHERE provider = 'kakao' AND subject = ?", Long.class, who.subject());
        if (who.nickname() != null) jdbc.update("UPDATE users SET nickname = ? WHERE id = ?", who.nickname(), result);

        String ticket = random();
        jdbc.update("UPDATE kakao_logins SET ticket_hash = ?, result_user_id = ? WHERE state_hash = ?", AccountService.sha256(ticket), result, stateHash);
        return withParam(returnUrl, "ticket", ticket);
    }

    /** 티켓 → 로그인된 계정의 새 토큰. switched=true면 이 기기 계정이 아니라 이미 카카오에 이어진 다른 계정이다. */
    public Map<String, Object> claim(long userId, String ticket) {
        if (ticket == null || ticket.isEmpty() || ticket.length() > 200) throw ApiException.BAD_REQUEST;
        List<Long> r = jdbc.queryForList("DELETE FROM kakao_logins WHERE ticket_hash = ? AND user_id = ? AND created_at > now() - interval '10 minutes' RETURNING result_user_id",
                Long.class, AccountService.sha256(ticket), userId);
        if (r.isEmpty()) throw EXPIRED;
        long result = r.get(0);
        accounts.recordSwitch(userId,result);
        String token = accounts.issueToken(result);
        List<String> nick = jdbc.queryForList("SELECT nickname FROM users WHERE id = ? AND nickname IS NOT NULL", String.class, result);
        return Map.of("userId", result, "token", token, "switched", result != userId, "nickname", nick.isEmpty() ? "" : nick.get(0));
    }

    private static boolean validReturn(String url) {
        return "chaekjang://auth/kakao".equals(url);
    }

    @org.springframework.scheduling.annotation.Scheduled(fixedDelay=3600000)
    public void cleanup() { jdbc.update("DELETE FROM kakao_logins WHERE created_at<now()-interval '10 minutes'"); }

    private static String withParam(String url, String key, String value) {
        return url + (url.contains("?") ? "&" : "?") + key + "=" + enc(value);
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static String random() {
        byte[] raw = new byte[24];
        RANDOM.nextBytes(raw);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }
}
