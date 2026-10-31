// 독서 기록 수정: 잘못 저장한 시간·날짜·책 연결을 고치거나 삭제한다.
// 고친 칸만 저장한다(domain/session-edit): 메모만 고치면 시작·끝 시각과 초 단위 독서 시간이 그대로 남는다.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { BookPicker } from '@/features/bookmark/BookPicker';
import { formatDurationPrecise } from '@/domain/library';
import { sessionEditPatch, sessionFormOf, validDay, validTime } from '@/domain/session-edit';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Btn, Empty, Field, Muted, Row, Screen, SelectField } from '@/ui/kit';
import { space } from '@/ui/screenTheme';

export default function EditSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lib } = useLibrary();
  const s = lib.sessions[id];
  const [initial] = useState(() => (s ? sessionFormOf(s) : null));
  const [picking, setPicking] = useState(false);
  const [bookId, setBookId] = useState<string | undefined>(initial?.bookId);
  const [day, setDay] = useState(initial?.day ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [minutes, setMinutes] = useState(initial?.minutes ?? '');
  const [pages, setPages] = useState(initial?.pages ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  if (!s || !initial) return <Screen title="독서 기록"><Empty title="기록을 찾을 수 없어요" /></Screen>;
  const e = bookId ? lib.editions[lib.books[bookId]?.editionId] : undefined;
  const patch = sessionEditPatch(s, initial, { bookId, day, time, minutes, pages, memo });
  const save = () => {
    if (!patch) return;
    if (Object.keys(patch).length) libraryStore.updateSession(id, patch);
    router.back();
  };
  return (
    <Screen title="독서 기록 수정" footer={<Btn label="저장" onPress={save} disabled={!patch} />}>
      <Muted style={{ marginTop: space.item, marginBottom: space.group }}>지금 저장된 독서 시간: {formatDurationPrecise(s.durationMs)} (일시정지 제외)</Muted>
      <SelectField label="연결된 책" value={e?.title} placeholder="책 없음 (눌러서 연결)" onPress={() => setPicking(true)} />
      <Row style={{ flexWrap: 'nowrap' }} gap={10}>
        <View style={{ flex: 1.3 }}>
          <Field label="날짜" value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={day !== initial.day && !validDay(day) ? 'YYYY-MM-DD로 적어 주세요' : undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="시작 시각" value={time} onChangeText={setTime} placeholder="HH:MM" keyboardType="numbers-and-punctuation" error={time !== initial.time && !validTime(time) ? 'HH:MM으로 적어 주세요' : undefined} />
        </View>
      </Row>
      <Field label="독서 시간(분)" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" hint={minutes === initial.minutes ? '고치지 않으면 저장된 시간(초 단위)이 그대로 남아요.' : undefined} error={minutes !== initial.minutes && !(Number(minutes) > 0) ? '1분 이상으로 적어 주세요' : undefined} />
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
