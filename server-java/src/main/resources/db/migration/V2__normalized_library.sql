-- 앱의 내 서재 모델(판본 / 내 책 / 회차 / 세션 / 갈피 / 장정)과 같은 모양으로 정규화한다.
-- V1의 user_books(상태·완독일·감상·색 오버라이드를 한 줄에 합친 구조)와 finish_cards는 앱이 쓰지 않으므로 없앤다(배포 전이라 옮길 데이터 없음).
-- 규칙
--  * 사용자 데이터 표는 (user_id, id) 복합 기본키. id는 앱이 만든 안정 ID(문자열)라 오프라인에서도 만들 수 있다.
--  * 같은 사용자 안의 참조는 (user_id, 참조 id) 복합 외래키로 거는 만큼 다른 사용자의 행을 가리킬 수 없다.
--  * 동기화: 쓸 때마다 rev(전역 시퀀스)를 올리고, 앱은 "마지막으로 받은 rev 이후"만 받아 간다. 삭제는 deleted_at 표시로 남겨 다른 기기에 전달한다.
--  * 충돌: updated_at(앱이 기록한 시각)이 더 새로운 쪽이 이긴다(동률은 나중에 온 쪽).

DROP TABLE IF EXISTS finish_cards;
DROP TABLE IF EXISTS user_books;

CREATE SEQUENCE sync_rev_seq;

-- ---------- 계정 ----------
-- provider/subject는 소셜 로그인 연결용 표(auth_identities)로 옮긴다. 기기 계정은 사용자만 만들고 토큰으로 접근한다.
ALTER TABLE users DROP CONSTRAINT users_provider_check;
ALTER TABLE users DROP CONSTRAINT users_provider_subject_key;
ALTER TABLE users DROP COLUMN provider;
ALTER TABLE users DROP COLUMN subject;
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE auth_identities (
    provider   TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'kakao')),
    subject    TEXT NOT NULL,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- 기기 토큰(원문은 저장하지 않고 SHA-256만)
CREATE TABLE api_tokens (
    token_hash   TEXT PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

-- ---------- 공유 도서 카탈로그(books)에 재장정·분류 열 ----------
-- 저자는 배열 열 대신 순서가 있는 표로 나눈다.
CREATE TABLE book_authors (
    isbn13   TEXT NOT NULL REFERENCES books(isbn13) ON DELETE CASCADE,
    position INT  NOT NULL,
    name     TEXT NOT NULL,
    PRIMARY KEY (isbn13, position)
);
INSERT INTO book_authors (isbn13, position, name)
SELECT b.isbn13, a.ord - 1, a.name FROM books b, unnest(b.authors) WITH ORDINALITY AS a(name, ord);
ALTER TABLE books DROP COLUMN authors;
CREATE INDEX book_authors_name_idx ON book_authors (name);

ALTER TABLE books
    ADD COLUMN category     TEXT,
    ADD COLUMN series_title TEXT;

-- ---------- 파일(사진 갈피·직접 찍은 표지) ----------
-- 내용은 저장소(디스크/객체 저장소)에 두고 표에는 위치와 검증값만.
CREATE TABLE files (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id           TEXT   NOT NULL,
    content_type TEXT   NOT NULL,
    size_bytes   BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256       TEXT   NOT NULL,
    storage_key  TEXT   NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);

-- ---------- 사용자 서재 ----------
-- 판본: 내가 가진 그 책의 정보. 공유 카탈로그(books)와는 isbn13으로 느슨하게 잇는다(직접 입력한 책은 ISBN이 없을 수 있다).
CREATE TABLE editions (
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id              TEXT   NOT NULL,
    isbn13          TEXT,
    title           TEXT   NOT NULL,
    publisher       TEXT,
    published_at    TEXT,            -- YYYY / YYYY-MM / YYYY-MM-DD (출처마다 정밀도가 다르다)
    page_count      INT CHECK (page_count > 0),
    width_mm        INT CHECK (width_mm > 0),
    height_mm       INT CHECK (height_mm > 0),
    category        TEXT,
    series_title    TEXT,
    cover_url       TEXT,            -- 외부 URL 참조(복사본 저장 안 함)
    cover_file_id   TEXT,            -- 직접 찍은 표지 사진
    cover_source    TEXT CHECK (cover_source IN ('api', 'photo')),
    source          TEXT   NOT NULL CHECK (source IN ('manual', 'search', 'photo')),
    source_name     TEXT,
    -- 재장정 계산값(ISBN당 한 번 계산해 저장)
    art_base_color  TEXT,
    art_ink_color   TEXT,
    art_accent_color TEXT,
    art_motif_id    TEXT,
    art_layout      TEXT CHECK (art_layout IN ('spine_a', 'spine_b', 'spine_c')),
    art_version     INT,
    art_generated_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    deleted_at      TIMESTAMPTZ,
    rev             BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, cover_file_id) REFERENCES files (user_id, id)
);
CREATE INDEX editions_rev_idx ON editions (user_id, rev);
CREATE INDEX editions_isbn_idx ON editions (user_id, isbn13) WHERE isbn13 IS NOT NULL;

CREATE TABLE edition_authors (
    user_id    BIGINT NOT NULL,
    edition_id TEXT   NOT NULL,
    position   INT    NOT NULL,
    name       TEXT   NOT NULL,
    PRIMARY KEY (user_id, edition_id, position),
    FOREIGN KEY (user_id, edition_id) REFERENCES editions (user_id, id) ON DELETE CASCADE
);

-- 내 책(읽기 상태·별점·감상)
CREATE TABLE my_books (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id           TEXT   NOT NULL,
    edition_id   TEXT   NOT NULL,
    status       TEXT   NOT NULL CHECK (status IN ('want', 'reading', 'read', 'paused')),
    rating       INT CHECK (rating BETWEEN 1 AND 5),
    note         TEXT,
    current_page INT CHECK (current_page >= 0),
    binding_id   TEXT,               -- 현재 쓰는 장정(bindings와 서로 참조하므로 외래키는 걸지 않는다)
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    deleted_at   TIMESTAMPTZ,
    rev          BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, edition_id) REFERENCES editions (user_id, id)
);
CREATE INDEX my_books_rev_idx ON my_books (user_id, rev);
CREATE INDEX my_books_edition_idx ON my_books (user_id, edition_id);

-- 장정(사용자가 고른 색·모티프·조판. source='custom'이면 추천 장정 대신 적용)
CREATE TABLE bindings (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id            TEXT   NOT NULL,
    my_book_id    TEXT   NOT NULL,
    spine_color   TEXT   NOT NULL,
    ink_color     TEXT,
    accent_color  TEXT,
    motif         TEXT   NOT NULL,   -- 모티프 슬롯 id 또는 'none'
    layout        TEXT CHECK (layout IN ('spine_a', 'spine_b', 'spine_c')),
    source        TEXT   NOT NULL CHECK (source IN ('default', 'ai', 'custom')),
    status        TEXT   NOT NULL CHECK (status IN ('ready', 'generating', 'failed')),
    seed          INT    NOT NULL DEFAULT 0,
    cover_art_file_id TEXT,
    spine_art_file_id TEXT,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    deleted_at    TIMESTAMPTZ,
    rev           BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, my_book_id) REFERENCES my_books (user_id, id),
    FOREIGN KEY (user_id, cover_art_file_id) REFERENCES files (user_id, id),
    FOREIGN KEY (user_id, spine_art_file_id) REFERENCES files (user_id, id)
);
CREATE INDEX bindings_rev_idx ON bindings (user_id, rev);

-- 독서 회차(다시 읽으면 새 회차)
CREATE TABLE rounds (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id          TEXT   NOT NULL,
    my_book_id  TEXT   NOT NULL,
    idx         INT    NOT NULL CHECK (idx >= 1),
    started_on  DATE,
    finished_on DATE,
    paused      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    deleted_at  TIMESTAMPTZ,
    rev         BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, my_book_id) REFERENCES my_books (user_id, id),
    CHECK (finished_on IS NULL OR started_on IS NULL OR finished_on >= started_on)
);
CREATE INDEX rounds_rev_idx ON rounds (user_id, rev);
CREATE INDEX rounds_book_idx ON rounds (user_id, my_book_id, idx);

-- 독서 세션(책 없이 읽은 시간도 저장)
CREATE TABLE sessions (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id           TEXT   NOT NULL,
    my_book_id   TEXT,
    round_id     TEXT,
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ NOT NULL,
    duration_ms  BIGINT NOT NULL CHECK (duration_ms >= 0),
    pages_read   INT CHECK (pages_read >= 0),
    memo         TEXT,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    deleted_at   TIMESTAMPTZ,
    rev          BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, my_book_id) REFERENCES my_books (user_id, id),
    FOREIGN KEY (user_id, round_id) REFERENCES rounds (user_id, id),
    CHECK (ended_at >= started_at)
);
CREATE INDEX sessions_rev_idx ON sessions (user_id, rev);
CREATE INDEX sessions_started_idx ON sessions (user_id, started_at);

-- 갈피(문장 갈피 / 사진 갈피). 사진 갈피는 photo_file_id가 있고 text는 비어 있을 수 있다.
CREATE TABLE bookmarks (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id            TEXT   NOT NULL,
    my_book_id    TEXT   NOT NULL,
    body          TEXT   NOT NULL DEFAULT '',
    page          INT CHECK (page > 0),
    memo          TEXT,
    photo_file_id TEXT,
    photo_ratio   REAL CHECK (photo_ratio > 0),
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    deleted_at    TIMESTAMPTZ,
    rev           BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, my_book_id) REFERENCES my_books (user_id, id),
    FOREIGN KEY (user_id, photo_file_id) REFERENCES files (user_id, id),
    CHECK (body <> '' OR photo_file_id IS NOT NULL)
);
CREATE INDEX bookmarks_rev_idx ON bookmarks (user_id, rev);
CREATE INDEX bookmarks_book_idx ON bookmarks (user_id, my_book_id, created_at DESC);

-- 책장 배치(선반·자세·위치 JSON). 화면 구조라 JSON 그대로 두고, 책은 id로만 가리킨다.
ALTER TABLE shelf_layouts ADD COLUMN client_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE shelf_layouts ADD COLUMN rev BIGINT NOT NULL DEFAULT 0;
