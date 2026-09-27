// 상자 모델 파일럿 화면(검수용). 선반 한 칸: 눕힘 · 기대는 세운 책 · 표지 전시.
// 흰(세운 책)의 기대는 방향·위치를 바꾸면 선반 공간에서 다시 풀어 저장한다. 앱을 다시 켜도 같은 배치여야 한다.
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { silhouette } from '@/domain/box';
import { SHELF } from '@/domain/geometry';
import { SAMPLE_BOOKS } from '@/domain/onboarding-sample';
import { contactReport, PILOT_LAYOUT, placePilot, withPilotLeans, type PilotLayout } from '@/domain/pilot';
import { BoxShelf } from '@/ui/box/BoxShelf';
import { camera, colors } from '@/ui/theme';

const KEY = 'pilot-layout:v1';
const books = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const LEANER = 'b06';

export default function PilotScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState<PilotLayout | null>(null);

  useEffect(() => {
    void (async () => {
      let saved: PilotLayout | null = null;
      try {
        const raw = await Storage.getItem(KEY);
        saved = raw ? (JSON.parse(raw) as PilotLayout) : null;
      } catch {
        saved = null;
      }
      setLayout(saved?.version === 1 ? saved : withPilotLeans(PILOT_LAYOUT, books));
    })();
  }, []);

  const commit = (next: PilotLayout) => {
    const solved = withPilotLeans(next, books);
    setLayout(solved);
    void Storage.setItem(KEY, JSON.stringify(solved));
  };

  const scene = useMemo(() => (layout ? placePilot(layout, books) : null), [layout]);
  if (!layout || !scene) return null;

  const s = Math.min(width, 520) / 390;
  const originX = (width - 390 * s) / 2;
  const entries = scene.placed.map((p) => ({ book: books[p.bookId], placed: p }));
  const minY = Math.min(...scene.placed.map((p) => Math.min(...silhouette(camera, p).map((q) => q.y))));
  const clear = SHELF.clearHeight - minY + 16;
  const height = (clear + SHELF.below + 30) * s;
  const report = contactReport(scene.placed);
  const leaner = layout.items.find((i) => i.bookId === LEANER)!;

  const edit = (patch: Partial<(typeof layout.items)[number]>) =>
    commit({ ...layout, items: layout.items.map((i) => (i.bookId === LEANER ? { ...i, ...patch, saved: undefined } : i)) });

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: 40 }}>
      <Text style={styles.title}>상자 모델 파일럿</Text>
      <BoxShelf entries={entries} cam={camera} scale={s} originX={originX} clear={clear} height={height} />
      <View style={styles.row}>
        <Btn label="← 기대기" onPress={() => edit({ lean: -1 })} active={leaner.lean === -1} />
        <Btn label="세우기" onPress={() => edit({ lean: undefined })} active={!leaner.lean} />
        <Btn label="기대기 →" onPress={() => edit({ lean: 1 })} active={leaner.lean === 1} />
      </View>
      <View style={styles.row}>
        <Btn label="흰 ◀ 3" onPress={() => edit({ x: leaner.x - 3 })} />
        <Btn label="흰 ▶ 3" onPress={() => edit({ x: leaner.x + 3 })} />
        <Btn label="처음으로" onPress={() => commit(PILOT_LAYOUT)} />
      </View>
      <View style={styles.report}>
        {report.map((r) => (
          <Text key={r.bookId} style={styles.line}>
            {books[r.bookId].title}: 각도 {r.angle.toFixed(3)}° · 닿음 {r.touching ? books[r.touching].title : '-'} · 파고듦 {r.penetrates.length ? r.penetrates.join(',') : '없음'}
          </Text>
        ))}
        <Text style={styles.line}>카메라 kx {camera.kx} · ky {camera.ky}</Text>
      </View>
    </ScrollView>
  );
}

function Btn({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, active && styles.btnOn]} accessibilityRole="button">
      <Text style={[styles.btnText, active && styles.btnTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, color: colors.title, marginLeft: 24, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#CFC6BA', alignItems: 'center' },
  btnOn: { backgroundColor: colors.tabActive, borderColor: colors.tabActive },
  btnText: { color: colors.title, fontSize: 14 },
  btnTextOn: { color: '#fff' },
  report: { marginTop: 16, paddingHorizontal: 24, gap: 4 },
  line: { fontSize: 12.5, color: colors.summary },
});
