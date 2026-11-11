// 연결할 책 고르기(갈피 작성·독서 시작·세션 수정이 함께 쓴다). 최근 읽은 책을 먼저.
// multi: 여러 권 고르기(읽기 탭 '책 추가', 2026-11-11 사용자 '여러 개 고른 다음에 완료'). 줄을 누르면 체크만 되고 '완료'로 한꺼번에 넘긴다.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { STATUS_LABEL } from '@/features/book/labels';
import type { Library } from '@/domain/library';
import { Btn, Divider, SearchField, Sheet } from '@/ui/kit';
import { space, type } from '@/ui/theme';
import { colors, press } from '@/ui/theme';
import { LinkedCover } from '@/ui/BookVisual';
import { Check } from '@/ui/icons';

// 여러 권 고르기: fixed = 이미 목록에 있어 고를 수 없는 것(체크된 채 흐리게), none = '책 없이 읽기' 줄의 값, onDone = 새로 고른 것(고른 순서)
export type MultiPick = { fixed: string[]; none: string; onDone: (ids: string[]) => void };

export function recentBookIds(lib: Library) {
  const last = new Map<string, string>();
  for (const s of Object.values(lib.sessions)) if (s.myBookId && lib.books[s.myBookId] && (last.get(s.myBookId) ?? '') < s.startedAt) last.set(s.myBookId, s.startedAt);
  for (const b of Object.values(lib.books)) if (b.status === 'reading' && !last.has(b.id)) last.set(b.id, b.updatedAt);
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}

// onAddNew: '새 책 등록'(등록 화면으로 갔다가 uiBus.offerPickedBook으로 돌아온다). 주지 않으면 줄을 보이지 않는다
export function BookPicker({ lib, visible, allowNone, onPick, onClose, onAddNew, multi }: { lib: Library; visible: boolean; allowNone?: boolean; onPick?: (id: string | undefined) => void; onClose: () => void; onAddNew?: () => void; multi?: MultiPick }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { if (visible) setPicked([]); }, [visible]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // 한 줄 누름: 여러 권 고르기면 체크, 아니면 바로 넘긴다
  const choose = (id: string | undefined) => (multi ? toggle(id ?? multi.none) : onPick?.(id));
  // 오른쪽 체크 동그라미(여러 권 고르기만)
  const mark = (id: string) => {
    if (!multi) return null;
    const fixed = multi.fixed.includes(id);
    const on = fixed || picked.includes(id);
    return <View style={[st.check, on && st.checkOn, fixed && st.checkFixed]} pointerEvents="none">{on ? <Check size={14} color={colors.onAccent} strokeWidth={3} /> : null}</View>;
  };
  const list = useMemo(() => {
    const recent = recentBookIds(lib);
    const rest = Object.keys(lib.books).filter((id) => !recent.includes(id));
    const t = q.trim();
    return [...recent, ...rest].filter((id) => {
      const e = lib.editions[lib.books[id].editionId];
      return !t || `${e?.title} ${e?.authors.join(' ')}`.includes(t);
    });
  }, [lib, q]);
  return (
    <Sheet visible={visible} onClose={onClose} title={multi ? '책 추가' : '책 고르기'} description={multi ? '타이머에 둘 책을 골라요. 여러 권 고를 수 있어요.' : undefined} maxHeight="85%">
      <SearchField value={q} onChangeText={setQ} placeholder="제목·저자" accessibilityLabel="책 찾기" style={{ marginTop: space.tight, marginBottom: 4 }} />
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {onAddNew ? (
          <Pressable style={({ pressed }) => [st.item, pressed && press]} onPress={onAddNew} accessibilityRole="button" accessibilityLabel="새 책 등록">
            <Text style={[type.row, { color: colors.accent }]}>+ 새 책 등록</Text>
          </Pressable>
        ) : null}
        {allowNone ? (
          <Pressable style={({ pressed }) => [st.item, pressed && press, multi?.fixed.includes(multi.none) && st.fixed]} disabled={!!multi?.fixed.includes(multi.none)} onPress={() => choose(undefined)} accessibilityRole={multi ? 'checkbox' : 'button'} accessibilityState={multi ? { checked: multi.fixed.includes(multi.none) || picked.includes(multi.none), disabled: multi.fixed.includes(multi.none) } : undefined}>
            <Text style={[type.row, { flex: 1 }]}>{multi ? '책 없이 읽기' : '책 연결 없이'}</Text>
            {multi ? mark(multi.none) : null}
          </Pressable>
        ) : null}
        {list.map((id, i) => {
          const b = lib.books[id];
          const e = lib.editions[b.editionId];
          const fixed = !!multi?.fixed.includes(id);
          return (
            <View key={id}>
              {i || allowNone || onAddNew ? <Divider /> : null}
              <Pressable style={({ pressed }) => [st.item, pressed && press, fixed && st.fixed]} disabled={fixed} onPress={() => choose(id)} accessibilityRole={multi ? 'checkbox' : 'button'} accessibilityState={multi ? { checked: fixed || picked.includes(id), disabled: fixed } : undefined} accessibilityLabel={fixed ? `${e?.title}, 이미 목록에 있어요` : e?.title}>
                {/* 연결할 책: 실물 표지(사진이 없는 책만 장정 그림) */}
                <View style={st.cover} pointerEvents="none"><LinkedCover lib={lib} id={id} width={34} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={type.rowStrong} numberOfLines={2}>
                    {e?.title}
                  </Text>
                  <Text style={[type.sub, { marginTop: 4 }]} numberOfLines={1}>
                    {[e?.authors.join(', '), fixed ? '목록에 있어요' : STATUS_LABEL[b.status]].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {mark(id)}
              </Pressable>
            </View>
          );
        })}
        {!list.length ? <Text style={[type.sub, { paddingVertical: 24, textAlign: 'center' }]}>{q.trim() ? '맞는 책이 없어요.' : '내 책이 없어요. 먼저 책을 추가해 주세요.'}</Text> : null}
      </ScrollView>
      {multi ? (
        <Btn label={picked.length ? `완료 (${picked.length})` : '완료'} onPress={() => (picked.length ? multi.onDone(picked) : onClose())} style={{ marginTop: space.tight }} />
      ) : (
        <Btn label="닫기" kind="ghost" onPress={onClose} style={{ marginTop: space.tight }} />
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 10 },
  cover: { width: 34, alignItems: 'center' },
  fixed: { opacity: 0.45 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.track, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkFixed: { backgroundColor: colors.inkFaint, borderColor: colors.inkFaint },
});
