// 연결할 책 고르기(갈피 작성·독서 시작·세션 수정이 함께 쓴다). 최근 읽은 책을 먼저.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { STATUS_LABEL } from '@/features/book/labels';
import type { Library } from '@/domain/library';
import { Btn, Divider, SearchField, Sheet, useUi } from '@/ui/kit';
import { colors, press } from '@/ui/screenTheme';

export function recentBookIds(lib: Library) {
  const last = new Map<string, string>();
  for (const s of Object.values(lib.sessions)) if (s.myBookId && lib.books[s.myBookId] && (last.get(s.myBookId) ?? '') < s.startedAt) last.set(s.myBookId, s.startedAt);
  for (const b of Object.values(lib.books)) if (b.status === 'reading' && !last.has(b.id)) last.set(b.id, b.updatedAt);
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}

// onAddNew: '새 책 등록'(등록 화면으로 갔다가 uiBus.offerPickedBook으로 돌아온다). 주지 않으면 줄을 보이지 않는다
export function BookPicker({ lib, visible, allowNone, onPick, onClose, onAddNew }: { lib: Library; visible: boolean; allowNone?: boolean; onPick: (id: string | undefined) => void; onClose: () => void; onAddNew?: () => void }) {
  // 부르는 화면의 기준을 따른다(독서 타이머는 정돈 변형, 갈피 작성은 예전 그대로)
  const { type, space, tidy } = useUi();
  const [q, setQ] = useState('');
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
    <Sheet visible={visible} onClose={onClose} title="책 고르기" maxHeight="85%">
      <SearchField value={q} onChangeText={setQ} placeholder="제목·저자" accessibilityLabel="책 찾기" style={{ marginTop: space.tight, marginBottom: tidy ? 4 : space.tight }} />
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {onAddNew ? (
          <Pressable style={({ pressed }) => [st.item, pressed && press]} onPress={onAddNew} accessibilityRole="button" accessibilityLabel="새 책 등록">
            <Text style={[type.row, { color: colors.accent }]}>+ 새 책 등록</Text>
          </Pressable>
        ) : null}
        {allowNone ? (
          <Pressable style={({ pressed }) => [st.item, pressed && press]} onPress={() => onPick(undefined)} accessibilityRole="button">
            <Text style={type.row}>책 연결 없이</Text>
          </Pressable>
        ) : null}
        {list.map((id, i) => {
          const b = lib.books[id];
          const e = lib.editions[b.editionId];
          const color = b.bindingId ? lib.bindings[b.bindingId]?.spineColor : undefined;
          return (
            <View key={id}>
              {i || allowNone || onAddNew ? <Divider /> : null}
              <Pressable style={({ pressed }) => [st.item, pressed && press]} onPress={() => onPick(id)} accessibilityRole="button" accessibilityLabel={e?.title}>
                <View style={[st.spine, { backgroundColor: color ?? '#B7AE9F' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={tidy ? type.rowStrong : type.row} numberOfLines={2}>
                    {e?.title}
                  </Text>
                  <Text style={[type.sub, { marginTop: tidy ? 4 : 2 }]} numberOfLines={1}>
                    {[e?.authors.join(', '), STATUS_LABEL[b.status]].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
        {!list.length ? <Text style={[type.sub, { paddingVertical: 24, textAlign: 'center' }]}>{q.trim() ? '맞는 책이 없어요.' : '내 책이 없어요. 먼저 책을 추가해 주세요.'}</Text> : null}
      </ScrollView>
      <Btn label="닫기" kind="ghost" onPress={onClose} style={{ marginTop: space.tight }} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 10 },
  spine: { width: 8, height: 38, borderRadius: 2 },
});
