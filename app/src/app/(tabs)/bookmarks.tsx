import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ymd } from '@/features/book/labels';
import { memoShelfBook } from '@/domain/library';
import { BookmarkCard } from '@/features/bookmark/BookmarkCard';
import { BookmarkEmpty } from '@/features/bookmark/BookmarkEmpty';
import { useLibrary } from '@/store/library-store';
import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { bookmarkPreferencesStore, useBookmarkPreferences } from '@/store/bookmark-preferences-store';
import { LibraryCover } from '@/ui/BookVisual';
import { Check, Plus, Search, X } from '@/ui/icons';
import { Empty, FilterButton, IconButton, ListGroup, ListItem, Screen, SearchField, Segmented, Sheet, ui } from '@/ui/kit';
import { colors, icon, press, space, type } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

// 갈피(2026-11-01 사용자 시안): 머리줄 '갈피 N개' + 검색·추가, '전체 갈피 | 아껴둔' 전환 칸, 그 아래 거르기 '모든 책 ▾'(책 선택 시트: 내 책 검색·
// 표지·갈피 수·체크)와 '모든 유형 ▾'(문장·사진). 갈피 카드는 그대로.
type Kind = 'all' | 'text' | 'photo';
const VIEW = [{ id: 'all', label: '전체 갈피' }, { id: 'saved', label: '아껴둔' }] as const;
const KIND_LABEL: Record<Kind, string> = { all: '모든 유형', text: '문장 갈피', photo: '사진 갈피' };

export default function BookmarksTab() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib, loaded } = useLibrary();
  const { active } = useReading();
  const { ids: savedIds } = useBookmarkPreferences();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState<'all' | 'saved'>('all');
  const [book, setBook] = useState<string | null>(params.book ?? null);
  const [kind, setKind] = useState<Kind>('all');
  const [sheet, setSheet] = useState<'book' | 'kind' | null>(null);
  const [bookQ, setBookQ] = useState('');
  useEffect(() => { setBook(params.book ?? null); if (params.book) setView('all'); }, [params.book]);
  const all = useMemo(() => Object.values(lib.bookmarks).filter((m) => lib.books[m.myBookId]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [lib]);
  // 갈피가 있는 책(갈피 수와 함께, 최근 갈피 순)
  const books = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of all) n.set(m.myBookId, (n.get(m.myBookId) ?? 0) + 1);
    return [...n.entries()].map(([id, count]) => ({ id, count, title: lib.editions[lib.books[id].editionId]?.title ?? '제목 없음' }));
  }, [all, lib]);
  const bookTitle = book ? books.find((x) => x.id === book)?.title ?? lib.editions[lib.books[book]?.editionId ?? '']?.title : null;
  const list = all.filter((m) => (!book || m.myBookId === book) && (view !== 'saved' || savedIds.includes(m.id)) && (kind !== 'photo' || !!m.photoUri) && (kind !== 'text' || !!m.text.trim()) && (!q.trim() || m.text.includes(q.trim()) || (m.memo ?? '').includes(q.trim())));
  const toggleSaved = (id: string) => { void bookmarkPreferencesStore.toggle(id).catch(() => Alert.alert('갈피 표시를 저장하지 못했어요', '잠시 후 다시 눌러 주세요.')); };
  const closeSheet = () => { setSheet(null); setBookQ(''); };
  // 불러오는 중에는 제목만(빈 화면이 잠깐 보이지 않게). 저장된 갈피가 하나도 없을 때만 빈 화면: 문장 수·검색·추가·분류는 감춘다
  if (!loaded) return <Screen title="갈피" back={false} scroll={false}><View /></Screen>;
  if (!all.length) return <Screen title="갈피" back={false} scroll={false}><BookmarkEmpty /></Screen>;
  const shownBooks = books.filter((x) => !bookQ.trim() || x.title.includes(bookQ.trim()));
  const emptyTitle = view === 'saved' && !q && !book && kind === 'all' ? '아껴둔 갈피가 없어요' : kind === 'photo' && !q ? '사진 갈피가 없어요' : '맞는 갈피가 없어요';
  const emptyBody = view === 'saved' && !q && !book && kind === 'all' ? '갈피 오른쪽 아래의 표시를 눌러 모아 보세요.' : kind === 'photo' && !q ? '페이지를 찍어 그대로 붙여 두세요.' : q.trim() ? '다른 낱말로 찾아보세요.' : '다른 책이나 유형을 골라 보세요.';
  return <Screen title="갈피" subtitle={`갈피 ${all.length}개`} back={false} scroll={false} right={
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <IconButton label={searching ? '갈피 검색 닫기' : '갈피 검색'} onPress={() => { if (searching) setQ(''); setSearching(!searching); }}>{searching ? <X size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /> : <Search size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}</IconButton>
      <IconButton label="갈피 추가" onPress={() => router.push({ pathname: '/bookmark/new', params: { ...(book ? { book } : {}), ...(kind === 'photo' ? { mode: 'photo' } : {}) } })}><Plus size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
    </View>}>
    {searching ? <SearchField accessibilityLabel="갈피 검색어" value={q} onChangeText={setQ} autoFocus placeholder="문장·메모에서 찾기" style={{ marginTop: space.tight, marginBottom: space.item }} /> : null}
    <Segmented items={VIEW} value={view} onChange={setView} style={{ marginTop: 4 }} />
    <View style={st.filters}>
      <FilterButton label={bookTitle ?? '모든 책'} active={!!book} onPress={() => setSheet('book')} />
      <FilterButton label={KIND_LABEL[kind]} active={kind !== 'all'} onPress={() => setSheet('kind')} />
    </View>
    <FlatList data={list} keyExtractor={(m) => m.id} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" initialNumToRender={4} windowSize={5} style={{ marginHorizontal: -ui.pad }} contentContainerStyle={{ paddingHorizontal: ui.pad, paddingBottom: navigation.height + 40 + (active ? MINI_TIMER_SPACE : 0) }}
      // 갈피는 있지만 검색·거르기 결과만 없을 때: 조작부는 그대로 두고 안내만
      ListEmptyComponent={<Empty title={emptyTitle} body={emptyBody} />}
      renderItem={({ item: m }) => { const b = lib.books[m.myBookId]; const e = lib.editions[b.editionId]; if (!e) return null; return <BookmarkCard compact showMemo={false} width={width - ui.pad * 2} seed={m.id} onOpen={() => router.push(`/bookmark/${m.id}`)} saved={savedIds.includes(m.id)} onToggleSaved={() => toggleSaved(m.id)} data={{ text: m.text, title: e.title, author: e.authors.join(', '), page: m.page, date: ymd(m.createdAt), color: (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#A3B8C5', book: memoShelfBook(lib, b.id) ?? undefined, photoUri: m.photoUri, photoRatio: m.photoRatio }} />; }} />
    {/* 책 선택: 내 책 검색 + '모든 책' + 갈피가 있는 책(표지·갈피 수). 고른 줄에 체크 */}
    <Sheet visible={sheet === 'book'} onClose={closeSheet} title="책 선택" scroll maxHeight="80%">
      {books.length > 5 ? <SearchField value={bookQ} onChangeText={setBookQ} placeholder="내 책 검색" accessibilityLabel="갈피를 볼 책 찾기" style={{ marginBottom: space.tight }} /> : null}
      <BookChoice label="모든 책" sub={`갈피 ${all.length}개`} on={!book} onPress={() => { setBook(null); closeSheet(); }} />
      {shownBooks.map((x) => (
        <BookChoice key={x.id} label={x.title} sub={`갈피 ${x.count}개`} on={book === x.id} onPress={() => { setBook(x.id); closeSheet(); }} cover={<LibraryCover lib={lib} id={x.id} width={40} />} />
      ))}
    </Sheet>
    <Sheet visible={sheet === 'kind'} onClose={closeSheet} title="갈피 유형">
      <ListGroup>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <ListItem key={k} label={KIND_LABEL[k]} chevron={false} right={kind === k ? <Check size={20} color={colors.accent} strokeWidth={2.2} /> : null} onPress={() => { setKind(k); closeSheet(); }} />
        ))}
      </ListGroup>
    </Sheet>
  </Screen>;
}

function BookChoice({ label, sub, on, onPress, cover }: { label: string; sub: string; on: boolean; onPress: () => void; cover?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label}, ${sub}`} style={({ pressed }) => [st.choice, pressed && press]}>
      {cover ? <View style={st.cover} pointerEvents="none">{cover}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.row, on && { fontFamily: type.label.fontFamily }]} numberOfLines={1}>{label}</Text>
        <Text style={type.caption}>{sub}</Text>
      </View>
      {on ? <Check size={20} color={colors.accent} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  filters: { flexDirection: 'row', gap: space.tight, marginTop: space.item, marginBottom: space.item },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 8 },
  cover: { width: 40, alignItems: 'center' },
});
