// 연결할 책 고르기(갈피 작성·독서 시작·세션 수정이 함께 쓴다). 최근 읽은 책을 먼저.
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STATUS_LABEL } from '@/features/book/labels';
import type { Library } from '@/domain/library';
import { Btn, ui } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export function recentBookIds(lib: Library) {
  const last = new Map<string, string>();
  for (const s of Object.values(lib.sessions)) if (s.myBookId && lib.books[s.myBookId] && (last.get(s.myBookId) ?? '') < s.startedAt) last.set(s.myBookId, s.startedAt);
  for (const b of Object.values(lib.books)) if (b.status === 'reading' && !last.has(b.id)) last.set(b.id, b.updatedAt);
  return [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}

export function BookPicker({ lib, visible, allowNone, onPick, onClose }: { lib: Library; visible: boolean; allowNone?: boolean; onPick: (id: string | undefined) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} accessibilityLabel="닫기" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={st.title}>책 고르기</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="제목·저자" placeholderTextColor={colors.inkFaint} style={st.input} />
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {allowNone ? (
            <Pressable style={st.item} onPress={() => onPick(undefined)} accessibilityRole="button">
              <Text style={st.itemTitle}>책 연결 없이</Text>
            </Pressable>
          ) : null}
          {list.map((id) => {
            const b = lib.books[id];
            const e = lib.editions[b.editionId];
            const color = b.bindingId ? lib.bindings[b.bindingId]?.spineColor : undefined;
            return (
              <Pressable key={id} style={st.item} onPress={() => onPick(id)} accessibilityRole="button" accessibilityLabel={e?.title}>
                <View style={[st.spine, { backgroundColor: color ?? '#B7AE9F' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={st.itemTitle} numberOfLines={2}>
                    {e?.title}
                  </Text>
                  <Text style={st.itemSub} numberOfLines={1}>
                    {[e?.authors.join(', '), STATUS_LABEL[b.status]].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {!list.length ? <Text style={[st.itemSub, { paddingVertical: 20, textAlign: 'center' }]}>내 책이 없어요. 먼저 책을 추가해 주세요.</Text> : null}
        </ScrollView>
        <Btn label="닫기" kind="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,18,15,0.3)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title: { fontFamily: fonts.round, fontSize: 19, color: colors.ink, marginBottom: 10 },
  input: { minHeight: 44, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E3D9C9', backgroundColor: ui.card, paddingHorizontal: 12, fontSize: 15, color: colors.ink, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6DCCB' },
  spine: { width: 8, height: 36, borderRadius: 2 },
  itemTitle: { fontFamily: fonts.serif, fontSize: 15, color: colors.ink },
  itemSub: { fontSize: 12.5, color: colors.inkSoft },
});
