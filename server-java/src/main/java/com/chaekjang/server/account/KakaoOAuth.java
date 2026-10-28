package com.chaekjang.server.account;

import java.io.IOException;

/** 카카오 로그인 코드를 사용자 식별자로 바꾼다. 시험에서는 가짜로 바꿔 끼운다. */
public interface KakaoOAuth {

    /** subject: 카카오 회원번호. nickname: 동의 항목이 없으면 null. */
    record Identity(String subject, String nickname) {
    }

    Identity exchange(String code, String redirectUri) throws IOException, InterruptedException;
}
