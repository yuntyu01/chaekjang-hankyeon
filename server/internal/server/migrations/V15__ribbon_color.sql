-- 사용자가 고른 갈피 색(책장 갈피·갈피 카드 뒤 종이·테이프). 선택 값이고, 없으면 앱이 표지에서 뽑은 색을 쓴다
ALTER TABLE my_books ADD COLUMN IF NOT EXISTS ribbon_color TEXT;
