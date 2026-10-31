-- 2026-11 커뮤니티(공개 데이터): 개인 서재 동기화 표와 따로 둔다. 개인 기록은 자동으로 공개되지 않고,
-- 사용자가 고른 필드만 게시물·후기에 복사된다(개인 원본을 지우거나 고쳐도 공개본은 따로, 공개본을 지워도 개인 원본은 그대로).
-- 계정 삭제는 users ON DELETE CASCADE로 공개 데이터까지 지운다.

-- 공개 프로필: 개인 계정 정보(users.nickname = 소셜 로그인 이름)와 다른 공개 닉네임
CREATE TABLE public_profiles (
    user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nickname   TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
    bio        TEXT CHECK (bio IS NULL OR char_length(bio) <= 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX public_profiles_nickname_idx ON public_profiles (lower(nickname));

-- 책별 공개 평가: 판본(ISBN-13) 기준, 사용자당 하나(중복 소장·재독이 평균에 여러 번 들어가지 않는다). 평가는 1~5만(0점 없음)
CREATE TABLE book_reviews (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    isbn13     TEXT NOT NULL CHECK (isbn13 ~ '^[0-9]{13}$'),
    rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body       TEXT CHECK (body IS NULL OR char_length(body) <= 500),
    hidden_at  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, isbn13)
);
CREATE INDEX book_reviews_isbn_idx ON book_reviews (isbn13, updated_at DESC);

-- 독서 게시물: 사용자가 고른 것만 복사(책·독서 시간·확인된 분량·고른 갈피 문장·공개용 한 줄). client_id로 재시도·중복 요청이 하나로
CREATE TABLE community_posts (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 64),
    isbn13      TEXT CHECK (isbn13 IS NULL OR isbn13 ~ '^[0-9]{13}$'),
    book_title  TEXT NOT NULL CHECK (char_length(book_title) BETWEEN 1 AND 200),
    book_author TEXT CHECK (book_author IS NULL OR char_length(book_author) <= 200),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms > 0),
    pages_read  INTEGER CHECK (pages_read IS NULL OR pages_read > 0),
    quote       TEXT CHECK (quote IS NULL OR char_length(quote) <= 1000),
    quote_page  INTEGER CHECK (quote_page IS NULL OR quote_page > 0),
    body        TEXT CHECK (body IS NULL OR char_length(body) <= 1000),
    hidden_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, client_id)
);
CREATE INDEX community_posts_user_idx ON community_posts (user_id, id DESC);

CREATE TABLE community_follows (
    follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX community_follows_followee_idx ON community_follows (followee_id);

CREATE TABLE community_likes (
    post_id    BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE community_comments (
    id         BIGSERIAL PRIMARY KEY,
    post_id    BIGINT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  TEXT CHECK (client_id IS NULL OR char_length(client_id) BETWEEN 1 AND 64),
    body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    hidden_at  TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, client_id)
);
CREATE INDEX community_comments_post_idx ON community_comments (post_id, id);

-- 차단: 서로의 게시물·댓글·후기·프로필이 보이지 않는다(양쪽 모두)
CREATE TABLE community_blocks (
    blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- 신고: 운영자가 /admin/reports로 확인·처리(숨김 또는 기각)
CREATE TABLE community_reports (
    id          BIGSERIAL PRIMARY KEY,
    reporter_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'comment', 'user', 'review')),
    target_id   TEXT NOT NULL,
    reason      TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX community_reports_open_idx ON community_reports (status, id);
