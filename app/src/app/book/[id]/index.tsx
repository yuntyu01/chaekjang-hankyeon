// 책 상세(2026-11-05 사용자 '표지 위 가운데 박스에 책 정보·평가·내 기록 3개'): 칸마다 책 정보 / 별점·한 줄 감상·독자 후기 / 내 독서·읽기 상태·회차·갈피. 이어서 읽기와 갈피 남기기는 아래에 늘 보인다.
// 날짜·쪽수·별점은 모두 선택 입력. 완독 여부는 사용자가 정한다(타이머로 자동 판정하지 않는다).
import { router, useLocalSearchParams } from 'expo-router';
import { MoreHorizontal, Share } from '@/ui/icons';
import { useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ReaderRating, ReviewsPane, useBookReviews } from '@/features/community/BookReviews';
import { RibbonColorSheet } from '@/features/bookmark/RibbonColorSheet';
import { STATUS_LABEL, ymd } from '@/features/book/labels';
import { placeWithChoice } from '@/features/book/place-books';
import { ko } from '@/i18n/ko';
import { archivedYearsOf } from '@/domain/bookcase';
import { placementOf } from '@/domain/layout-engine';
import { paperColors } from '@/domain/color';
import { bookmarksOf, bookReadMs, completions, formatDuration, isDay, memoShelfBook, READ_STATUSES, roundsOf } from '@/domain/library';
import { useBookcases } from '@/store/bookcase-store';
import { HIDDEN_WHERE } from '@/features/book/DeleteBooksSheet';
import { useLibrary, libraryStore } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Chip, Divider, Empty, Field, H2, IconButton, ListGroup, ListItem, Muted, Row, Screen, SectionBand, Segmented, Sheet, Stars, s as kit } from '@/ui/kit';
import { colors, fonts, icon, press, shape, space, type } from '@/ui/theme';
import { BookVisual, LibraryCover } from '@/ui/BookVisual';
import { appAlert } from '@/ui/alert';

const VIEW_TABS = [{ id: 'info', label: '책 정보' }, { id: 'rate', label: '평가' }, { id: 'mine', label: '내 기록' }] as const;

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const bookcases = useBookcases();
  const [menu, setMenu] = useState(false);
  const [pageEdit, setPageEdit] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [tab, setTab] = useState<'info' | 'rate' | 'mine'>('info');
  // 한 줄 감상은 적는 대로 잠깐 뒤 저장한다(입력 중에 칸을 바꾸거나 화면을 떠나도 남게)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  // 독자 후기: ISBN이 있고 커뮤니티를 쓸 수 있을 때만 평가 칸 아래에 보인다
  const reviews = useBookReviews(e?.isbn13);
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
  const done = completions(lib, id);
  const pub = [e.publisher, e.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ');

  // 같은 상태는 그대로. 완독한 책을 '읽는 중'·'보류'로 바꾸면 새 회차(다시 읽기)라 먼저 묻는다(재독은 책 재등록이 아니다)
  const lastRound = rounds.at(-1);
  const chooseStatus = (s: (typeof READ_STATUSES)[number]) => {
    if (s === b.status) return;
    if ((s === 'reading' || s === 'paused') && lastRound?.finishedAt) {
      appAlert('다시 읽기를 시작할까요?', `${lastRound.index + 1}회차가 생기고 진도는 0쪽부터예요. 지난 회차의 완독일·독서 기록·갈피는 그대로 남아요.`, [
        { text: '취소', style: 'cancel' },
        { text: '다시 읽기', onPress: () => { libraryStore.reread(id); if (s === 'paused') libraryStore.setStatus(id, 'paused'); } },
      ]);
      return;
    }
    libraryStore.setStatus(id, s);
  };

  // 연도 책장에 있는 책은 지우지 않고 숨긴다(library-store deleteBook, 2026-11-06 사용자 '삭제 말고 숨기기로')
  const hideYears = archivedYearsOf(bookcases, id);
  const confirmDelete = () => {
    const hide = hideYears.length > 0;
    appAlert(
      hide ? '책을 숨길까요?' : '책을 삭제할까요?',
      hide
        ? `지금 서재와 책장에서는 빠지고, ${hideYears.join('·')}년 책장에는 갈피·기록과 함께 그대로 남아요.\n${HIDDEN_WHERE}`
        : `책 정보와 함께 삭제돼요: 독서 회차 ${rounds.length}개, 갈피 ${marks.length}개, 장정.\n독서 시간 기록 ${sessions}개는 ‘책 없음’으로 남아 통계에 계속 포함돼요.\n되돌릴 수 없어요. 책장에서만 치우려면 ‘책장에서 빼기’를 쓰세요(기록은 그대로).`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: hide ? '숨기기' : '삭제',
          style: hide ? 'default' : 'destructive',
          onPress: () => {
            libraryStore.deleteBook(id);
            router.dismissTo('/');
          },
        },
      ],
    );
  };

  return (
    <Screen
      compact
      right={
        <View style={{ flexDirection: 'row' }}>
          {/* 책 공유(2026-11-09 사용자): 카드 이미지로 한 줄 감상·별점과 함께 */}
          <IconButton label="책 공유" onPress={() => router.push(`/book/${id}/share`)}>
            <Share size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
          <IconButton label="더 보기" onPress={() => setMenu(true)}>
            <MoreHorizontal size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />
          </IconButton>
        </View>
      }
      footer={
        <View style={st.actions}>
          <Btn label="갈피 남기기" kind="secondary" size="l" onPress={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} style={{ flex: 1 }} />
           <Btn label={b.status === 'reading' || b.status === 'paused' ? '이어서 읽기' : b.status === 'read' ? '다시 읽기' : '읽기 시작'} size="l" onPress={() => router.dismissTo({ pathname: '/read', params: { book: id } })} style={{ flex: 1 }} />
        </View>
      }>
      <Segmented items={VIEW_TABS} value={tab} onChange={setTab} style={st.tabs} />
      <View style={st.hero}>
        {/* 책장에 놓인 모습 그대로(시안 장정·표지 그림 포함). 책장에 없는 책만 서재 기록으로 그린다 */}
        {place.books[id] ? <BookVisual book={place.books[id]} width={170} /> : <LibraryCover lib={lib} id={id} width={170} />}
        <Text style={st.title}>{e.title}</Text>
        {e.authors.length ? <Text style={st.author}>{e.authors.join(', ')}</Text> : null}
        <ReaderRating data={reviews.data} />
      </View>

      {tab === 'info' ? (
        <ListGroup style={st.pane}>
          <ListItem label="출판" value={pub || '미입력'} />
          <ListItem label="ISBN" value={e.isbn13 ?? '미입력'} />
          <ListItem label="쪽수" value={e.pageCount ? `${e.pageCount}쪽` : '미입력'} />
          <ListItem label="판형" value={e.size ? `${e.size.widthMm}×${e.size.heightMm}mm` : '확인 전'} sub={e.size ? undefined : '책장에는 기본 크기로 표시해요'} />
          <ListItem label="도서 정보" value={e.source === 'search' ? e.sourceName ?? '검색' : e.source === 'photo' ? '사진으로 추가' : '직접 입력'} />
          <ListItem label="갈피 색" sub={b.ribbonColor ? '직접 고른 색' : '표지에서 고른 색'} onPress={() => setColorOpen(true)} right={<View style={[st.ribbonDot, { backgroundColor: paperColors(memoShelfBook(lib, id)?.art.ribbon, id).tape }]} />} />
          {/* 판매 페이지는 맨 아래(2026-11-05 사용자 '맨 밑에 YES24에서 사는 거'). YES24 약관: 출처와 상품 링크를 함께 보인다 */}
          {e.link ? <ListItem label={`${e.sourceName ?? '판매처'}에서 보기`} onPress={() => void Linking.openURL(e.link!)} /> : null}
        </ListGroup>
      ) : null}

      {tab === 'rate' ? (
        <View style={st.pane}>
          {/* 내 평가: 별점과 한 줄 감상을 선으로 나눈다(2026-11-05 사용자 '입력 박스를 만들고 위와 선으로 구분'). 나만 보는 기록 */}
          <View style={st.rateRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={type.section} accessibilityRole="header">내 평가</Text>
              <Text style={[type.caption, { marginTop: 2 }]}>나만 보는 평가예요</Text>
            </View>
            <Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} size={24} />
          </View>
          <Divider style={st.rateLine} />
          <Text style={[type.label, { marginBottom: space.s }]}>한 줄 감상</Text>
          <TextInput
            accessibilityLabel="한 줄 감상"
            defaultValue={b.note}
            placeholder="이 책은 나에게…"
            placeholderTextColor={colors.inkFaint}
            onChangeText={(t) => {
              if (noteTimer.current) clearTimeout(noteTimer.current);
              noteTimer.current = setTimeout(() => libraryStore.updateBook(id, { note: t.trim() || undefined }), 600);
            }}
            onEndEditing={(ev) => {
              if (noteTimer.current) clearTimeout(noteTimer.current);
              libraryStore.updateBook(id, { note: ev.nativeEvent.text.trim() || undefined });
            }}
            style={kit.input}
            maxLength={140}
          />
          {reviews.available ? (
            <>
              <SectionBand />
              <ReviewsPane isbn13={e.isbn13!} title={e.title} myRating={b.rating} state={reviews} />
            </>
          ) : null}
        </View>
      ) : null}

      {tab === 'mine' ? (
        <View style={st.pane}>
          {/* 내 독서(2026-11): 읽기 상태·현재 쪽(전체 쪽수를 알 때만 진행 막대)·독서 기록·갈피를 한 묶음으로. 모르는 값은 계산하지 않는다 */}
          <View style={st.myHead}>
            <Text style={type.section} accessibilityRole="header">내 독서</Text>
            <Text style={type.caption}>{[STATUS_LABEL[b.status], done ? `완독 ${done}회` : null].filter(Boolean).join(' · ')}</Text>
          </View>
          <Pressable onPress={() => setPageEdit(!pageEdit)} accessibilityRole="button" accessibilityLabel={`현재 쪽 ${b.currentPage ?? 0}${e.pageCount ? ` / ${e.pageCount}쪽` : '쪽'}, 눌러서 고치기`} style={st.pageRow}>
            <Text style={st.page}>{b.currentPage ?? 0}<Text style={st.pageTotal}>{e.pageCount ? `  /  ${e.pageCount}쪽` : '쪽'}</Text></Text>
            {!e.pageCount ? <Text style={type.caption}>전체 쪽수 미입력</Text> : null}
          </Pressable>
          {e.pageCount ? (
            <View style={st.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[st.barFill, { width: `${Math.min(100, ((b.currentPage ?? 0) / e.pageCount) * 100)}%` }]} />
            </View>
          ) : null}
          {pageEdit ? <TextInput accessibilityLabel="읽은 쪽수" autoFocus defaultValue={b.currentPage ? String(b.currentPage) : ''} placeholder="읽은 쪽수" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" returnKeyType="done" onEndEditing={(ev) => { const n = Number(ev.nativeEvent.text); libraryStore.updateBook(id, { currentPage: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined }); setPageEdit(false); }} style={[kit.input, st.pageInput]} /> : null}

          <H2>읽기 상태</H2>
          <Row>
            {READ_STATUSES.map((s) => (
              <Chip key={s} label={STATUS_LABEL[s]} on={b.status === s} onPress={() => chooseStatus(s)} />
            ))}
          </Row>
          {b.status === 'read' ? (
            <Row style={{ marginTop: space.s }} gap={space.l}>
              <Btn label="완독 카드 공유" kind="ghost" size="s" onPress={() => router.push(`/book/${id}/share`)} style={{ paddingHorizontal: 0 }} />
              <Btn label="다시 읽기 시작(새 회차)" kind="ghost" size="s" onPress={() => chooseStatus('reading')} style={{ paddingHorizontal: 0 }} />
            </Row>
          ) : null}

          <H2>내 기록</H2>
          <ListGroup>
            <ListItem label="누적 독서 시간" value={formatDuration(readMs)} />
            <ListItem label="완독" value={done ? `${done}회${done > 1 ? ` (재독 ${done - 1}회)` : ''}` : '아직'} />
            <ListItem label="독서 기록" value={`${sessions}회`} onPress={sessions ? () => router.push(`/book/${id}/stats`) : undefined} />
          </ListGroup>

          {rounds.length ? (
            <View style={{ marginTop: space.s }}>
              {rounds.map((r) => (
                <RoundCard key={`${r.id}|${r.startedAt ?? ''}|${r.finishedAt ?? ''}`} idx={r.index} startedAt={r.startedAt} finishedAt={r.finishedAt} paused={r.paused} onSave={(p) => libraryStore.updateRound(r.id, p)} />
              ))}
            </View>
          ) : (
            <Muted style={{ marginTop: space.item }}>읽기 시작하면 회차가 생겨요. 날짜는 나중에 고칠 수 있어요.</Muted>
          )}

          <H2>남긴 갈피{marks.length ? ` · ${marks.length}` : ''}</H2>
          {marks.length ? (
            <View>
              <ListGroup>
                {marks.slice(0, 5).map((m) => (
                  <Pressable key={m.id} onPress={() => router.push(`/bookmark/${m.id}`)} style={({ pressed }) => [st.mark, pressed && press]} accessibilityRole="button">
                    {m.photoUri ? <Image source={{ uri: m.photoUri }} style={st.markPhoto} accessibilityLabel="갈피 사진" /> : null}
                    <View style={{ flex: 1 }}>
                      {/* 사진만 남긴 갈피는 글이 없다: '사진 갈피'로 보인다(문장으로 세지 않는다) */}
                      {m.text.trim() ? (
                        <Text style={st.quote} numberOfLines={4}>
                          {m.text}
                        </Text>
                      ) : (
                        <Text style={type.row}>사진 갈피</Text>
                      )}
                      <Text style={[type.caption, { marginTop: space.s }]}>{[m.page ? `${m.page}쪽` : null, ymd(m.createdAt)].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </Pressable>
                ))}
              </ListGroup>
              <Btn label="갈피 보드로 보기" kind="secondary" onPress={() => router.push(`/bookmark/board/${id}`)} style={{ marginTop: space.m }} />
              {marks.length > 5 ? <Btn label={`갈피 ${marks.length}개 모두 보기`} kind="ghost" onPress={() => router.dismissTo({ pathname: '/bookmarks', params: { book: id } })} /> : null}
            </View>
          ) : (
            <Empty title="아직 남긴 갈피가 없어요" action="첫 갈피 남기기" actionKind="secondary" onAction={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} />
          )}
        </View>
      ) : null}

      <RibbonColorSheet bookId={id} visible={colorOpen} onClose={() => setColorOpen(false)} />
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <ListGroup>
          <ListItem label="이미지로 공유" sub="한 줄 감상·별점을 넣은 카드" chevron={false} onPress={() => { setMenu(false); router.push(`/book/${id}/share`); }} />
          <ListItem label="책 정보 수정" chevron={false} onPress={() => { setMenu(false); router.push(`/book/${id}/edit`); }} />
          <ListItem label="장정 편집" chevron={false} onPress={() => { setMenu(false); router.push(`/book/${id}/binding`); }} />
          {onShelf ? <ListItem label="책장 위치로 이동" chevron={false} onPress={() => { setMenu(false); uiBus.focusBook(id); router.dismissTo('/'); }} /> : null}
          {/* 책장에서 빼기는 배치만 푼다(책 정보·장정·독서 기록·갈피 그대로). 삭제(빨간 글자)는 책 데이터 자체를 지운다. 연도 책장에 있는 책은 숨기기 */}
          {onShelf ? (
            <ListItem label={ko.allBooks.removeFromShelf} sub={ko.allBooks.removeNote} chevron={false} onPress={() => { setMenu(false); if (placementStore.toDrawer(id)) appAlert(ko.allBooks.removed); }} />
          ) : (
            <ListItem label={ko.allBooks.place} chevron={false} onPress={() => { setMenu(false); placeWithChoice([id]); }} />
          )}
          {hideYears.length ? (
            <ListItem label="책 숨기기" sub={`지금 서재에서 빼요. ${hideYears.join('·')}년 책장에는 남아요`} chevron={false} onPress={() => { setMenu(false); confirmDelete(); }} />
          ) : (
            <ListItem label="책 삭제" sub="책 정보·장정·독서 회차·갈피를 지워요" danger chevron={false} onPress={() => { setMenu(false); confirmDelete(); }} />
          )}
        </ListGroup>
      </Sheet>
    </Screen>
  );
}

// 회차 하나: 위 구분선 + '1회차 · 읽는 중' + 시작일·완독일 입력(형식이 틀리면 저장하지 않고 아래에 안내)
function RoundCard({ idx, startedAt, finishedAt, paused, onSave }: { idx: number; startedAt?: string; finishedAt?: string; paused?: boolean; onSave: (p: { startedAt?: string; finishedAt?: string }) => void }) {
  const [s, setS] = useState(startedAt ?? '');
  const [f, setF] = useState(finishedAt ?? '');
  // 달력에 있는 날짜만, 완독일은 시작일 이후만 저장한다(잘못된 값이 올라가면 서버가 거부해 동기화가 통째로 막힌다)
  const bad = (v: string) => !!v && !isDay(v);
  const reversed = !!s && !!f && !bad(s) && !bad(f) && f < s;
  return (
    <View style={st.round}>
      <Text style={type.rowStrong}>
        {idx}회차{idx > 1 ? ' · 재독' : ''}
        <Text style={type.sub}>{finishedAt ? '   완독' : paused ? '   보류' : '   읽는 중'}</Text>
      </Text>
      <Row style={{ marginTop: space.m, flexWrap: 'nowrap', alignItems: 'flex-start' }} gap={space.m}>
        <View style={{ flex: 1 }}>
          <Field label="시작일" value={s} onChangeText={setS} placeholder="YYYY-MM-DD" onEndEditing={() => !bad(s) && !reversed && onSave({ startedAt: s || undefined })} error={bad(s) ? '있는 날짜를 YYYY-MM-DD로 적어 주세요' : undefined} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="완독일" value={f} onChangeText={setF} placeholder={finishedAt ? 'YYYY-MM-DD' : '완독하면'} editable={!!finishedAt} onEndEditing={() => !bad(f) && !reversed && f && onSave({ finishedAt: f })} error={bad(f) ? '있는 날짜를 YYYY-MM-DD로 적어 주세요' : reversed ? '시작일 이후로 적어 주세요' : undefined} keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
    </View>
  );
}

// 정돈 변형: 책(그림·제목·저자)이 먼저, 그다음 진행(쪽·별점), 기록 요약, 주요 행동 '이어서 읽기'.
// 제목과 저자는 붙이고(4), 역할이 바뀌는 묶음 사이는 32. 책 제목은 Medium(굵게 키우지 않는다)
const st = StyleSheet.create({
  // 표지 위 가운데 박스(2026-11-05 사용자)
  tabs: { alignSelf: 'center', width: 300, maxWidth: '100%', marginTop: space.xs },
  hero: { alignItems: 'center', paddingTop: space.xl },
  title: { fontFamily: fonts.uiTitle, fontSize: 24, lineHeight: 32, color: colors.ink, textAlign: 'center', marginTop: space.l, includeFontPadding: false },
  author: { ...type.sub, fontSize: 16, lineHeight: 22, marginTop: space.xs, textAlign: 'center' },
  pane: { marginTop: space.xl },
  actions: { flexDirection: 'row', gap: space.s },
  ribbonDot: { width: 28, height: 28, borderRadius: 14, borderWidth: shape.hairline * 2, borderColor: colors.line },
  myHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  pageRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.s, minHeight: space.touch },
  page: { fontFamily: fonts.ui, fontSize: 32, lineHeight: 40, color: colors.ink, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  pageTotal: { fontFamily: fonts.ui, fontSize: 18, color: colors.inkSoft },
  // 쪽수 진행 막대: 8 두께(2026-11-01 사용자 '좀 더 두껍게'), 끝은 둥글게
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.line, marginTop: space.m, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  pageInput: { alignSelf: 'stretch', textAlign: 'center', marginTop: space.s },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: space.touch },
  rateLine: { marginVertical: space.l },
  round: { paddingTop: space.xl, marginTop: space.s, borderTopWidth: shape.hairline, borderTopColor: colors.line },
  mark: { flexDirection: 'row', gap: space.m, paddingVertical: space.l },
  quote: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 27, color: colors.ink },
  markPhoto: { width: 48, height: 64, borderRadius: 3, backgroundColor: colors.surface },
});
