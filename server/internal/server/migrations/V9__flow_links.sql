-- 2026-11 흐름 연결(앱 local-db v5와 같은 내용). 모두 선택 값이라 예전 기록은 비어 있다(지어내지 않는다).
-- sessions.start_page: 이번 독서를 시작한 쪽(pages_read는 예전처럼 '도달한 쪽'). 둘 다 있을 때만 읽은 분량을 센다.
-- bookmarks.session_id: 갈피를 남긴 독서 기록(선택). 기록이 지워지면 앱이 연결만 비운다(갈피 원문은 그대로) — 외래 키를 두지 않는다.
-- bookmarks.saved_at: '아껴둔' 갈피로 표시한 때(이전에는 기기 안에만 있어 백업·동기화에 빠졌다).
-- editions.product_id·link: 도서 정보 제공처(YES24 등)의 상품 번호·상품 페이지(약관: 출처와 링크 표시).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_page INTEGER;
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE editions ADD COLUMN IF NOT EXISTS link TEXT;
