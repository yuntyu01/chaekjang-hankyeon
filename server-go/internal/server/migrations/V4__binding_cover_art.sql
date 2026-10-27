-- 기본 정면 장정 그림 id(앱 Binding.coverArtId, cover-artworks: forest-path 등). 비우면 단색 정면. 그림이 늘어날 수 있어 값 목록은 앱이 확인한다.
ALTER TABLE bindings ADD COLUMN cover_art_id TEXT;
