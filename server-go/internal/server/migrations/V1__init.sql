-- 전 사용자 공유 도서 캐시(ISBN 기준). 외부 API·색 추출은 ISBN당 한 번.
CREATE TABLE books (
    isbn13           TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    authors          TEXT[] NOT NULL DEFAULT '{}',
    publisher        TEXT,
    published_at     DATE,
    page_count       INT,
    format           TEXT,
    cover_url        TEXT,          -- 외부 URL 참조(이미지 복사본 저장 안 함)
    cover_thumb_url  TEXT,
    description      TEXT,
    theme_color      TEXT NOT NULL,
    height_class     TEXT NOT NULL CHECK (height_class IN ('short', 'medium', 'tall')),
    thickness_class  TEXT NOT NULL CHECK (thickness_class IN ('thin', 'medium', 'thick')),
    default_motif_id TEXT NOT NULL,
    source           TEXT NOT NULL,  -- kakao | aladin | mock
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id         BIGSERIAL PRIMARY KEY,
    provider   TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'kakao')),
    subject    TEXT NOT NULL,
    nickname   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);

CREATE TABLE user_books (
    user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    isbn13             TEXT NOT NULL REFERENCES books(isbn13),
    status             TEXT NOT NULL CHECK (status IN ('reading', 'read', 'want')),
    finished_at        DATE,
    note               TEXT,
    song_title         TEXT,
    song_url           TEXT,
    custom_theme_color TEXT,
    custom_motif_id    TEXT,
    cover_display      BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, isbn13)
);

-- 홈 ShelfLayout JSON(v2: 선반 + 서랍) 그대로.
CREATE TABLE shelf_layouts (
    user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout     JSONB NOT NULL,
    version    INT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE finish_cards (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    isbn13     TEXT NOT NULL REFERENCES books(isbn13),
    image_url  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
