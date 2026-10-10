// 장정 편집: 책 색(추천 5)·재질·표지 그림·모티프·책등 조판. 장정만 바뀌고 독서 기록·배치는 그대로다. 저장하면 사용자 오버라이드로 남아 재시작 후에도 유지된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { bindingFields, rebindInput } from '@/domain/library';
import { buildBookArt } from '@/domain/rebinding';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Screen } from '@/ui/kit';

export default function EditBinding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const bd = b?.bindingId ? lib.bindings[b.bindingId] : undefined;
  // 추천 = 판본에 저장된 계산값(없으면 지금 입력으로 다시 계산)
  const recommended = useMemo<BindingDraft>(() => ({ ...bindingFields(e?.art ?? buildBookArt(e ? rebindInput(e) : { title: '' })), seed: 0, source: 'default' }), [e]);
  const [v, setV] = useState<BindingDraft>(() => ({ ...recommended, ...(bd ? { spineColor: bd.spineColor, motif: bd.motif, seed: bd.seed, source: bd.source, inkColor: bd.inkColor ?? recommended.inkColor, accentColor: bd.accentColor ?? recommended.accentColor, layout: bd.layout ?? recommended.layout, material: bd.material, coverArtId: bd.coverArtId } : {}) }));
  if (!b || !e) return <Screen title="장정 편집"><Empty title="책을 찾을 수 없어요" /></Screen>;
  return (
    <Screen
      title="장정 편집"
      footer={
        <Btn
          label="이 장정으로 사용"
          onPress={() => {
            // 추천으로 되돌려 재질·표지 그림이 비면 예전 값도 지운다
            libraryStore.setBinding(id, { ...v, material: v.material, coverArtId: v.coverArtId });
            router.back();
          }}
        />
      }>
      <BindingEditor title={e.title} author={e.authors.join(', ')} size={e.size} pages={e.pageCount} value={v} recommended={recommended} onChange={setV} />
    </Screen>
  );
}
