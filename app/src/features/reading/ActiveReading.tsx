// 진행 중 독서: 다른 화면에서 다시 들어갈 수 있는 작은 표시 + 강제 종료 뒤 복구 창.
import { router, usePathname } from 'expo-router';
import { BookOpen } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { elapsedMs, readingStore, useReading } from '@/store/reading-store';
import { Btn } from '@/ui/kit';
import { colors, fonts, navigation } from '@/ui/theme';

export function clock(ms: number) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// 경과 시간(초 단위로 다시 그림). 보이는 동안만 타이머를 돌린다.
export function useElapsed(running: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((k) => k + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const a = readingStore.get().active;
  return a ? elapsedMs(a) : 0;
}

export function bookTitle(lib: ReturnType<typeof useLibrary>['lib'], myBookId?: string) {
  const b = myBookId ? lib.books[myBookId] : undefined;
  return b ? lib.editions[b.editionId]?.title : undefined;
}

export function ReadingPill() {
  const { active } = useReading();
  const { lib } = useLibrary();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const hidden = !active || path.startsWith('/reading');
  const ms = useElapsed(!hidden && !!active?.runningSince);
  if (hidden) return null;
  const title = bookTitle(lib, active!.myBookId);
  const onTabs = path === '/' || path === '/bookmarks' || path === '/read';
  return (
    <Pressable
      onPress={() => router.push('/reading/session')}
      accessibilityRole="button"
      accessibilityLabel={`진행 중인 독서 ${clock(ms)}${active!.runningSince ? '' : ', 일시정지'}. 눌러서 돌아가기`}
      style={[st.pill, { bottom: (onTabs ? navigation.height : 0) + insets.bottom + 10 }]}>
      <BookOpen size={15} color={colors.bg} strokeWidth={1.8} />
      <Text style={st.pillText}>{clock(ms)}</Text>
      <Text style={st.pillSub} numberOfLines={1}>
        {active!.runningSince ? (title ?? '책 없이 읽는 중') : '일시정지'}
      </Text>
    </Pressable>
  );
}

export function RecoveryDialog() {
  const { interrupted } = useReading();
  if (!interrupted) return null;
  const at = new Date(interrupted.lastBeat);
  const hm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => readingStore.dismissInterrupted()}>
      <View style={st.dim}>
        <View style={st.card}>
          <Text style={st.title}>지난 독서가 중간에 멈췄어요</Text>
          <Text style={st.body}>
            마지막으로 확인된 {hm}까지 {formatDuration(interrupted.countedMs)}을 읽은 것으로 저장해 두었어요. 앱이 꺼져 있던 {formatDuration(interrupted.gapMs)}은 독서 시간에 넣지 않았어요.
          </Text>
          <View style={{ gap: 8, marginTop: 16 }}>
            <Btn
              label="이어 읽기"
              onPress={() => {
                readingStore.resume();
                router.push('/reading/session');
              }}
            />
            <Btn
              label={`${hm}에 끝낸 것으로 기록하기`}
              kind="secondary"
              onPress={() => {
                readingStore.finish(interrupted.lastBeat);
                router.push('/reading/finish');
              }}
            />
            <Btn label="나중에 정하기(일시정지로 둠)" kind="ghost" onPress={() => readingStore.dismissInterrupted()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  pill: { position: 'absolute', alignSelf: 'center', maxWidth: 280, height: 36, borderRadius: 18, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, elevation: 3 },
  pillText: { color: colors.bg, fontSize: 14, fontVariant: ['tabular-nums'] },
  pillSub: { color: '#C9C4BA', fontSize: 12.5, flexShrink: 1 },
  dim: { flex: 1, backgroundColor: 'rgba(20,18,15,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.bg, borderRadius: 16, padding: 22 },
  title: { fontFamily: fonts.serif, fontSize: 19, color: colors.ink, marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkSoft },
});
