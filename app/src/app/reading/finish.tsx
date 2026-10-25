// 독서 종료 기록: 연결된 책(바꾸거나 연결하기), 실제 독서 시간, 선택 입력(읽은 쪽수·짧은 메모) → 저장 또는 버리기.
// 저장 후 이 책에 갈피를 남기러 갈 수 있다. 완독 여부는 여기서 자동으로 정하지 않는다.
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { hm } from '@/features/book/labels';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { formatDuration } from '@/domain/library';
import { ambient } from '@/services/ambient';
import { libraryStore, useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { Btn, Empty, Field, Row, Screen, SelectField } from '@/ui/kit';
import { colors, fonts, shape, space, type } from '@/ui/screenTheme';

export default function Finish() {
  const { pending } = useReading();
  const { lib } = useLibrary();
  const [picking, setPicking] = useState(false);
  const [pages, setPages] = useState('');
  const [memo, setMemo] = useState('');
  const [saved, setSaved] = useState<{ bookId?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (saved)
    return (
      <Screen title="저장했어요" back={false}>
        <Text style={[type.body, { fontSize: 17, marginTop: space.item }]}>독서 기록을 저장했어요.</Text>
        <View style={{ gap: 10, marginTop: space.section }}>
          {saved.bookId ? <Btn label="이 책에 갈피 남기기" onPress={() => router.replace({ pathname: '/bookmark/new', params: { book: saved.bookId } })} /> : null}
          {saved.bookId ? <Btn label="책 상세 보기" kind="secondary" onPress={() => router.replace(`/book/${saved.bookId}`)} /> : null}
          <Btn label="내 기록 보기" kind="secondary" onPress={() => router.replace('/stats')} />
          <Btn label="닫기" kind="ghost" onPress={() => router.dismissTo('/read')} />
        </View>
      </Screen>
    );
  if (!pending)
    return (
      <Screen title="독서 기록">
        <Empty title="끝낸 독서가 없어요" action="읽기로" onAction={() => router.dismissTo('/read')} />
      </Screen>
    );
  const b = pending.myBookId ? lib.books[pending.myBookId] : undefined;
  const e = b && lib.editions[b.editionId];
  const save = () => {
    if (saving) return;
    setSaving(true);
    const n = Number(pages);
    libraryStore.addSession({ id: pending.id, myBookId: pending.myBookId, startedAt: pending.startedAt, endedAt: pending.endedAt, durationMs: pending.durationMs, pagesRead: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined });
    // 읽기 전이던 책을 읽었다면 읽는 중으로(완독은 사용자가 정한다)
    if (b && b.status === 'want') libraryStore.setStatus(b.id, 'reading');
    ambient.stop();
    readingStore.clearPending();
    setSaved({ bookId: pending.myBookId });
  };
  const discard = () =>
    Alert.alert('이번 독서 기록을 버릴까요?', `${formatDuration(pending.durationMs)}이 저장되지 않아요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '버리기',
        style: 'destructive',
        onPress: () => {
          ambient.stop();
          readingStore.clearPending();
          router.dismissTo('/read');
        },
      },
    ]);
  return (
    <Screen title="독서 끝" back={false} footer={<Btn label="기록 저장" onPress={save} disabled={pending.durationMs < 1000} />}>
      <View style={{ alignItems: 'center', paddingVertical: space.section, marginTop: space.tight, marginBottom: space.group, borderBottomWidth: shape.hairline, borderBottomColor: colors.line }} accessible accessibilityLabel={`실제 독서 시간 ${formatDuration(pending.durationMs)}`}>
        <Text style={type.sub}>실제 독서 시간</Text>
        <Text style={st.time}>{formatDuration(pending.durationMs)}</Text>
        <Text style={[type.caption, { marginTop: 6 }]}>
          {hm(pending.startedAt)} ~ {hm(pending.endedAt)} · 일시정지 시간 제외
        </Text>
      </View>
      <SelectField label="연결된 책" value={e?.title} placeholder="책 연결하기 (선택)" onPress={() => setPicking(true)} />
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }} gap={10}>
        <View style={{ width: 150 }}>
          <Field label="읽은 쪽수까지 (선택)" value={pages} onChangeText={setPages} keyboardType="number-pad" placeholder={b?.currentPage ? `지난번 ${b.currentPage}쪽` : '쪽'} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="짧은 메모 (선택)" value={memo} onChangeText={setMemo} />
        </View>
      </Row>
      <Btn label="버리기" kind="ghost" onPress={discard} />
      <BookPicker
        lib={lib}
        visible={picking}
        allowNone
        onClose={() => setPicking(false)}
        onPick={(id) => {
          readingStore.setPendingBook(id);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

const st = { time: { fontFamily: fonts.ui, fontSize: 36, lineHeight: 44, color: colors.ink, marginTop: 8, includeFontPadding: false } as const };
