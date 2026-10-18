package com.chaekjang.server.account;

import java.util.LinkedHashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.DeleteMapping;
import java.io.IOException;

@RestController
public class AccountController {

    private final AccountService accounts;
    private final KakaoLoginService kakao;
    private final GoogleLoginService google;
    private final AccountDeletionService deletions;
    private final KakaoConnectionManager connections;
    private final JdbcTemplate jdbc;

    public AccountController(AccountService accounts, KakaoLoginService kakao, GoogleLoginService google, DataSource ds,
            AccountDeletionService deletions,KakaoConnectionManager connections) {
        this.accounts = accounts;
        this.kakao = kakao;
        this.google = google;
        this.deletions=deletions;this.connections=connections;
        this.jdbc = new JdbcTemplate(ds);
    }

    /** 앱 첫 실행: 기기 계정을 만들고 토큰을 준다. 토큰은 이 응답에서만 볼 수 있다. */
    @PostMapping("/auth/device")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, Object> device() {
        AccountService.Created c = accounts.createDeviceAccount();
        return Map.of("userId", c.userId(), "token", c.token());
    }

    @GetMapping("/me")
    Map<String, Object> me(@RequestHeader(value = "Authorization", required = false) String auth) {
        long id = accounts.authenticate(auth);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("userId", id);
        out.put("kakao", Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM auth_identities WHERE provider = 'kakao' AND user_id = ?)", Boolean.class, id)));
        out.put("google", Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM auth_identities WHERE provider = 'google' AND user_id = ?)", Boolean.class, id)));
        out.put("nickname", jdbc.queryForList("SELECT nickname FROM users WHERE id = ? AND nickname IS NOT NULL", String.class, id).stream().findFirst().orElse(""));
        return out;
    }

    /** 카카오 로그인 시작: 브라우저로 열 인가 주소를 준다. body: {"returnUrl": "chaekjang://auth/kakao"} */
    @PostMapping("/auth/kakao/start")
    Map<String, String> kakaoStart(@RequestHeader(value = "Authorization", required = false) String auth, @RequestBody Map<String, String> body) {
        long user=accounts.authenticate(auth);
        lifecycleClient(body);
        return Map.of("url", kakao.start(user, body.get("returnUrl")));
    }

    /** 카카오가 브라우저를 돌려보내는 곳. 앱 주소로 다시 보낸다(티켓 또는 error). */
    @GetMapping("/auth/kakao/callback")
    ResponseEntity<Void> kakaoCallback(@RequestParam(required = false) String code, @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.CACHE_CONTROL,"no-store").header("Referrer-Policy","no-referrer").header(HttpHeaders.LOCATION, kakao.callback(code, state, error)).build();
    }

    /** 앱이 티켓을 내고 그 계정의 토큰을 받는다. body: {"ticket": "..."} */
    @PostMapping("/auth/kakao/claim")
    Map<String, Object> kakaoClaim(@RequestHeader(value = "Authorization", required = false) String auth, @RequestBody Map<String, String> body) {
        return kakao.claim(accounts.authenticate(auth), body.get("ticket"));
    }

    @GetMapping("/auth/providers")
    Map<String, Boolean> providers() { return Map.of("google", google.enabled(), "kakao", kakao.enabled()); }

    @PostMapping("/auth/google/start")
    Map<String, String> googleStart(@RequestHeader(value = "Authorization", required = false) String auth,
            @RequestBody Map<String, String> body) {
        long user=accounts.authenticate(auth);
        lifecycleClient(body);
        return Map.of("url", google.start(user, body.get("returnUrl")));
    }

    @GetMapping("/auth/google/callback")
    ResponseEntity<Void> googleCallback(@RequestParam(required = false) String code, @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("Referrer-Policy", "no-referrer").header(HttpHeaders.LOCATION, google.callback(code, state, error)).build();
    }

    @PostMapping("/auth/google/claim")
    Map<String, Object> googleClaim(@RequestHeader(value = "Authorization", required = false) String auth,
            @RequestBody Map<String, String> body) {
        return google.claim(accounts.authenticate(auth), body.get("ticket"));
    }

    @DeleteMapping("/me")
    ResponseEntity<Void> deleteAccount(@RequestHeader(value="Authorization",required=false)String auth,@RequestBody Map<String,String> body)throws IOException {
        long user=accounts.authenticate(auth);
        if(!"DELETE".equals(body.get("confirmation")))throw com.chaekjang.server.common.ApiException.BAD_REQUEST;
        deletions.request(user);return ResponseEntity.accepted().build();
    }

    @org.springframework.web.bind.annotation.RequestMapping(value="/auth/kakao/unlink",method={org.springframework.web.bind.annotation.RequestMethod.GET,org.springframework.web.bind.annotation.RequestMethod.POST})
    ResponseEntity<Void> kakaoUnlink(@RequestHeader(value="Authorization",required=false)String auth,
            @RequestParam(name="app_id")String app,@RequestParam(name="user_id")String subject)throws IOException {
        if(!connections.verified(auth,app))return ResponseEntity.status(401).build();
        if(!subject.matches("[1-9][0-9]{0,19}"))return ResponseEntity.badRequest().build();
        for(Long user:jdbc.queryForList("SELECT user_id FROM auth_identities WHERE provider='kakao' AND subject=?",Long.class,subject))deletions.request(user);
        return ResponseEntity.ok().build();
    }
    private void lifecycleClient(Map<String,String> body) {
        if(!"1".equals(body.get("accountLifecycle")))throw new com.chaekjang.server.common.ApiException(HttpStatus.UPGRADE_REQUIRED,"upgrade_required","로그인하려면 앱을 업데이트해 주세요");
    }
}
