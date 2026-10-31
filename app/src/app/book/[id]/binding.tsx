// 장정 편집: 책 색(추천 5)·재질·표지 그림·모티프·책등 조판. 장정만 바뀌고 독서 기록·배치는 그대로다. 저장하면 사용자 오버라이드로 남아 재시작 후에도 유지된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { BindingEditor, type BindingDraft } from '@/features/book/BindingEditor';
import { bindingFields, rebindInput } from '@/domain/library';
import { buildBookArt } from '@/domain/rebinding';
import { libraryStore, useLibrary } from '@/store/library-store';
import { usePlacementStore } from '@/store/placement-store';
import { Btn, Empty, Screen } from '@/ui/kit';
import { type } from '@/ui/screenTheme';

export default function EditBinding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  // 아무것도 고르지 않았으면 책장에 보이는 모습 그대로 보여 주고, 저장해도 바꾸지 않는다
  const [touched, setTouched] = useState(false);
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
      right={
        <Pressable onPress={() => { setTouched(true); setV({ ...recommended, seed: v.seed, source: 'default' }); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="추천 장정으로 초기화" style={{ minHeight: 44, justifyContent: 'center', paddingRight: 10 }}>
          <Text style={[type.sub, { fontSize: 16 }]}>초기화</Text>
        </Pressable>
      }
      footer={
        <Btn
          label="저장"
          onPress={() => {
            if (!touched) return router.back();
            // 추천으로 되돌려 재질·표지 그림이 비면 예전 값도 지운다
            libraryStore.setBinding(id, { ...v, material: v.material, coverArtId: v.coverArtId });
            router.back();
          }}
        />
      }>
      <BindingEditor title={e.title} author={e.authors.join(', ')} size={e.size} pages={e.pageCount} value={v} recommended={recommended} current={touched ? undefined : place.books[id]} onChange={(next) => { setTouched(true); setV(next); }} />
    </Screen>
  );
}
