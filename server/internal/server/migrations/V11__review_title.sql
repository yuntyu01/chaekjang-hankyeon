-- 2026-11 공개 평가에 책 제목(평가할 때 사용자가 가진 책의 제목, 표시용). 평가는 여전히 ISBN-13 기준이고 제목은 프로필 목록에 보여 주기만 한다
ALTER TABLE book_reviews ADD COLUMN IF NOT EXISTS book_title TEXT CHECK (book_title IS NULL OR char_length(book_title) <= 200);
