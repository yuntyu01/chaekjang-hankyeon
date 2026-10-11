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

@RestController
public class AccountController {

    private final AccountService accounts;
    private final KakaoLoginService kakao;
    private final JdbcTemplate jdbc;

    public AccountController(AccountService accounts, KakaoLoginService kakao, DataSource ds) {
        this.accounts = accounts;
        this.kakao = kakao;
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
        out.put("nickname", jdbc.queryForList("SELECT nickname FROM users WHERE id = ? AND nickname IS NOT NULL", String.class, id).stream().findFirst().orElse(""));
        return out;
    }

    /** 카카오 로그인 시작: 브라우저로 열 인가 주소를 준다. body: {"returnUrl": "chaekjang://auth/kakao"} */
    @PostMapping("/auth/kakao/start")
    Map<String, String> kakaoStart(@RequestHeader(value = "Authorization", required = false) String auth, @RequestBody Map<String, String> body) {
        return Map.of("url", kakao.start(accounts.authenticate(auth), body.get("returnUrl")));
    }

    /** 카카오가 브라우저를 돌려보내는 곳. 앱 주소로 다시 보낸다(티켓 또는 error). */
    @GetMapping("/auth/kakao/callback")
    ResponseEntity<Void> kakaoCallback(@RequestParam(required = false) String code, @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        return ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, kakao.callback(code, state, error)).build();
    }

    /** 앱이 티켓을 내고 그 계정의 토큰을 받는다. body: {"ticket": "..."} */
    @PostMapping("/auth/kakao/claim")
    Map<String, Object> kakaoClaim(@RequestHeader(value = "Authorization", required = false) String auth, @RequestBody Map<String, String> body) {
        return kakao.claim(accounts.authenticate(auth), body.get("ticket"));
    }
}
