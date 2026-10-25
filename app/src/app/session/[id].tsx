// 독서 기록 수정: 잘못 저장한 시간·날짜·책 연결을 고치거나 삭제한다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { BookPicker } from '@/features/bookmark/BookPicker';
import { formatDuration } from '@/domain/library';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Field, Muted, Row, Screen, SelectField } from '@/ui/kit';
import { space } from '@/ui/screenTheme';

const pad = (n: number) => String(n).padStart(2, '0');
const localParts = (iso: string) => {
  const d = new Date(iso);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

export default function EditSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const s = lib.sessions[id];
  const [picking, setPicking] = useState(false);
  const [bookId, setBookId] = useState<string | undefined>(s?.myBookId);
  const [day, setDay] = useState(s ? localParts(s.startedAt).day : '');
  const [time, setTime] = useState(s ? localParts(s.startedAt).time : '');
  const [minutes, setMinutes] = useState(s ? String(Math.max(1, Math.round(s.durationMs / 60000))) : '');
  const [pages, setPages] = useState(s?.pagesRead ? String(s.pagesRead) : '');
  const [memo, setMemo] = useState(s?.memo ?? '');
  if (!s) return <Screen title="독서 기록"><Empty title="기록을 찾을 수 없어요" /></Screen>;
  const e = bookId ? lib.editions[lib.books[bookId]?.editionId] : undefined;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{1,2}:\d{2}$/.test(time) && Number(minutes) > 0;
  const save = () => {
    const [yy, mo, dd] = day.split('-').map(Number);
    const [hh, mi] = time.split(':').map(Number);
    const start = new Date(yy, mo - 1, dd, hh, mi);
    const durationMs = Math.round(Number(minutes) * 60000);
    // 시간을 고치면 끝 시각은 시작 + 독서 시간으로 둔다(일시정지 구간 정보는 따로 남기지 않는다)
    const n = Number(pages);
    libraryStore.updateSession(id, { myBookId: bookId, startedAt: start.toISOString(), endedAt: new Date(start.getTime() + durationMs).toISOString(), durationMs, pagesRead: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined, memo: memo.trim() || undefined });
    router.back();
  };
  return (
    <Screen title="독서 기록 수정" footer={<Btn label="저장" onPress={save} disabled={!valid} />}>
      <Muted style={{ marginTop: space.item, marginBottom: space.group }}>지금 저장된 시간: {formatDuration(s.durationMs)}</Muted>
      <SelectField label="연결된 책" value={e?.title} placeholder="책 없음 (눌러서 연결)" onPress={() => setPicking(true)} />
      <Row style={{ flexWrap: 'nowrap' }} gap={10}>
        <View style={{ flex: 1.3 }}>
          <Field label="날짜" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="시작 시각" value={time} onChangeText={setTime} placeholder="HH:MM" keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
      <Field label="독서 시간(분)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
      <Field label="읽은 쪽수까지 (선택)" value={pages} onChangeText={setPages} keyboardType="number-pad" />
      <Field label="메모 (선택)" value={memo} onChangeText={setMemo} />
      <Btn
        label="이 기록 삭제"
        kind="danger"
        style={{ marginTop: space.item }}
        onPress={() =>
          Alert.alert('이 독서 기록을 삭제할까요?', '통계에서도 빠져요. 되돌릴 수 없어요.', [
            { text: '취소', style: 'cancel' },
            {
              text: '삭제',
              style: 'destructive',
              onPress: () => {
                libraryStore.deleteSession(id);
                router.back();
              },
            },
          ])
        }
      />
      <BookPicker
        lib={lib}
        visible={picking}
        allowNone
        onClose={() => setPicking(false)}
        onPick={(b) => {
          setBookId(b);
          setPicking(false);
        }}
      />
    </Screen>
  );
}
