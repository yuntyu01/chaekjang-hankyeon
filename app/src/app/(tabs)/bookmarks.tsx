import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ymd } from '@/features/book/labels';
import { memoShelfBook } from '@/domain/library';
import { BookmarkCard } from '@/features/bookmark/BookmarkCard';
import { BookmarkEmpty } from '@/features/bookmark/BookmarkEmpty';
import { useLibrary } from '@/store/library-store';
import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { bookmarkPreferencesStore, useBookmarkPreferences } from '@/store/bookmark-preferences-store';
import { Plus, Search, X } from '@/ui/icons';
import { Chip, Empty, Row, Screen, ui, s as kit } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

export default function BookmarksTab() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib, loaded } = useLibrary();
  const { active } = useReading();
  const { ids: savedIds } = useBookmarkPreferences();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'all' | 'photo' | 'books' | 'saved'>(params.book ? 'books' : 'all');
  const [book, setBook] = useState<string | null>(params.book ?? null);
  useEffect(() => { setBook(params.book ?? null); setTab(params.book ? 'books' : 'all'); }, [params.book]);
  const all = useMemo(() => Object.values(lib.bookmarks).filter((m) => lib.books[m.myBookId]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [lib]);
  const booksWith = useMemo(() => [...new Set(all.map((m) => m.myBookId))], [all]);
  const list = all.filter((m) => (tab !== 'books' || !book || m.myBookId === book) && (tab !== 'saved' || savedIds.includes(m.id)) && (tab !== 'photo' || !!m.photoUri) && (!q.trim() || m.text.includes(q.trim()) || (m.memo ?? '').includes(q.trim())));
  const toggleSaved = (id: string) => { void bookmarkPreferencesStore.toggle(id).catch(() => Alert.alert('갈피 표시를 저장하지 못했어요', '잠시 후 다시 눌러 주세요.')); };
  // 불러오는 중에는 제목만(빈 화면이 잠깐 보이지 않게). 저장된 갈피가 하나도 없을 때만 빈 화면: 문장 수·검색·추가·분류는 감춘다
  if (!loaded) return <Screen title="갈피" back={false} scroll={false}><View /></Screen>;
  if (!all.length) return <Screen title="갈피" back={false} scroll={false}><BookmarkEmpty /></Screen>;
  return <Screen title="갈피" subtitle={`${all.length}개의 문장`} back={false} scroll={false} right={
    <View style={{ flexDirection: 'row', marginRight: 18, gap: 4 }}>
      <Pressable onPress={() => setSearching(!searching)} style={st.icon} accessibilityRole="button" accessibilityLabel="갈피 검색">{searching ? <X size={21} color={colors.ink} /> : <Search size={21} color={colors.ink} />}</Pressable>
      <Pressable onPress={() => router.push({ pathname: '/bookmark/new', params: { ...(book ? { book } : {}), ...(tab === 'photo' ? { mode: 'photo' } : {}) } })} style={st.icon} accessibilityRole="button" accessibilityLabel="갈피 추가"><View style={st.addCircle}><Plus size={23} color={colors.ink} strokeWidth={1.8} /></View></Pressable>
    </View>}>
    {searching ? <TextInput accessibilityLabel="갈피 검색어" value={q} onChangeText={setQ} autoFocus placeholder="문장·메모에서 찾기" placeholderTextColor={colors.inkFaint} style={[kit.input, { marginBottom: 12 }]} /> : null}
    <Row gap={8} style={{ marginTop: 3, marginBottom: 9, borderBottomWidth: 0.6, borderBottomColor: screenTheme.border }}>
      {([{ id: 'all', label: '전체' }, { id: 'photo', label: '사진' }, { id: 'books', label: '책별' }, { id: 'saved', label: '아껴둔' }] as const).map((item) => <Pressable key={item.id} onPress={() => { setTab(item.id); if (item.id === 'all') setBook(null); }} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} style={[st.tab, tab === item.id && st.selected]}><Text style={[st.tabText, tab === item.id && st.selectedText]}>{item.label}</Text></Pressable>)}
    </Row>
    {tab === 'books' ? <Row style={{ marginBottom: 10 }}><Chip label="모든 책" on={!book} onPress={() => setBook(null)} />{booksWith.map((id) => <Chip key={id} label={lib.editions[lib.books[id].editionId]?.title ?? '제목 없음'} on={book === id} onPress={() => setBook(id)} />)}</Row> : null}
    <FlatList data={list} keyExtractor={(m) => m.id} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" initialNumToRender={4} windowSize={5} style={{ marginHorizontal: -ui.pad }} contentContainerStyle={{ paddingHorizontal: ui.pad, paddingBottom: navigation.height + 40 + (active ? MINI_TIMER_SPACE : 0) }}
      // 갈피는 있지만 검색·분류 결과만 없을 때: 조작부는 그대로 두고 안내만
      ListEmptyComponent={<Empty title={tab === 'photo' && !q ? '사진 갈피가 없어요' : tab === 'saved' && !q ? '아껴둔 갈피가 없어요' : '맞는 갈피가 없어요'} body={tab === 'photo' && !q ? '페이지를 찍어 그대로 붙여 두세요.' : tab === 'saved' && !q ? '갈피 오른쪽 아래의 표시를 눌러 모아 보세요.' : q.trim() ? '다른 낱말로 찾아보세요.' : undefined} />}
      renderItem={({ item: m }) => { const b = lib.books[m.myBookId]; const e = lib.editions[b.editionId]; if (!e) return null; return <BookmarkCard compact showMemo={false} width={width - ui.pad * 2} seed={m.id} onOpen={() => router.push(`/bookmark/${m.id}`)} saved={savedIds.includes(m.id)} onToggleSaved={() => toggleSaved(m.id)} data={{ text: m.text, title: e.title, author: e.authors.join(', '), page: m.page, date: ymd(m.createdAt), color: (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#A3B8C5', book: memoShelfBook(lib, b.id) ?? undefined, photoUri: m.photoUri, photoRatio: m.photoRatio }} />; }} />
  </Screen>;
}
const st = StyleSheet.create({
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addCircle: { width: 36, height: 36, borderWidth: 1, borderColor: '#D7D0C7', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tab: { minHeight: 44, minWidth: 64, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selected: { borderBottomColor: '#594541' },
  tabText: { fontSize: 15, color: colors.inkSoft },
  selectedText: { fontFamily: fonts.round, color: colors.ink },
});
