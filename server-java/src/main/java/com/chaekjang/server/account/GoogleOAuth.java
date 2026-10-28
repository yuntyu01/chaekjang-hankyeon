package com.chaekjang.server.account;

import java.io.IOException;

public interface GoogleOAuth {
    record Identity(String subject, String nickname) {}
    Identity exchange(String code, String redirectUri, String verifier, String nonceHash) throws IOException, InterruptedException;
}
