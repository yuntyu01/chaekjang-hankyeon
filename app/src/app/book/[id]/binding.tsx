// 장정 편집: 책등 색·모티프·다시 만들기. 장정만 바뀌고 독서 기록·배치는 그대로다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Screen } from '@/ui/kit';

export default function EditBinding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const bd = b?.bindingId ? lib.bindings[b.bindingId] : undefined;
  const [v, setV] = useState<BindingDraft>(() => ({ spineColor: bd?.spineColor ?? '#3D5F57', motif: bd?.motif ?? 'leaf', seed: bd?.seed ?? 0, source: bd?.source ?? 'default' }));
  if (!b || !e) return <Screen title="장정 편집"><Empty title="책을 찾을 수 없어요" /></Screen>;
  return (
    <Screen
      title="장정 편집"
      footer={
        <Btn
          label="이 장정으로 사용"
          onPress={() => {
            libraryStore.setBinding(id, v);
            router.back();
          }}
        />
      }>
      <BindingEditor title={e.title} author={e.authors.join(', ')} size={e.size} pages={e.pageCount} value={v} onChange={setV} />
    </Screen>
  );
}
