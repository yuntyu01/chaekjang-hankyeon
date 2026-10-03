import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ymd } from '@/features/book/labels';
import { toShelfBook } from '@/domain/library';
import { BookmarkCard } from '@/features/bookmark/BookmarkCard';
import { useLibrary } from '@/store/library-store';
import { Plus, Search, X } from '@/ui/icons';
import { Chip, Empty, Row, Screen, s as kit } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

export default function BookmarksTab() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [byBook, setByBook] = useState(!!params.book);
  const [book, setBook] = useState<string | null>(params.book ?? null);
  useEffect(() => { setBook(params.book ?? null); setByBook(!!params.book); }, [params.book]);
  const all = useMemo(() => Object.values(lib.bookmarks).filter((m) => lib.books[m.myBookId]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [lib]);
  const booksWith = useMemo(() => [...new Set(all.map((m) => m.myBookId))], [all]);
  const list = all.filter((m) => (!book || m.myBookId === book) && (!q.trim() || m.text.includes(q.trim()) || (m.memo ?? '').includes(q.trim())));
  return <Screen title="갈피" subtitle={`${all.length}개의 문장`} back={false} scroll={false} right={
    <View style={{ flexDirection: 'row', marginRight: 18, gap: 4 }}>
      <Pressable onPress={() => setSearching(!searching)} style={st.icon} accessibilityRole="button" accessibilityLabel="갈피 검색">{searching ? <X size={21} color={colors.ink} /> : <Search size={21} color={colors.ink} />}</Pressable>
      <Pressable onPress={() => router.push({ pathname: '/bookmark/new', params: book ? { book } : {} })} style={[st.icon, { backgroundColor: screenTheme.surface, borderRadius: 22 }]} accessibilityRole="button" accessibilityLabel="갈피 추가"><Plus size={23} color={colors.ink} strokeWidth={1.6} /></Pressable>
    </View>}>
    {searching ? <TextInput accessibilityLabel="갈피 검색어" value={q} onChangeText={setQ} autoFocus placeholder="문장·메모에서 찾기" placeholderTextColor={colors.inkFaint} style={[kit.input, { marginBottom: 12 }]} /> : null}
    <Row gap={24} style={{ marginBottom: 14, borderBottomWidth: 1, borderBottomColor: screenTheme.border }}>
      <Pressable onPress={() => { setBook(null); setByBook(false); }} accessibilityRole="tab" accessibilityState={{ selected: !byBook }} style={[st.tab, !byBook && st.selected]}><Text style={st.tabText}>전체</Text></Pressable>
      <Pressable onPress={() => setByBook(true)} accessibilityRole="tab" accessibilityState={{ selected: byBook }} style={[st.tab, byBook && st.selected]}><Text style={st.tabText}>책별</Text></Pressable>
    </Row>
    {byBook ? <Row style={{ marginBottom: 10 }}><Chip label="모든 책" on={!book} onPress={() => setBook(null)} />{booksWith.map((id) => <Chip key={id} label={lib.editions[lib.books[id].editionId]?.title ?? '제목 없음'} on={book === id} onPress={() => setBook(id)} />)}</Row> : null}
    <FlatList data={list} keyExtractor={(m) => m.id} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" initialNumToRender={4} windowSize={5} contentContainerStyle={{ paddingBottom: navigation.height + 40 }}
      ListEmptyComponent={<Empty title={!all.length ? '첫 갈피를 남겨 보세요' : '맞는 갈피가 없어요'} body={!all.length ? '마음에 남은 문장을 책과 함께 모아 둘 수 있어요.' : undefined} action={!all.length ? (Object.keys(lib.books).length ? '갈피 남기기' : '책 추가') : undefined} onAction={() => router.push(Object.keys(lib.books).length ? '/bookmark/new' : '/book/add')} />}
      renderItem={({ item: m }) => { const b = lib.books[m.myBookId]; const e = lib.editions[b.editionId]; if (!e) return null; return <Pressable onPress={() => router.push(`/bookmark/${m.id}`)} accessibilityRole="button" accessibilityLabel={`${m.text}, ${e.title}`} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
        <BookmarkCard compact showMemo={false} width={width - 48} seed={m.id} data={{ text: m.text, title: e.title, author: e.authors.join(', '), page: m.page, date: ymd(m.createdAt), color: (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#A3B8C5', book: toShelfBook(lib, b.id) ?? undefined }} />
      </Pressable>; }} />
  </Screen>;
}
const st = StyleSheet.create({
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tab: { minHeight: 44, paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selected: { borderBottomColor: screenTheme.primary },
  tabText: { fontFamily: fonts.round, fontSize: 16, color: colors.ink },
});
