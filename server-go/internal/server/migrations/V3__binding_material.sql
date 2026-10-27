-- 장정 재질(표지·책등·판의 표면): 무광 종이 · 천 · 코팅지. 비우면 무광 종이로 본다(앱 Binding.material과 같은 값).
ALTER TABLE bindings ADD COLUMN material TEXT CHECK (material IN ('paper', 'cloth', 'coated'));
