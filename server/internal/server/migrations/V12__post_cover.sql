-- 2026-11 게시물 책 첨부의 표지 썸네일: 도서 정보 제공처(YES24 등)의 공개 표지 주소만(https). 사용자가 찍은 표지 사진은 올리지 않는다
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS cover_url TEXT CHECK (cover_url IS NULL OR (char_length(cover_url) <= 500 AND cover_url ~ '^https://'));
