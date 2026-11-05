-- 갈피 보드 카드 폭(앱 local-db v9와 같은 내용): 손잡이로 키우거나 줄인 갈피만 값이 있다. 비어 있으면 기본 폭.
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS board_w DOUBLE PRECISION;
