package com.chaekjang.server.sync;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.chaekjang.server.account.AccountService;

@RestController
public class SyncController {

    private final AccountService accounts;
    private final SyncService sync;

    public SyncController(AccountService accounts, SyncService sync) {
        this.accounts = accounts;
        this.sync = sync;
    }

    @PostMapping("/sync/push")
    SyncDtos.PushResult push(@RequestHeader(value = "Authorization", required = false) String auth, @RequestBody SyncDtos.Push body) {
        return sync.push(accounts.authenticate(auth), body);
    }

    @GetMapping("/sync/pull")
    SyncDtos.Pull pull(@RequestHeader(value = "Authorization", required = false) String auth, @RequestParam(name = "since", defaultValue = "0") long since,
            @RequestParam(name = "limit", defaultValue = "500") int limit) {
        return sync.pull(accounts.authenticate(auth), since, Math.max(1, Math.min(limit, 1000)));
    }
}
