-- 갈피 보드(앱 local-db v6과 같은 내용): 책 한 권의 갈피를 넓은 보드에 흩어 붙인 자리. 모두 선택 값이다.
-- 비어 있으면 앱이 자동으로 놓고(손으로 옮기거나 보드에서 새로 남긴 갈피만 값이 있다), 값은 보드 좌표 중심(dp)과 기울기(도).
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS board_x DOUBLE PRECISION;
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS board_y DOUBLE PRECISION;
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS board_rot DOUBLE PRECISION;
