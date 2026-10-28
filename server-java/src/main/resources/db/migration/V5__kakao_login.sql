-- 카카오 로그인 진행 기록(웹 OAuth). 시작할 때 만든 state가 콜백에서 같은 사용자를 찾는 열쇠이고,
-- 콜백이 끝나면 한 번만 쓰는 티켓(해시)을 남긴다. 앱이 티켓을 내면 행을 지우고 토큰을 준다. 오래된 행은 시작할 때 치운다.
CREATE TABLE kakao_logins (
    state_hash     TEXT PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    return_url     TEXT NOT NULL,
    ticket_hash    TEXT UNIQUE,
    result_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
