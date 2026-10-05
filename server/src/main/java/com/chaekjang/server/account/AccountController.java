package com.chaekjang.server.account;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AccountController {

    private final AccountService accounts;

    public AccountController(AccountService accounts) {
        this.accounts = accounts;
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
        return Map.of("userId", accounts.authenticate(auth));
    }
}
