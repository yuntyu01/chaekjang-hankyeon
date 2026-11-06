-- 연도 책장: 해가 바뀔 때 그해 책장을 그대로 남긴 것(보기 전용). 앱 local-db v10과 같은 모양.
-- 규칙
--  * 사용자마다 한 해에 한 벌. id는 앱이 정한다('bc-<연도>'). 처음 올린 것이 남고 바뀌지 않는다(다른 기기가 같은 해를 또 올리면 무시).
--  * 선반·책 자리는 지금 책장(shelves, shelf_placements, V8)과 같은 열에 책장 id만 더했다. 열을 늘리면 두 벌을 함께 늘린다.
--  * 책마다 그때 덮어쓰던 값(상태·별점·한 줄 감상·갈피 색·읽은 쪽)과 그때 장정을 남긴다. 장정은 그 순간 줄을 복사해 새 id로
--    bindings에 두고 여기서 가리킨다(지금 책의 장정을 바꿔도 연도 책장 모습은 그대로).
--  * 판본·갈피·독서 기록·회차는 복사하지 않는다. 원래 표에서 그해 날짜로 고른다(나중에 고친 내용은 연도 책장에도 보인다).
--  * 연도 책장에 있는 책은 지워도 줄을 남기고 숨긴다(my_books.hidden_at). 그 책의 갈피·기록도 그래서 남는다.

CREATE TABLE bookcases (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT   NOT NULL,
    year       INT    NOT NULL CHECK (year BETWEEN 2000 AND 9999),
    created_at TIMESTAMPTZ NOT NULL,  -- 앱이 남긴 순간
    updated_at TIMESTAMPTZ NOT NULL,
    rev        BIGINT NOT NULL,
    PRIMARY KEY (user_id, id),
    UNIQUE (user_id, year)
);
CREATE INDEX bookcases_rev_idx ON bookcases (user_id, rev);

CREATE TABLE bookcase_shelves (
    user_id     BIGINT NOT NULL,
    bookcase_id TEXT   NOT NULL,
    id          TEXT   NOT NULL,
    position    INT    NOT NULL,
    PRIMARY KEY (user_id, bookcase_id, id),
    FOREIGN KEY (user_id, bookcase_id) REFERENCES bookcases (user_id, id) ON DELETE CASCADE
);

-- 그때 서재에 있던 책(선반·서랍 모두)
CREATE TABLE bookcase_books (
    user_id      BIGINT NOT NULL,
    bookcase_id  TEXT   NOT NULL,
    book_id      TEXT   NOT NULL,
    binding_id   TEXT,
    status       TEXT   NOT NULL CHECK (status IN ('want', 'reading', 'read', 'paused')),
    rating       INT CHECK (rating BETWEEN 1 AND 5),
    note         TEXT,
    ribbon_color TEXT,
    current_page INT CHECK (current_page >= 0),
    PRIMARY KEY (user_id, bookcase_id, book_id),
    FOREIGN KEY (user_id, bookcase_id) REFERENCES bookcases (user_id, id) ON DELETE CASCADE,
    -- 내 책·장정은 삭제 표시로만 지워져(동기화) 실제로 지워지는 건 계정 삭제뿐이다. 그때 함께 지운다
    -- (NO ACTION이면 계정 삭제의 연쇄 삭제 도중 검사에 걸린다: 시험 TestBookcaseSync)
    FOREIGN KEY (user_id, book_id) REFERENCES my_books (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, binding_id) REFERENCES bindings (user_id, id) ON DELETE CASCADE
);

CREATE TABLE bookcase_placements (
    user_id     BIGINT NOT NULL,
    bookcase_id TEXT   NOT NULL,
    book_id     TEXT   NOT NULL,
    shelf_id    TEXT,                -- 비어 있으면 서랍
    position    INT    NOT NULL,
    pose        TEXT CHECK (pose IN ('spine', 'horizontal', 'front')),
    tilt        SMALLINT CHECK (tilt IN (-7, 0, 7)),
    stack_id    TEXT,
    stack_order INT,
    pos         DOUBLE PRECISION,
    lean_angle  DOUBLE PRECISION,
    lean_on     TEXT,
    lean_slide  DOUBLE PRECISION,
    depth       DOUBLE PRECISION,
    spin        DOUBLE PRECISION,
    pitch       DOUBLE PRECISION,
    stack_dx    DOUBLE PRECISION,
    stack_dz    DOUBLE PRECISION,
    wall_lean   BOOLEAN NOT NULL DEFAULT false,
    flip        BOOLEAN NOT NULL DEFAULT false,
    overhang    BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, bookcase_id, book_id),
    FOREIGN KEY (user_id, bookcase_id, shelf_id) REFERENCES bookcase_shelves (user_id, bookcase_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, bookcase_id, book_id) REFERENCES bookcase_books (user_id, bookcase_id, book_id) ON DELETE CASCADE,
    CHECK (shelf_id IS NULL OR (pose IS NOT NULL AND tilt IS NOT NULL)),
    CHECK ((lean_angle IS NULL) = (lean_on IS NULL)),
    CHECK (lean_slide IS NULL OR lean_angle IS NOT NULL)
);

-- 숨긴 책: 지금 서재에서는 지웠지만 연도 책장에 있어 남긴 책. 비어 있으면 보이는 책
ALTER TABLE my_books ADD COLUMN hidden_at TIMESTAMPTZ;
