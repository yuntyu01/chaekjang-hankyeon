// 책 상세: 실제 표지·기본 정보 / 이 책 읽기·갈피 남기기·읽기 상태 / 내 기록(회차·별점·감상·누적 시간·갈피·현재 쪽수).
// 날짜·쪽수·별점은 모두 선택 입력. 완독 여부는 사용자가 정한다(타이머로 자동 판정하지 않는다).
import { router, useLocalSearchParams } from 'expo-router';
import { BookOpen, ChevronDown, ChevronRight, MoreHorizontal } from '@/ui/icons';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STATUS_LABEL, ymd } from '@/features/book/labels';
import { placementOf } from '@/domain/layout-engine';
import { bookmarksOf, bookReadMs, completions, formatDuration, memoShelfBook, READ_STATUSES, roundsOf } from '@/domain/library';
import { useLibrary, libraryStore } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { dropImage } from '@/store/files';
import { Btn, Card, Empty, H2, ListItem, Muted, Row, Screen, Stars, Tabs, ui } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';
import { noRibbon, RotatableBook } from '@/ui/book3d/StandaloneBook';
import type { Book } from '@/domain/types';

const STAR = '#A8865F';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 별점·상태를 누를 때마다 돌려 보기 책을 다시 계산·기록하지 않게: 책 객체가 같으면 같은 결과
const ribbonless = new WeakMap<Book, Book>();
function unribboned(b: Book) {
  let x = ribbonless.get(b);
  if (!x) ribbonless.set(b, (x = noRibbon(b)));
  return x;
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [menu, setMenu] = useState(false);
  const [records, setRecords] = useState(false);
  const [pageEdit, setPageEdit] = useState(false);
  const insets = useSafeAreaInsets();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  if (!b || !e)
    return (
      <Screen title="책">
        <Empty title="책을 찾을 수 없어요" body="삭제되었거나 예시 책장 책이에요." action="책장으로" onAction={() => router.dismissTo('/')} />
      </Screen>
    );
  const rounds = roundsOf(lib, id);
  const marks = bookmarksOf(lib, id);
  const readMs = bookReadMs(lib, id);
  const sessions = Object.values(lib.sessions).filter((s) => s.myBookId === id).length;
  const onShelf = !!placementOf(place.layout, id);
  const inDrawer = place.layout.drawer.includes(id);
  const done = completions(lib, id);
  const shelfBook = place.books[id] ?? memoShelfBook(lib, id);
  const shownBook = shelfBook ? unribboned(shelfBook) : null;

  const confirmDelete = () => {
    Alert.alert(
      '내 책에서 삭제할까요?',
      `이 책과 함께 삭제돼요: 독서 회차 ${rounds.length}개, 갈피 ${marks.length}개, 장정.\n독서 시간 기록 ${sessions}개는 ‘책 없음’으로 남아 통계에 계속 포함돼요.\n되돌릴 수 없어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            if (e.coverSource === 'photo') void dropImage(e.coverUri);
            for (const m of marks) void dropImage(m.photoUri);
            libraryStore.deleteBook(id);
            router.dismissTo('/');
          },
        },
      ],
    );
  };

  return (
    <Screen
      title="책 정보"
      footer={<Btn label={b.status === 'want' ? '읽기 시작' : '이어서 읽기'} icon={<BookOpen size={24} color="#FFFFFF" strokeWidth={1.5} />} onPress={() => router.push({ pathname: '/read', params: { book: id } })} />}
      right={
        <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="더 보기">
          <MoreHorizontal size={24} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
      }>
      <View style={st.hero}>
        {shownBook ? <RotatableBook book={shownBook} frontWidth={142} initialSpin={22} shadow label={`${e.title} 표지, 좌우로 끌어 돌려 볼 수 있어요`} /> : null}
        <Text style={st.title}>{e.title}</Text>
        <Text style={st.author}>{e.authors.length ? e.authors.join(', ') : onShelf ? '나의 책장' : inDrawer ? '서랍' : ''}</Text>
      </View>
      <Tabs items={READ_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))} value={b.status} onChange={(s) => libraryStore.setStatus(id, s)} stretch style={{ marginTop: 16 }} />
      {b.status === 'read' ? <Btn label="다시 읽기 시작(새 회차)" kind="ghost" onPress={() => libraryStore.reread(id)} style={{ alignSelf: 'center', minHeight: 40, paddingVertical: 6 }} /> : null}
      <View style={st.stats}>
        <Pressable onPress={() => router.push({ pathname: '/stats', params: { book: id } })} accessibilityRole="button" accessibilityLabel={`읽은 시간 ${formatDuration(readMs)}, 독서 기록 ${sessions}회`} style={st.statCell}>
          <Text style={st.statLabel}>읽은 시간</Text>
          <Text style={st.statValue}>{formatDuration(readMs)}</Text>
        </Pressable>
        <Pressable onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} accessibilityRole="button" accessibilityLabel={`남긴 갈피 ${marks.length}개`} style={st.statCell}>
          <Text style={st.statLabel}>남긴 갈피</Text>
          <Text style={st.statValue}>{marks.length}개</Text>
        </Pressable>
      </View>

      <Row style={st.h} gap={0}>
        <Text style={st.hText}>나의 감상</Text>
        <Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} size={23} color={STAR} />
      </Row>
      <TextInput
        defaultValue={b.note}
        placeholder="이 책은 나에게…"
        placeholderTextColor={colors.inkFaint}
        onEndEditing={(ev) => libraryStore.updateBook(id, { note: ev.nativeEvent.text.trim() || undefined })}
        style={st.note}
        multiline
        maxLength={140}
        accessibilityLabel="나의 감상"
      />

      <Row style={st.h} gap={0}>
        <Text style={st.hText}>남긴 갈피</Text>
        {marks.length ? (
          <Pressable onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} hitSlop={10} accessibilityRole="button" style={st.moreLink}>
            <Text style={st.moreText}>모두 보기</Text>
            <ChevronRight size={18} color={colors.inkSoft} strokeWidth={1.6} />
          </Pressable>
        ) : null}
      </Row>
      {marks.length ? (
        <Pressable onPress={() => router.push(`/bookmark/${marks[0].id}`)} accessibilityRole="button">
          <Text style={st.quote} numberOfLines={4}>“{marks[0].text || '사진 갈피'}”</Text>
          <Muted style={{ marginTop: 6, marginLeft: 14, fontSize: 14 }}>{marks[0].page ? `p. ${marks[0].page}` : ymd(marks[0].createdAt)}</Muted>
        </Pressable>
      ) : (
        <Muted>아직 남긴 갈피가 없어요.</Muted>
      )}
      <Pressable onPress={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} accessibilityRole="button" style={st.bookmarkButton}><Text style={st.bookmarkLabel}>갈피 남기기</Text></Pressable>

      <Pressable onPress={() => setRecords(!records)} accessibilityRole="button" accessibilityState={{ expanded: records }} style={st.recordsToggle}><Text style={st.meta}>읽은 쪽수 · 회차 · 판본 정보</Text><ChevronDown size={16} color={colors.inkSoft} /></Pressable>
      {records ? <View>
      <Pressable onPress={() => setPageEdit(!pageEdit)} accessibilityRole="button" accessibilityLabel="읽은 쪽수 기록" style={{ alignItems: 'center', marginBottom: 10 }}>
        <Text style={st.page}>{b.currentPage ?? 0}<Text style={st.pageTotal}>  /  {e.pageCount ? `${e.pageCount}쪽` : '전체 쪽수 미입력'}</Text></Text>
      </Pressable>
      {pageEdit ? <TextInput accessibilityLabel="읽은 쪽수" autoFocus defaultValue={b.currentPage ? String(b.currentPage) : ''} placeholder="읽은 쪽수" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" returnKeyType="done" onEndEditing={(ev) => { const n = Number(ev.nativeEvent.text); libraryStore.updateBook(id, { currentPage: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined }); setPageEdit(false); }} style={[st.input, st.pageInput]} /> : null}
      <Muted>{[e.publisher, e.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ')}</Muted>
      <Muted>ISBN {e.isbn13 ?? '미입력'} · {e.pageCount ? `${e.pageCount}쪽` : '쪽수 미입력'}</Muted>
      <Muted>판형 {e.size ? `${e.size.widthMm}×${e.size.heightMm}mm` : '확인 전 · 책장에는 기본 크기로 표시'}</Muted>
      <Muted>{e.source === 'search' ? `도서 정보: ${e.sourceName ?? '검색'}` : e.source === 'photo' ? '사진으로 추가' : '직접 입력'}</Muted>

      <H2>내 기록</H2>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={st.k}>누적 독서 시간</Text>
          <Text style={st.v}>{formatDuration(readMs)}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={st.k}>완독</Text>
          <Text style={st.v}>{done ? `${done}회${done > 1 ? ` (재독 ${done - 1}회)` : ''}` : '아직'}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
          <Text style={st.k}>독서 기록</Text>
          <Pressable onPress={() => router.push({ pathname: '/stats', params: { book: id } })} hitSlop={8} disabled={!sessions}>
            <Text style={[st.v, sessions ? { textDecorationLine: 'underline' } : null]}>{sessions}회</Text>
          </Pressable>
        </Row>
      </Card>

      {rounds.length ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          {rounds.map((r) => (
            <RoundCard key={`${r.id}|${r.startedAt ?? ''}|${r.finishedAt ?? ''}`} idx={r.index} startedAt={r.startedAt} finishedAt={r.finishedAt} paused={r.paused} onSave={(p) => libraryStore.updateRound(r.id, p)} />
          ))}
        </View>
      ) : (
        <Muted style={{ marginTop: 10 }}>읽기 시작하면 회차가 생겨요. 날짜는 나중에 고칠 수 있어요.</Muted>
      )}
      </View> : null}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={st.backdrop} onPress={() => setMenu(false)} accessibilityLabel="닫기" />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <ListItem label="책 정보 수정" onPress={() => { setMenu(false); router.push(`/book/${id}/edit`); }} />
          <ListItem label="장정 편집" onPress={() => { setMenu(false); router.push(`/book/${id}/binding`); }} />
          {onShelf ? (
            <ListItem label="책장 위치로 이동" onPress={() => { setMenu(false); uiBus.focusBook(id); router.dismissTo('/'); }} />
          ) : null}
          {onShelf ? (
            <ListItem label="서랍으로 이동(기록은 그대로)" onPress={() => { setMenu(false); placementStore.toDrawer(id); }} />
          ) : (
            <ListItem
              label={inDrawer ? '책장에 꺼내 놓기' : '책장에 꽂기'}
              onPress={() => {
                setMenu(false);
                if (placementStore.fromDrawer(id) === 'none' && placementStore.addToShelf(id) === 'none') Alert.alert('책장에 빈 자리가 없어요', '선반을 추가하거나 다른 책을 서랍에 넣어 주세요.');
              }}
            />
          )}
          <ListItem label="내 책 삭제" danger onPress={() => { setMenu(false); confirmDelete(); }} />
        </View>
      </Modal>
    </Screen>
  );
}

function RoundCard({ idx, startedAt, finishedAt, paused, onSave }: { idx: number; startedAt?: string; finishedAt?: string; paused?: boolean; onSave: (p: { startedAt?: string; finishedAt?: string }) => void }) {
  const [s, setS] = useState(startedAt ?? '');
  const [f, setF] = useState(finishedAt ?? '');
  const bad = (v: string) => !!v && !DATE.test(v);
  return (
    <Card>
      <Text style={st.k}>
        {idx}회차{idx > 1 ? ' · 재독' : ''}
        {finishedAt ? ' · 완독' : paused ? ' · 보류' : ' · 읽는 중'}
      </Text>
      <Row style={{ marginTop: 8, flexWrap: 'nowrap' }} gap={10}>
        <View style={{ flex: 1 }}>
          <Muted>시작일</Muted>
          <TextInput value={s} onChangeText={setS} placeholder="YYYY-MM-DD" placeholderTextColor={colors.inkFaint} onEndEditing={() => !bad(s) && onSave({ startedAt: s || undefined })} style={[st.input, bad(s) && { borderColor: colors.danger }]} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Muted>완독일</Muted>
          <TextInput value={f} onChangeText={setF} placeholder={finishedAt ? 'YYYY-MM-DD' : '완독하면'} placeholderTextColor={colors.inkFaint} editable={!!finishedAt} onEndEditing={() => !bad(f) && f && onSave({ finishedAt: f })} style={[st.input, bad(f) && { borderColor: colors.danger }, !finishedAt && { opacity: 0.5 }]} keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
    </Card>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 0 },
  title: { fontWeight: '700', fontSize: 26, lineHeight: 36, color: colors.title, textAlign: 'center', marginTop: 4, includeFontPadding: false },
  author: { fontSize: 15.5, lineHeight: 22, color: colors.inkSoft, marginTop: 2, includeFontPadding: false },
  meta: { fontSize: 15, color: colors.inkSoft },
  page: { fontSize: 34, lineHeight: 44, fontWeight: '400', color: colors.ink, includeFontPadding: false },
  pageTotal: { fontSize: 20, fontWeight: '400', color: colors.inkSoft },
  pageInput: { alignSelf: 'stretch', textAlign: 'center', marginBottom: 10 },
  stats: { flexDirection: 'row', marginTop: 22 },
  statCell: { flex: 1, alignItems: 'center', gap: 6, minHeight: 44 },
  statLabel: { fontSize: 14.5, color: colors.inkSoft },
  statValue: { fontWeight: '700', fontSize: 25, color: colors.title, includeFontPadding: false },
  h: { justifyContent: 'space-between', flexWrap: 'nowrap', marginTop: 28, marginBottom: 12 },
  hText: { fontWeight: '700', fontSize: 19, color: colors.title },
  note: { minHeight: 84, borderRadius: 14, backgroundColor: '#F3EEE8', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16, fontSize: 16, lineHeight: 27, color: colors.ink, textAlignVertical: 'top' },
  moreLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  moreText: { fontSize: 15, color: colors.inkSoft },
  recordsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 18 },
  bookmarkButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, marginTop: 4 },
  bookmarkLabel: { fontSize: 14, color: '#80665B', textDecorationLine: 'underline' },
  k: { fontSize: 14, color: colors.inkSoft },
  v: { fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E3D9C9', backgroundColor: ui.card, paddingHorizontal: 12, fontSize: 15, color: colors.ink, marginTop: 4 },
  quote: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 28, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,18,15,0.3)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 8 },
});
