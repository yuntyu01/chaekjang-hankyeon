-- 장정 재질: 앱의 재질 이름이 바뀌어(fine, linen, matte, laid) 옛 CHECK(paper, cloth, coated)에 걸려 올리기가 통째로 실패했다. 값 검사는 앱(bindingMaterialOf)이 맡는다.
ALTER TABLE bindings DROP CONSTRAINT IF EXISTS bindings_material_check;

-- 계정 삭제의 선행 계정 찾기에 쓴다(deletion.go)
CREATE INDEX IF NOT EXISTS account_predecessors_target_idx ON account_predecessors (target_id);

-- 어떤 조회에도 쓰지 않는 색인
DROP INDEX IF EXISTS book_authors_name_idx;
DROP INDEX IF EXISTS editions_isbn_idx;
DROP INDEX IF EXISTS sessions_started_idx;
