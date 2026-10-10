// 진행 중 독서: 시간 표시 도구(공통 미니 타이머 MiniTimer가 쓴다) + 강제 종료 뒤 복구 창.
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/domain/library';
import { useLibrary } from '@/store/library-store';
import { elapsedMs, readingStore, useReading } from '@/store/reading-store';
import { Btn } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

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

export function RecoveryDialog() {
  const { interrupted, pending, pendingRestored } = useReading();
  const path = usePathname();
  // 끝냈지만 저장·버리기를 고르기 전에 앱이 꺼졌던 기록
  if (!interrupted && pending && pendingRestored && !path.startsWith('/reading/finish'))
    return (
      <Modal transparent animationType="fade" visible onRequestClose={() => readingStore.ackPendingRestored()}>
        <View style={st.dim}>
          <View style={st.card}>
            <Text style={st.title}>저장하지 않은 독서 기록이 있어요</Text>
            <Text style={st.body}>지난번에 끝낸 {formatDuration(pending.durationMs)} 기록을 아직 저장하거나 버리지 않았어요.</Text>
            <View style={{ gap: 8, marginTop: 16 }}>
              <Btn
                label="기록 확인하기"
                onPress={() => {
                  readingStore.ackPendingRestored();
                  router.push('/reading/finish');
                }}
              />
              <Btn label="나중에" kind="ghost" onPress={() => readingStore.ackPendingRestored()} />
            </View>
          </View>
        </View>
      </Modal>
    );
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
  dim: { flex: 1, backgroundColor: 'rgba(20,18,15,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.bg, borderRadius: 16, padding: 22 },
  title: { fontFamily: fonts.serif, fontSize: 19, color: colors.ink, marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkSoft },
});
