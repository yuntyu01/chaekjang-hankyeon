// 책 상세: 실제 표지·기본 정보 / 이 책 읽기·갈피 남기기·읽기 상태 / 내 기록(회차·별점·감상·누적 시간·갈피·현재 쪽수).
// 날짜·쪽수·별점은 모두 선택 입력. 완독 여부는 사용자가 정한다(타이머로 자동 판정하지 않는다).
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronUp, MoreHorizontal } from '@/ui/icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { STATUS_LABEL, ymd } from '@/features/book/labels';
import { placeWithChoice } from '@/features/book/place-books';
import { ko } from '@/i18n/ko';
import { placementOf } from '@/domain/layout-engine';
import { bookmarksOf, bookReadMs, completions, formatDuration, READ_STATUSES, roundsOf } from '@/domain/library';
import { useLibrary, libraryStore } from '@/store/library-store';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { uiBus } from '@/store/ui-bus';
import { Btn, Chip, Empty, Field, H2, IconButton, ListGroup, ListItem, Muted, Row, Screen, Sheet, Stars, TextLink, s as kit } from '@/ui/kit';
import { colors, fonts, icon, press, shape, tidySpace as space, tidyType as type } from '@/ui/screenTheme';
import { BookVisual, LibraryCover } from '@/ui/BookVisual';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const place = usePlacementStore();
  const [menu, setMenu] = useState(false);
  const [records, setRecords] = useState(false);
  const [pageEdit, setPageEdit] = useState(false);
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  if (!b || !e)
    return (
      <Screen tidy title="책">
        <Empty title="책을 찾을 수 없어요" body="삭제되었거나 예시 책장 책이에요." action="책장으로" onAction={() => router.dismissTo('/')} />
      </Screen>
    );
  const bd = b.bindingId ? lib.bindings[b.bindingId] : undefined;
  const rounds = roundsOf(lib, id);
  const marks = bookmarksOf(lib, id);
  const readMs = bookReadMs(lib, id);
  const sessions = Object.values(lib.sessions).filter((s) => s.myBookId === id).length;
  const onShelf = !!placementOf(place.layout, id);
  const done = completions(lib, id);
  const color = bd?.spineColor ?? '#8A8378';
  const pub = [e.publisher, e.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ');

  const confirmDelete = () => {
    Alert.alert(
      '책을 삭제할까요?',
      `책 정보와 함께 삭제돼요: 독서 회차 ${rounds.length}개, 갈피 ${marks.length}개, 장정.\n독서 시간 기록 ${sessions}개는 ‘책 없음’으로 남아 통계에 계속 포함돼요.\n되돌릴 수 없어요. 책장에서만 치우려면 ‘책장에서 빼기’를 쓰세요(기록은 그대로).`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
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
      tidy
      title="책 정보"
      right={
        <IconButton label="더 보기" onPress={() => setMenu(true)}>
          <MoreHorizontal size={icon.size} color={colors.title} strokeWidth={icon.stroke} />
        </IconButton>
      }>
      <View style={st.hero}>
        {/* 책장에 놓인 모습 그대로(시안 장정·표지 그림 포함). 책장에 없는 책만 서재 기록으로 그린다 */}
        {place.books[id] ? <BookVisual book={place.books[id]} width={194} /> : <LibraryCover lib={lib} id={id} width={194} />}
        <Text style={st.title}>{e.title}</Text>
        {e.authors.length ? <Text style={st.author}>{e.authors.join(', ')}</Text> : null}
      </View>
      <View style={st.progressSection}>
        <Pressable onPress={() => setPageEdit(!pageEdit)} accessibilityRole="button" accessibilityLabel="읽은 쪽수 기록">
          <Text style={st.page}>{b.currentPage ?? 0}<Text style={st.pageTotal}>  /  {e.pageCount ? `${e.pageCount}쪽` : '전체 쪽수 미입력'}</Text></Text>
        </Pressable>
        {pageEdit ? <TextInput accessibilityLabel="읽은 쪽수" autoFocus defaultValue={b.currentPage ? String(b.currentPage) : ''} placeholder="읽은 쪽수" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" returnKeyType="done" onEndEditing={(ev) => { const n = Number(ev.nativeEvent.text); libraryStore.updateBook(id, { currentPage: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined }); setPageEdit(false); }} style={[kit.input, st.pageInput]} /> : null}
        <View style={st.stars}><Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} size={22} /></View>
        {b.note ? <Text style={st.note}>{b.note}</Text> : null}
      </View>
      <View style={st.stats}>
        <Pressable onPress={() => router.push({ pathname: '/stats', params: { book: id } })} accessibilityRole="button" style={st.statCell}>
          <Text style={st.statLabel}>독서 기록</Text><Text style={st.statValue}>{sessions}회</Text>
        </Pressable>
        <View style={st.statDivider} />
        <Pressable onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} accessibilityRole="button" style={st.statCell}>
          <Text style={st.statLabel}>갈피</Text><Text style={st.statValue}>{marks.length}개</Text>
        </Pressable>
      </View>
      <Btn label="이어서 읽기" size="l" onPress={() => router.push({ pathname: '/read', params: { book: id } })} style={st.continueButton} />
      <TextLink label="갈피 남기기" onPress={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} style={st.bookmarkButton} />
      <Pressable onPress={() => setRecords(!records)} accessibilityRole="button" accessibilityState={{ expanded: records }} style={st.recordsToggle}>
        <Text style={type.sub}>내 기록 · 책 정보</Text>
        {records ? <ChevronUp size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} /> : <ChevronDown size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} />}
      </Pressable>
      {records ? (
        <View>
          <View style={{ gap: 4, marginTop: space.item }}>
            {pub ? <Muted>{pub}</Muted> : null}
            <Muted>ISBN {e.isbn13 ?? '미입력'} · {e.pageCount ? `${e.pageCount}쪽` : '쪽수 미입력'}</Muted>
            <Muted>판형 {e.size ? `${e.size.widthMm}×${e.size.heightMm}mm` : '확인 전 · 책장에는 기본 크기로 표시'}</Muted>
            <Muted>{e.source === 'search' ? `도서 정보: ${e.sourceName ?? '검색'}` : e.source === 'photo' ? '사진으로 추가' : '직접 입력'}</Muted>
          </View>

          <H2>읽기 상태</H2>
          <Row>
            {READ_STATUSES.map((s) => (
              <Chip key={s} label={STATUS_LABEL[s]} on={b.status === s} onPress={() => libraryStore.setStatus(id, s)} />
            ))}
          </Row>
          {b.status === 'read' ? <Btn label="다시 읽기 시작(새 회차)" kind="ghost" size="s" onPress={() => libraryStore.reread(id)} style={{ marginTop: space.s, alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}

          <H2>내 기록</H2>
          <ListGroup>
            <ListItem label="누적 독서 시간" value={formatDuration(readMs)} />
            <ListItem label="완독" value={done ? `${done}회${done > 1 ? ` (재독 ${done - 1}회)` : ''}` : '아직'} />
            <ListItem label="독서 기록" value={`${sessions}회`} onPress={sessions ? () => router.push({ pathname: '/stats', params: { book: id } }) : undefined} />
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

          <H2>별점 (선택)</H2>
          <Stars value={b.rating} onChange={(v) => libraryStore.updateBook(id, { rating: v })} size={28} />

          <H2>한 줄 감상 (선택)</H2>
          <TextInput
            accessibilityLabel="한 줄 감상"
            defaultValue={b.note}
            placeholder="이 책은 나에게…"
            placeholderTextColor={colors.inkFaint}
            onEndEditing={(ev) => libraryStore.updateBook(id, { note: ev.nativeEvent.text.trim() || undefined })}
            style={kit.input}
            maxLength={140}
          />

          <H2>남긴 갈피{marks.length ? ` · ${marks.length}` : ''}</H2>
          {marks.length ? (
            <View>
              <ListGroup>
                {marks.slice(0, 5).map((m) => (
                  <Pressable key={m.id} onPress={() => router.push(`/bookmark/${m.id}`)} style={({ pressed }) => [st.mark, pressed && press]} accessibilityRole="button">
                    <View style={[st.markBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={st.quote} numberOfLines={4}>
                        {m.text}
                      </Text>
                      <Text style={[type.caption, { marginTop: space.s }]}>{[m.page ? `${m.page}쪽` : null, ymd(m.createdAt)].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </Pressable>
                ))}
              </ListGroup>
              {marks.length > 5 ? <Btn label={`갈피 ${marks.length}개 모두 보기`} kind="ghost" onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} /> : null}
            </View>
          ) : (
            <Empty title="아직 남긴 갈피가 없어요" action="첫 갈피 남기기" onAction={() => router.push({ pathname: '/bookmark/new', params: { book: id } })} />
          )}
        </View>
      ) : null}

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <ListGroup>
          <ListItem label="책 정보 수정" chevron={false} onPress={() => { setMenu(false); router.push(`/book/${id}/edit`); }} />
          <ListItem label="장정 편집" chevron={false} onPress={() => { setMenu(false); router.push(`/book/${id}/binding`); }} />
          {onShelf ? <ListItem label="책장 위치로 이동" chevron={false} onPress={() => { setMenu(false); uiBus.focusBook(id); router.dismissTo('/'); }} /> : null}
          {/* 책장에서 빼기는 배치만 푼다(책 정보·장정·독서 기록·갈피 그대로). 삭제(빨간 글자)는 책 데이터 자체를 지운다 */}
          {onShelf ? (
            <ListItem label={ko.allBooks.removeFromShelf} sub={ko.allBooks.removeNote} chevron={false} onPress={() => { setMenu(false); if (placementStore.toDrawer(id)) Alert.alert(ko.allBooks.removed); }} />
          ) : (
            <ListItem label={ko.allBooks.place} chevron={false} onPress={() => { setMenu(false); placeWithChoice([id]); }} />
          )}
          <ListItem label="책 삭제" sub="책 정보·장정·독서 회차·갈피를 지워요" danger chevron={false} onPress={() => { setMenu(false); confirmDelete(); }} />
        </ListGroup>
      </Sheet>
    </Screen>
  );
}

// 회차 하나: 위 구분선 + '1회차 · 읽는 중' + 시작일·완독일 입력(형식이 틀리면 저장하지 않고 아래에 안내)
function RoundCard({ idx, startedAt, finishedAt, paused, onSave }: { idx: number; startedAt?: string; finishedAt?: string; paused?: boolean; onSave: (p: { startedAt?: string; finishedAt?: string }) => void }) {
  const [s, setS] = useState(startedAt ?? '');
  const [f, setF] = useState(finishedAt ?? '');
  const bad = (v: string) => !!v && !DATE.test(v);
  return (
    <View style={st.round}>
      <Text style={type.rowStrong}>
        {idx}회차{idx > 1 ? ' · 재독' : ''}
        <Text style={type.sub}>{finishedAt ? '   완독' : paused ? '   보류' : '   읽는 중'}</Text>
      </Text>
      <Row style={{ marginTop: space.m, flexWrap: 'nowrap', alignItems: 'flex-start' }} gap={space.m}>
        <View style={{ flex: 1 }}>
          <Field label="시작일" value={s} onChangeText={setS} placeholder="YYYY-MM-DD" onEndEditing={() => !bad(s) && onSave({ startedAt: s || undefined })} error={bad(s) ? 'YYYY-MM-DD로 적어 주세요' : undefined} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="완독일" value={f} onChangeText={setF} placeholder={finishedAt ? 'YYYY-MM-DD' : '완독하면'} editable={!!finishedAt} onEndEditing={() => !bad(f) && f && onSave({ finishedAt: f })} error={bad(f) ? 'YYYY-MM-DD로 적어 주세요' : undefined} keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
    </View>
  );
}

// 정돈 변형: 책(그림·제목·저자)이 먼저, 그다음 진행(쪽·별점), 기록 요약, 주요 행동 '이어서 읽기'.
// 제목과 저자는 붙이고(4), 역할이 바뀌는 묶음 사이는 32. 책 제목은 Medium(굵게 키우지 않는다)
const st = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: space.xxl },
  title: { fontFamily: fonts.uiMedium, fontSize: 22, lineHeight: 30, color: colors.ink, textAlign: 'center', marginTop: space.xl, includeFontPadding: false },
  author: { ...type.sub, fontSize: 16, lineHeight: 22, marginTop: space.xs, textAlign: 'center' },
  progressSection: { marginTop: space.xxl, alignItems: 'center' },
  page: { fontFamily: fonts.ui, fontSize: 36, lineHeight: 44, color: colors.ink, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  pageTotal: { fontFamily: fonts.ui, fontSize: 20, color: colors.inkSoft },
  pageInput: { alignSelf: 'stretch', textAlign: 'center', marginTop: space.s },
  stars: { marginTop: space.s },
  note: { ...type.sub, marginTop: space.s, textAlign: 'center' },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: space.xxl },
  statCell: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: space.s, minHeight: space.touch, paddingVertical: space.s },
  statLabel: type.row,
  statValue: type.sub,
  statDivider: { width: shape.hairline * 2, height: 24, backgroundColor: colors.line },
  continueButton: { marginTop: space.xl },
  bookmarkButton: { marginTop: space.xs },
  recordsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: space.touch, marginTop: space.s },
  round: { paddingTop: space.xl, marginTop: space.s, borderTopWidth: shape.hairline, borderTopColor: colors.line },
  mark: { flexDirection: 'row', gap: space.m, paddingVertical: space.l },
  markBar: { width: 3, borderRadius: 2 },
  quote: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 27, color: colors.ink },
});
