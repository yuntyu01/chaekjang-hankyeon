-- 책장 배치를 JSON 한 덩어리(shelf_layouts.layout)에서 표로 나누고, 공유 도서 캐시(books)에서 다른 열로 계산되는 값을 뺀다.
-- 규칙
--  * 선반(shelves)과 책 자리(shelf_placements)는 사용자별 (user_id, id) 키. 책 자리는 책마다 한 줄이라
--    "모든 책은 선반 또는 서랍 중 한 곳에만 있다"를 기본키가 보장한다(shelf_id가 비어 있으면 서랍).
--  * 책 자리는 내 책(my_books)을 가리킨다. 내 책은 지워도 삭제 표시로 남으므로 외래키가 깨지지 않는다.
--  * 배치 전체가 한 단위로 동기화된다(앱이 기록한 시각이 더 새로운 쪽이 이김). 그 시각·rev는 shelf_layouts에 남긴다.
--  * 저장하지 않는 계산값: 선반 폭 대비 위치(x, 앱이 pos와 책 크기로 다시 계산), 키·두께 분류와 기본 모티프(판형·쪽수·ISBN으로 계산).
--  * 열은 앱 BookPlacement의 저장 필드와 하나씩 맞는다(필드를 늘리면 여기·sync_layout.go·앱 local-db에 열을 함께 늘린다). 계산값 x는 빼고.
--  * Flyway V1~V7 DB에도 이 파일부터는 Go 서버가 적용하고 go_schema_history에 남긴다(migrate.go).

CREATE TABLE shelves (
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id       TEXT   NOT NULL,
    position INT    NOT NULL,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE shelf_placements (
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id     TEXT   NOT NULL,
    shelf_id    TEXT,                -- 비어 있으면 서랍
    position    INT    NOT NULL,     -- 선반 안 순서(쌓기 그룹은 같은 값) 또는 서랍 안 순서
    pose        TEXT CHECK (pose IN ('spine', 'horizontal', 'front')),
    tilt        SMALLINT CHECK (tilt IN (-7, 0, 7)),
    stack_id    TEXT,
    stack_order INT,
    pos         DOUBLE PRECISION,    -- 선반 좌표(DU)에서 자리 왼쪽 끝
    lean_angle  DOUBLE PRECISION,    -- 기대기 결과(도)와 기댄 상대 책, 서 있던 자리에서 미끄러진 거리
    lean_on     TEXT,
    lean_slide  DOUBLE PRECISION,
    depth       DOUBLE PRECISION,
    spin        DOUBLE PRECISION,
    pitch       DOUBLE PRECISION,
    stack_dx    DOUBLE PRECISION,
    stack_dz    DOUBLE PRECISION,
    wall_lean   BOOLEAN NOT NULL DEFAULT false, -- 예전 저장본(지금은 pitch)
    flip        BOOLEAN NOT NULL DEFAULT false, -- 눕힌 책이 머리를 오른쪽에 둔다
    overhang    BOOLEAN NOT NULL DEFAULT false, -- 넘어져 판 끝 밖으로 걸친 눕힌 책
    PRIMARY KEY (user_id, book_id),
    FOREIGN KEY (user_id, shelf_id) REFERENCES shelves (user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, book_id) REFERENCES my_books (user_id, id),
    CHECK (shelf_id IS NULL OR (pose IS NOT NULL AND tilt IS NOT NULL)),
    CHECK ((lean_angle IS NULL) = (lean_on IS NULL)),
    CHECK (lean_slide IS NULL OR lean_angle IS NOT NULL)
);
CREATE INDEX shelf_placements_shelf_idx ON shelf_placements (user_id, shelf_id, position);

-- ---------- 기존 JSON 옮기기 ----------
INSERT INTO shelves (user_id, id, position)
SELECT l.user_id, s.v->>'id', COALESCE(round((s.v->>'order')::numeric)::int, s.ord::int - 1)
FROM shelf_layouts l
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.layout->'shelves') = 'array' THEN l.layout->'shelves' ELSE '[]'::jsonb END) WITH ORDINALITY AS s(v, ord)
WHERE s.v->>'id' IS NOT NULL
ON CONFLICT DO NOTHING;

-- 같은 책이 두 번 있으면 먼저 나온 자리를 쓴다. 서버에 없는 책·선반을 가리키는 자리는 버린다(앱이 다음 올리기에서 다시 채운다).
INSERT INTO shelf_placements (user_id, book_id, shelf_id, position, pose, tilt, stack_id, stack_order, pos, lean_angle, lean_on, lean_slide, depth, spin, pitch, stack_dx, stack_dz, wall_lean, flip, overhang)
SELECT l.user_id, p.v->>'bookId', p.v->>'shelfId', COALESCE(round((p.v->>'order')::numeric)::int, 0), p.v->>'pose',
       CASE WHEN p.v->>'tilt' IN ('-7', '7') THEN (p.v->>'tilt')::smallint ELSE 0 END,
       p.v->>'stackId', round((p.v->>'stackOrder')::numeric)::int, (p.v->>'pos')::double precision,
       CASE WHEN p.v->'lean'->>'on' IS NOT NULL THEN (p.v->'lean'->>'angle')::double precision END,
       CASE WHEN p.v->'lean'->>'angle' IS NOT NULL THEN p.v->'lean'->>'on' END,
       CASE WHEN p.v->'lean'->>'on' IS NOT NULL AND p.v->'lean'->>'angle' IS NOT NULL THEN (p.v->'lean'->>'slide')::double precision END,
       (p.v->>'depth')::double precision, (p.v->>'spin')::double precision, (p.v->>'pitch')::double precision,
       (p.v->>'stackDx')::double precision, (p.v->>'stackDz')::double precision, COALESCE((p.v->>'wallLean')::boolean, false),
       COALESCE((p.v->>'flip')::boolean, false), COALESCE((p.v->>'overhang')::boolean, false)
FROM shelf_layouts l
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.layout->'placements') = 'array' THEN l.layout->'placements' ELSE '[]'::jsonb END) WITH ORDINALITY AS p(v, ord)
WHERE p.v->>'pose' IN ('spine', 'horizontal', 'front')
  AND EXISTS (SELECT 1 FROM my_books b WHERE b.user_id = l.user_id AND b.id = p.v->>'bookId')
  AND EXISTS (SELECT 1 FROM shelves s WHERE s.user_id = l.user_id AND s.id = p.v->>'shelfId')
ORDER BY l.user_id, p.ord
ON CONFLICT DO NOTHING;

INSERT INTO shelf_placements (user_id, book_id, shelf_id, position)
SELECT l.user_id, d.v, NULL, d.ord::int - 1
FROM shelf_layouts l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.layout->'drawer') = 'array' THEN l.layout->'drawer' ELSE '[]'::jsonb END) WITH ORDINALITY AS d(v, ord)
WHERE EXISTS (SELECT 1 FROM my_books b WHERE b.user_id = l.user_id AND b.id = d.v)
ORDER BY l.user_id, d.ord
ON CONFLICT DO NOTHING;

-- shelf_layouts는 배치 한 단위의 동기화 정보(앱 시각·rev)만 남긴다
ALTER TABLE shelf_layouts DROP COLUMN layout;

-- ---------- 공유 도서 캐시: 계산되는 열 빼기 ----------
-- 키 분류 = 판형(format), 두께 분류 = 쪽수(page_count), 기본 모티프 = ISBN 해시. 서버(books.go)가 읽을 때 계산한다.
ALTER TABLE books DROP COLUMN height_class;
ALTER TABLE books DROP COLUMN thickness_class;
ALTER TABLE books DROP COLUMN default_motif_id;
