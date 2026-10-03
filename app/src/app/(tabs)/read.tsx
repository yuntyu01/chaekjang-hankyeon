// 읽기 탭(시작 전): 읽을 책 고르기·최근 읽던 책·분위기·목표(선택) → 독서 시작 / 소리만 듣기.
// 책 상세의 '이 책 읽기'로 들어오면 그 책이 골라져 있다. 책 없이 시작하고 끝낼 때 연결해도 된다.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { recentBookIds, BookPicker } from '@/features/bookmark/BookPicker';
import { clock, useElapsed } from '@/features/reading/ActiveReading';
import { formatDuration } from '@/domain/library';
import { ambient, SCENES, TEMP_ASSETS } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore, useSettings } from '@/store/settings-store';
import { Btn, Card, Chip, H2, Muted, Row, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

const GOALS = [null, 15, 30, 60] as const;

export default function ReadTab() {
  const params = useLocalSearchParams<{ book?: string }>();
  const { lib } = useLibrary();
  const settings = useSettings();
  const { active } = useReading();
  const ms = useElapsed(!!active?.runningSince);
  const [bookId, setBookId] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (params.book && lib.books[params.book]) setBookId(params.book);
  }, [params.book, lib.books]);
  const recent = recentBookIds(lib).slice(0, 3);
  const title = (id?: string) => (id ? lib.editions[lib.books[id]?.editionId]?.title : undefined);

  if (active)
    return (
      <Screen title="읽기" back={false} bottomPad={navigation.height}>
        <Card style={{ marginTop: 8, paddingVertical: 24, alignItems: 'center' }}>
          <Muted>{active.runningSince ? '읽는 중' : '일시정지'}</Muted>
          <Text style={{ fontSize: 40, color: colors.ink, fontVariant: ['tabular-nums'], marginVertical: 6 }}>{clock(ms)}</Text>
          <Text style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>{title(active.myBookId) ?? '책 연결 없이'}</Text>
          <Btn label="독서 화면으로" onPress={() => router.push('/reading/session')} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </Card>
      </Screen>
    );

  return (
    <Screen title="읽기" back={false} bottomPad={navigation.height}>
      <Muted>읽은 시간은 쌓이는 방식으로 기록돼요. 일시정지한 시간과 소리만 들은 시간은 빠져요.</Muted>
      <H2>읽을 책</H2>
      <Pressable onPress={() => setPicking(true)} accessibilityRole="button">
        <Card>
          <Text style={{ fontFamily: fonts.serif, fontSize: 16, color: bookId ? colors.ink : colors.inkSoft }}>{title(bookId) ?? '책 고르기 (선택)'}</Text>
          {bookId ? <Muted style={{ marginTop: 2 }}>눌러서 바꾸기</Muted> : <Muted style={{ marginTop: 2 }}>책 없이 시작하고 끝낼 때 연결해도 돼요</Muted>}
        </Card>
      </Pressable>
      {recent.length ? (
        <Row style={{ marginTop: 10 }}>
          <Muted>최근</Muted>
          {recent.map((id) => (
            <Chip key={id} label={title(id) ?? ''} on={bookId === id} onPress={() => setBookId(bookId === id ? undefined : id)} />
          ))}
        </Row>
      ) : null}

      <H2>분위기</H2>
      <View style={{ gap: 8 }}>
        {SCENES.map((sc) => (
          <Pressable key={sc.id} onPress={() => settingsStore.set({ scene: sc.id })} accessibilityRole="button" accessibilityState={{ selected: settings.scene === sc.id }}>
            <Card style={settings.scene === sc.id ? { borderColor: colors.ink, borderWidth: 1.5 } : undefined}>
              <Text style={{ fontFamily: fonts.serif, fontSize: 15.5, color: colors.ink }}>{sc.name}</Text>
              <Muted style={{ marginTop: 2 }}>{sc.sound}</Muted>
            </Card>
          </Pressable>
        ))}
      </View>
      {TEMP_ASSETS ? <Muted style={{ marginTop: 8 }}>지금 장면과 소리는 임시 자산이에요(최종 그림·음원으로 바뀔 예정).</Muted> : null}

      <H2>목표 시간 (선택)</H2>
      <Row>
        {GOALS.map((g) => (
          <Chip key={String(g)} label={g ? `${g}분` : '없음'} on={settings.goalMin === g} onPress={() => settingsStore.set({ goalMin: g })} />
        ))}
      </Row>

      <View style={{ gap: 10, marginTop: 26 }}>
        <Btn
          label="독서 시작"
          onPress={() => {
            readingStore.start(bookId);
            void ambient.play(settings.scene);
            router.push('/reading/session');
          }}
        />
        <Btn
          label="소리만 듣기"
          kind="secondary"
          onPress={() => {
            void ambient.play(settings.scene);
            router.push({ pathname: '/reading/session', params: { sound: '1' } });
          }}
        />
      </View>
      <TotalsHint lib={lib} />
      <BookPicker
        lib={lib}
        visible={picking}
        allowNone
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setBookId(id);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

function TotalsHint({ lib }: { lib: ReturnType<typeof useLibrary>['lib'] }) {
  const sessions = Object.values(lib.sessions);
  if (!sessions.length) return <Muted style={{ marginTop: 18, textAlign: 'center' }}>아직 독서 기록이 없어요. 첫 기록을 시작해 보세요.</Muted>;
  const total = sessions.reduce((a, s) => a + s.durationMs, 0);
  return (
    <Pressable onPress={() => router.push('/stats')} accessibilityRole="button" style={{ marginTop: 18, alignItems: 'center' }}>
      <Muted>
        지금까지 {sessions.length}번, {formatDuration(total)} 읽었어요 · <Text style={{ textDecorationLine: 'underline' }}>내 기록</Text>
      </Muted>
    </Pressable>
  );
}
