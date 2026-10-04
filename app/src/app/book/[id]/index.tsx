// 책 상세: 실제 표지·기본 정보 / 이 책 읽기·갈피 남기기·읽기 상태 / 내 기록(회차·별점·감상·누적 시간·갈피·현재 쪽수).
// 날짜·쪽수·별점은 모두 선택 입력. 완독 여부는 사용자가 정한다(타이머로 자동 판정하지 않는다).
import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Bookmark, MoreHorizontal, ChevronRight, ChevronDown } from '@/ui/icons';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STATUS_LABEL, ymd } from '@/features/book/labels';
import { placementOf } from '@/domain/layout-engine';
import { bookmarksOf, bookReadMs, completions, formatDuration, READ_STATUSES, roundsOf } from '@/domain/library';
import { useLibrary, libraryStore } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { dropImage } from '@/store/files';
import { Btn, Card, Chip, Empty, H2, ListItem, Muted, RealCover, Row, Screen, Stars, ui } from '@/ui/kit';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { LibraryCover } from '@/ui/BookVisual';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [menu, setMenu] = useState(false);
  const [records, setRecords] = useState(false);
  const [pageEdit, setPageEdit] = useState(false);
  const [statusEdit, setStatusEdit] = useState(false);
  const insets = useSafeAreaInsets();
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  if (!b || !e)
    return (
      <Screen title="책">
        <Empty title="책을 찾을 수 없어요" body="삭제되었거나 예시 책장 책이에요." action="책장으로" onAction={() => router.dismissTo('/')} />
      </Screen>
    );
  const bd = b.bindingId ? lib.bindings[b.bindingId] : undefined;
  const rounds = roundsOf(lib, id);
  const marks = bookmarksOf(lib, id);
  const readMs = bookReadMs(lib, id);
  const sessions = Object.values(lib.sessions).filter((s) => s.myBookId === id).length;
  const onShelf = !!placementOf(place.layout, id);
  const inDrawer = place.layout.drawer.includes(id);
  const done = completions(lib, id);
  const color = bd?.spineColor ?? '#8A8378';

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
      right={
        <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="더 보기">
          <MoreHorizontal size={24} color={colors.ink} strokeWidth={1.6} />
        </Pressable>
      }>
      <View style={st.hero}>
        <LibraryCover lib={lib} id={id} width={194} />
        <Text style={st.title}>{e.title}</Text>
        {e.authors.length ? <Text style={st.author}>{e.authors.join(', ')}</Text> : null}
        <Pressable onPress={() => setStatusEdit(!statusEdit)} accessibilityRole="button" accessibilityLabel="읽기 상태 변경" style={st.statusBadge}>
          <Text style={st.statusText}>{STATUS_LABEL[b.status]}</Text>
        </Pressable>
      </View>
      {statusEdit ? <Row style={{ justifyContent: 'center', marginBottom: 18 }}>{READ_STATUSES.map((s) => <Chip key={s} label={STATUS_LABEL[s]} on={b.status === s} onPress={() => { libraryStore.setStatus(id, s); setStatusEdit(false); }} />)}</Row> : null}
      <View style={st.progressSection}>
        <Text style={st.progressLabel}>읽던 곳</Text>
        <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={st.page}>{b.currentPage ?? 0}<Text style={st.pageTotal}> / {e.pageCount ? `${e.pageCount}쪽` : '전체 쪽수 미입력'}</Text></Text>
          {e.pageCount ? <Text style={st.meta}>{Math.min(100, Math.round((b.currentPage ?? 0) / e.pageCount * 100))}%</Text> : null}
        </Row>
        <View style={st.track}><View style={[st.fill, { width: `${e.pageCount ? Math.min(100, (b.currentPage ?? 0) / e.pageCount * 100) : 0}%` }]} /></View>
        <Pressable onPress={() => setPageEdit(!pageEdit)} accessibilityRole="button" style={st.pageEdit}><Text style={[st.meta, { textDecorationLine: 'underline', color: '#896E62' }]}>쪽수 기록</Text><ChevronRight size={17} color={colors.inkSoft} /></Pressable>
        {pageEdit ? <TextInput accessibilityLabel="읽은 쪽수" autoFocus defaultValue={b.currentPage ? String(b.currentPage) : ''} placeholder="읽은 쪽수" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" returnKeyType="done" onEndEditing={(ev) => { const n = Number(ev.nativeEvent.text); libraryStore.updateBook(id, { currentPage: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined }); setPageEdit(false); }} style={st.input} /> : null}
      </View>
      <View style={st.links}>
        <Pressable onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} accessibilityRole="button" style={st.linkRow}>
          <Bookmark size={22} color={colors.ink} strokeWidth={1.5} /><Text style={st.linkLabel}>갈피</Text><Text style={st.meta}>{marks.length}개</Text><ChevronRight size={20} color={colors.inkSoft} />
        </Pressable>
        <View style={st.divider} />
        <Pressable onPress={() => router.push({ pathname: '/stats', params: { book: id } })} accessibilityRole="button" style={st.linkRow}>
          <FileText size={22} color={colors.ink} strokeWidth={1.5} /><Text style={st.linkLabel}>독서 기록</Text><Text style={st.meta}>{sessions}회</Text><ChevronRight size={20} color={colors.inkSoft} />
        </Pressable>
      </View>
      <Btn label="이어서 읽기" onPress={() => router.push({ pathname: '/read', params: { book: id } })} style={st.continueButton} />
      <Pressable onPress={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} accessibilityRole="button" style={st.bookmarkButton}><Text style={st.bookmarkLabel}>갈피 남기기</Text></Pressable>
      <Pressable onPress={() => setRecords(!records)} accessibilityRole="button" accessibilityState={{ expanded: records }} style={[st.linkRow, { justifyContent: 'center', marginTop: 18 }]}><Text style={st.meta}>내 기록 · 책 정보</Text><ChevronDown size={16} color={colors.inkSoft} /></Pressable>
      {records ? <View>
      <Muted>{[e.publisher, e.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ')}</Muted>
      <Muted>ISBN {e.isbn13 ?? '미입력'} · {e.pageCount ? `${e.pageCount}쪽` : '쪽수 미입력'}</Muted>
      <Muted>판형 {e.size ? `${e.size.widthMm}×${e.size.heightMm}mm` : '확인 전 · 책장에는 기본 크기로 표시'}</Muted>
      <Muted>{e.source === 'search' ? `도서 정보: ${e.sourceName ?? '검색'}` : e.source === 'photo' ? '사진으로 추가' : '직접 입력'}</Muted>
      <H2>읽기 상태</H2>
      <Row>
        {READ_STATUSES.map((s) => (
          <Chip key={s} label={STATUS_LABEL[s]} on={b.status === s} onPress={() => libraryStore.setStatus(id, s)} />
        ))}
      </Row>
      {b.status === 'read' ? <Btn label="다시 읽기 시작(새 회차)" kind="ghost" onPress={() => libraryStore.reread(id)} style={{ marginTop: 6, alignSelf: 'flex-start' }} /> : null}

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

      <H2>별점 (선택)</H2>
      <Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} />

      <H2>한 줄 감상 (선택)</H2>
      <TextInput
        defaultValue={b.note}
        placeholder="이 책은 나에게…"
        placeholderTextColor={colors.inkFaint}
        onEndEditing={(ev) => libraryStore.updateBook(id, { note: ev.nativeEvent.text.trim() || undefined })}
        style={st.input}
        maxLength={140}
      />

      <H2>남긴 갈피 {marks.length ? `· ${marks.length}` : ''}</H2>
      {marks.length ? (
        <View style={{ gap: 10 }}>
          {marks.slice(0, 5).map((m) => (
            <Card key={m.id} stripe={color} onPress={() => router.push(`/bookmark/${m.id}`)}>
              <Text style={st.quote} numberOfLines={4}>
                {m.text}
              </Text>
              <Muted style={{ marginTop: 6 }}>{[m.page ? `${m.page}쪽` : null, ymd(m.createdAt)].filter(Boolean).join(' · ')}</Muted>
            </Card>
          ))}
          {marks.length > 5 ? <Btn label={`갈피 ${marks.length}개 모두 보기`} kind="ghost" onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} /> : null}
        </View>
      ) : (
        <Empty title="아직 남긴 갈피가 없어요" action="첫 갈피 남기기" onAction={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} />
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
  hero: { alignItems: 'center', paddingTop: 27.5 },
  title: { fontFamily: fonts.serifBold, fontSize: 26, lineHeight: 38, color: colors.ink, textAlign: 'center', marginTop: 15, includeFontPadding: false },
  author: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 26, color: colors.inkSoft, marginTop: 1, includeFontPadding: false },
  meta: { fontSize: 15, color: colors.inkSoft },
  statusBadge: { borderRadius: 16, paddingHorizontal: 17, paddingVertical: 4, marginTop: 7, backgroundColor: screenTheme.blueLight },
  statusText: { fontSize: 13, lineHeight: 18, color: '#668AA7', includeFontPadding: false },
  progressSection: { marginTop: 11.5, paddingHorizontal: 10 },
  progressLabel: { fontFamily: fonts.serif, fontSize: 14, color: '#74695F', marginBottom: 0, includeFontPadding: false },
  page: { fontFamily: fonts.serifMedium, fontSize: 22, lineHeight: 30, color: colors.ink, includeFontPadding: false },
  pageTotal: { fontFamily: fonts.serif, fontSize: 17, color: colors.inkSoft },
  track: { height: 10, borderRadius: 5, backgroundColor: '#EEE7DF', marginTop: 8, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: screenTheme.blue, borderTopWidth: 0.5, borderTopColor: '#A6BBCB' },
  pageEdit: { alignSelf: 'flex-end', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3 },
  links: { borderWidth: 0.8, borderColor: '#E6DDD3', borderRadius: 15, paddingHorizontal: 15, marginTop: 6, backgroundColor: 'rgba(255,253,248,0.18)' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 59, paddingVertical: 14 },
  linkLabel: { flex: 1, color: colors.ink, fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: screenTheme.border },
  continueButton: { marginTop: 19, minHeight: 58, borderRadius: 14, borderTopColor: '#A18579', borderBottomColor: '#765A54', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 1, color: 'rgba(83,61,49,0.05)' }] },
  bookmarkButton: { alignItems: 'center', justifyContent: 'center', minHeight: 54, marginTop: 5 },
  bookmarkLabel: { fontSize: 13.5, color: '#80665B', textDecorationLine: 'underline' },
  k: { fontSize: 14, color: colors.inkSoft },
  v: { fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E3D9C9', backgroundColor: ui.card, paddingHorizontal: 12, fontSize: 15, color: colors.ink, marginTop: 4 },
  quote: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 26, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,18,15,0.3)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 8 },
});
