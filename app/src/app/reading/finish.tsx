// 독서 종료 기록: 연결된 책(바꾸거나 연결하기), 실제 독서 시간, 선택 입력(시작 쪽·도달한 쪽·짧은 메모) → 개인 기록 저장(기본) 또는 버리기.
// 적는 중인 쪽수·메모는 종료 초안에 함께 저장돼 앱이 꺼져도 이어서 쓴다(reading-store notes).
// 분량은 시작 쪽과 도달한 쪽을 둘 다 알 때만 보인다(모르면 비워 둔다). 완독 여부는 여기서 자동으로 정하지 않는다.
// 저장 후: 이 책에 갈피 남기기(이번 기록과 연결) · 커뮤니티에 공유하기(고른 것만, 선택) · 책 정보 · 내 기록 · 닫기.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { hm } from '@/features/book/labels';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { formatDuration, formatDurationPrecise } from '@/domain/library';
import { ambient } from '@/services/ambient';
import { saveFinishedReading } from '@/store/finish-reading';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { Btn, Empty, Field, Muted, Row, Screen, SelectField } from '@/ui/kit';
import { colors, fonts, shape, tidySpace as space, tidyType as type } from '@/ui/screenTheme';
import { serverBase } from '@/services/sync';

const page = (v?: string) => {
  const n = Number((v ?? '').replace(/[^\d]/g, ''));
  return v && v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export default function Finish() {
  const { pending, error: readingError } = useReading();
  const { lib } = useLibrary();
  const [picking, setPicking] = useState(false);
  const notes = pending?.notes;
  const [startPage, setStartPage] = useState(notes?.startPage ?? (pending?.startPage ? String(pending.startPage) : ''));
  const [pages, setPages] = useState(notes?.pages ?? '');
  const [memo, setMemo] = useState(notes?.memo ?? '');
  const [saved, setSaved] = useState<{ bookId?: string; sessionId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const leaving = useRef(false);

  // 적는 중인 값을 초안에 남긴다(잠깐 멈춘 뒤 한 번)
  useEffect(() => {
    if (!pending || saved) return;
    const t = setTimeout(() => readingStore.setPendingNotes({ startPage, pages, memo }), 400);
    return () => clearTimeout(t);
  }, [startPage, pages, memo, pending, saved]);
  // 책을 바꾸면 시작 쪽 기본값도 그 책의 지금 쪽으로
  const lastBook = useRef(pending?.myBookId);
  useEffect(() => {
    if (!pending || pending.myBookId === lastBook.current) return;
    lastBook.current = pending.myBookId;
    setStartPage(pending.startPage ? String(pending.startPage) : '');
  }, [pending]);

  if (saved)
    return (
      <Screen tidy title="저장했어요" back={false}>
        <Text style={[type.body, { marginTop: space.m }]}>독서 기록을 저장했어요.</Text>
        <View style={{ gap: space.s, marginTop: space.xl }}>
          {saved.bookId ? <Btn label="이 책에 갈피 남기기" onPress={() => router.replace({ pathname: '/bookmark/new', params: { book: saved.bookId, session: saved.sessionId } })} /> : null}
          {saved.bookId && serverBase ? <Btn label="커뮤니티에 공유하기" kind="secondary" onPress={() => router.push({ pathname: '/community/share', params: { session: saved.sessionId } })} /> : null}
          {saved.bookId ? <Btn label="책 정보 보기" kind="secondary" onPress={() => router.replace(`/book/${saved.bookId}`)} /> : null}
          <Btn label="내 기록 보기" kind="secondary" onPress={() => router.replace('/stats')} />
          <Btn label="닫기" kind="ghost" onPress={() => router.dismissTo('/read')} />
        </View>
      </Screen>
    );
  if (!pending)
    return (
      <Screen tidy title="독서 기록">
        <Empty title="끝낸 독서가 없어요" action="읽기로" onAction={() => router.dismissTo('/read')} />
      </Screen>
    );
  const b = pending.myBookId ? lib.books[pending.myBookId] : undefined;
  const e = b && lib.editions[b.editionId];
  const sp = page(startPage);
  const ep = page(pages);
  const amount = sp !== undefined && ep !== undefined && ep >= sp ? ep - sp : undefined;
  const badRange = sp !== undefined && ep !== undefined && ep < sp;
  const save = async () => {
    if (saving || badRange) return;
    setSaving(true);
    try {
      await saveFinishedReading(pending, { startPage: pending.myBookId ? sp : undefined, pagesRead: pending.myBookId ? ep : undefined, memo: memo.trim() || undefined });
      ambient.stop();
      setSaved({ bookId: pending.myBookId, sessionId: pending.id });
    } catch (error) {
      Alert.alert('저장하지 못했어요', `독서 기록을 유지하고 있어요. 다시 시도해 주세요.\n${String((error as Error)?.message ?? error)}`);
    } finally {
      setSaving(false);
    }
  };
  const discard = () =>
    Alert.alert('이번 독서 기록을 버릴까요?', `${formatDurationPrecise(pending.durationMs)}이 저장되지 않아요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '버리기',
        style: 'destructive',
        onPress: () => {
          if (leaving.current) return;
          leaving.current = true;
          // 화면을 먼저 옮긴 뒤 초안을 지운다(사라지는 화면이 빈 화면으로 바뀌는 것과 이동이 한 프레임에 겹치면
          // 새 구조(Fabric)가 'The specified child already has a parent'로 앱을 죽였다)
          ambient.stop();
          router.dismissTo('/read');
          setTimeout(() => {
            readingStore.clearPending().catch(() => Alert.alert('버리지 못했어요', '독서 기록을 저장소에서 지우지 못했어요. 다음에 다시 열면 다시 물어볼게요.'));
          }, 500);
        },
      },
    ]);
  return (
    <Screen tidy title="독서 끝" back={false} footer={<Btn label="개인 기록 저장" onPress={save} busy={saving} disabled={saving || pending.durationMs < 1000 || badRange} />}>
      {readingError ? <Text accessibilityRole="alert" style={type.sub}>독서 기록을 기기에 저장하지 못했어요. 저장을 다시 시도해 주세요.</Text> : null}
      <View style={st.summary} accessible accessibilityLabel={`실제 독서 시간 ${formatDurationPrecise(pending.durationMs)}`}>
        <Text style={type.sub}>실제 독서 시간</Text>
        <Text style={st.time}>{pending.durationMs < 60000 ? formatDurationPrecise(pending.durationMs) : formatDuration(pending.durationMs)}</Text>
        <Text style={[type.caption, { marginTop: space.xs }]}>
          {hm(pending.startedAt)} ~ {hm(pending.endedAt)} · 일시정지 시간 제외
        </Text>
      </View>
      <SelectField label="연결된 책" value={e?.title} placeholder="책 연결하기 (선택)" onPress={() => setPicking(true)} />
      {b ? (
        <>
          <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }} gap={space.m}>
            <View style={{ flex: 1 }}>
              <Field label="시작 쪽 (선택)" unit="쪽" value={startPage} onChangeText={setStartPage} keyboardType="number-pad" placeholder={b.currentPage ? `지난번 ${b.currentPage}` : undefined} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="도달한 쪽 (선택)" unit="쪽" value={pages} onChangeText={setPages} keyboardType="number-pad" error={badRange ? '시작 쪽보다 앞이에요' : undefined} />
            </View>
          </Row>
          {amount !== undefined ? <Muted style={{ marginTop: -space.s, marginBottom: space.l }}>이번에 {amount}쪽 읽었어요.</Muted> : null}
        </>
      ) : null}
      <Field label="짧은 메모 (선택)" value={memo} onChangeText={setMemo} placeholder="나만 보는 메모예요" multiline submitBehavior="blurAndSubmit" returnKeyType="done" style={{ minHeight: 80 }} />
      <Btn label="버리기" kind="ghost" onPress={discard} />
      <BookPicker
        lib={lib}
        visible={picking}
        allowNone
        onClose={() => setPicking(false)}
        onPick={(id) => {
          readingStore.setPendingBook(id, id ? lib.books[id]?.currentPage : undefined);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  summary: { alignItems: 'center', paddingVertical: space.xl, marginTop: space.s, marginBottom: space.xl, borderBottomWidth: shape.hairline, borderBottomColor: colors.line },
  time: { fontFamily: fonts.ui, fontSize: 36, lineHeight: 44, color: colors.ink, marginTop: space.s, includeFontPadding: false, fontVariant: ['tabular-nums'] },
});
