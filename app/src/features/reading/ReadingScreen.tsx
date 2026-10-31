// 독서 실행 화면: 장면이 화면 대부분, 아래 조작부는 위에서부터 연결된 책 · 시간 · [분위기 | 재생/일시정지 | 목표] 한 줄.
// 분위기 = 장면+환경음 한 세트(하나로 고른다). 조작부 높이는 예전(2026-10-31 사용자 '하단부 높이 낮춰줘') 수준을 지킨다.
// 조작부를 접으면 밝은 시간과 재생·일시정지만 남는다(다시 열어도 타이머는 멈추지 않는다).
// 2026-10-31 일반 UI 정돈: 조작부·시트는 정돈 변형(Tidy). 배경 장면(그림·영상)과 독서 세션 동작은 그대로.
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect } from 'expo-router';
import { BookOpen, AudioLines, Check, ChevronDown, ChevronLeft, Timer, Volume1, Volume2, VolumeX } from '@/ui/icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { bookTitle, clock, useElapsed } from '@/features/reading/ActiveReading';
import { Scene } from '@/features/reading/Scene';
import { ambient, SCENES, useAmbient } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore, useSettings } from '@/store/settings-store';
import { colors, fonts, icon, night, press, tidyShape as shape, tidySpace as space, tidyType as type } from '@/ui/screenTheme';
import { LibraryCover } from '@/ui/BookVisual';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { Btn, ListGroup, ListItem, Row, Sheet, Tidy } from '@/ui/kit';
import { StatusBar } from 'expo-status-bar';

const LIGHT = night.ink;
// 장면 이름(밤의 창가는 소리 쪽 이름으로 부른다: 머리줄·분위기 줄·시트가 같은 이름)
const sceneName = (id: string) => (id === 'rain' ? '창가의 빗소리' : SCENES.find((s) => s.id === id)?.name ?? '');

// 재생 삼각형: 모서리를 둥글게(같은 색 굵은 둥근 이음 윤곽). 눈으로 가운데 보이게 오른쪽으로 조금
function PlayIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginLeft: size * 0.08 }}>
      <Path d="M7.5 5.2v13.6L18.6 12z" fill={color} stroke={color} strokeWidth={2.6} strokeLinejoin="round" />
    </Svg>
  );
}
// 일시정지: 끝이 둥근 두 막대
function PauseIcon({ height, width, gap, color }: { height: number; width: number; gap: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      <View style={{ width, height, borderRadius: width / 2, backgroundColor: color }} />
      <View style={{ width, height, borderRadius: width / 2, backgroundColor: color }} />
    </View>
  );
}

export function ReadingScreen({ initialBookId, soundOnly = false, inTab = false }: { initialBookId?: string; soundOnly?: boolean; inTab?: boolean }) {
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { active, error: readingError } = useReading();
  const { lib } = useLibrary();
  const settings = useSettings();
  const audio = useAmbient();
  const [open, setOpen] = useState(true);
  const [bookPicker, setBookPicker] = useState(false);
  const [controls, setControls] = useState<'mood' | 'goal' | null>(null);
  const [draftBookId, setDraftBookId] = useState<string | undefined>(initialBookId);
  const selectedBookId = active ? active.myBookId : draftBookId;
  const bookId = selectedBookId && lib.books[selectedBookId] ? selectedBookId : undefined;
  const { height } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(height);
  const [panelHeight, setPanelHeight] = useState(310);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [sysReduce, setSysReduce] = useState(false);
  useEffect(() => {
    const s = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    void AccessibilityInfo.isReduceMotionEnabled().then(setSysReduce);
    return () => s.remove();
  }, []);
  const reduce = settings.reduceMotion === 'on' || (settings.reduceMotion === 'system' && sysReduce);
  const running = !!active?.runningSince;
  const ticking = focused && appActive && running;
  const scene = settings.scene;
  const goalMs = settings.goalMin ? settings.goalMin * 60000 : null;

  // Visiting the tab only presents a draft. Only the explicit start action creates a timer.
  useEffect(() => {
    if (!initialBookId) return;
    if (lib.books[initialBookId] && !active) setDraftBookId(initialBookId);
    // Consume the book-detail handoff so revisiting that same book can select it again.
    // Leaving and returning to the tab must retain the choice made inside the timer.
    router.setParams({ book: undefined });
  }, [initialBookId, lib.books, active]);
  useEffect(() => { if (!active && !soundOnly && !audio.playing) setOpen(true); }, [active, soundOnly, audio.playing]);

  const finish = () => {
    if (!active) return;
    readingStore.finish();
    if (inTab) router.push('/reading/finish');
    else router.replace('/reading/finish');
  };
  const leave = () => inTab ? router.navigate('/') : router.canGoBack() ? router.back() : router.replace('/');
  const start = () => {
    // Guard repeated taps and keep the store's existing pause/resume/recovery semantics.
    if (readingStore.get().active || readingStore.get().pending) {
      if (readingStore.get().pending) router.push('/reading/finish');
      return;
    }
    readingStore.start(draftBookId && lib.books[draftBookId] ? draftBookId : undefined);
    void ambient.play(settings.scene);
  };
  // 재생·일시정지: 펼친 조작부의 둥근 단추와 접었을 때 시간 옆 아이콘이 같은 동작이다
  const playing = soundOnly ? audio.playing : running;
  const playPause = soundOnly ? () => audio.playing ? ambient.pause() : void ambient.play(scene) : !active ? start : () => running ? readingStore.pause() : readingStore.resume();
  const playLabel = soundOnly ? audio.playing ? '소리 멈추기' : '소리 재생' : !active ? '독서 시작' : running ? '일시정지' : '다시 읽기';

  return (
    <Tidy>
    <View onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: '#182C44' }}>
      {focused ? <StatusBar style="light" /> : null}
      <Scene id={scene} animate={focused && appActive && !reduce} height={open ? Math.max(viewportHeight * 0.3, viewportHeight - panelHeight + 22) : viewportHeight} />
      <View style={[st.top, { paddingTop: insets.top + 6 }]}>
        <View style={st.topRow}>
          <Pressable onPress={leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={active ? '나가기(독서는 계속)' : '책장으로'}><ChevronLeft size={28} color={LIGHT} strokeWidth={icon.stroke} /></Pressable>
          <Text style={st.heading}>{soundOnly ? '소리 듣기' : '읽기'}</Text>
          <Pressable onPress={soundOnly ? () => { ambient.stop(); leave(); } : active ? finish : leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={soundOnly ? '소리 끄고 나가기' : active ? '독서 끝내기' : '닫기'}><Text style={st.finish}>{active || soundOnly ? '끝내기' : '닫기'}</Text></Pressable>
        </View>
        <View style={st.sceneLabel}><AudioLines size={icon.small} color={LIGHT} strokeWidth={1.9} /><Text style={st.sceneName}>{sceneName(scene)}</Text></View>
      </View>
      {/* Preserve the cover canvas and paper surface while folded. */}
        <View pointerEvents={open ? 'auto' : 'none'} onLayout={(e) => { if (open) setPanelHeight(e.nativeEvent.layout.height); }} style={[st.panel, { maxHeight: height * 0.65, display: open ? 'flex' : 'none' }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.page, paddingTop: space.m, paddingBottom: insets.bottom + space.m }}>
            {/* 1) 연결된 책(실제 표지·제목) — 분위기와 떨어진 맨 위. 누르면 바꾸기, 책 없이 시작해도 된다 */}
            <View style={st.bookRow}>
              <Pressable onPress={() => setBookPicker(true)} accessibilityRole="button" accessibilityLabel={bookId ? '책 변경' : '책 연결하기'} style={({ pressed }) => [st.bookPicker, pressed && press]}>
                {!soundOnly && bookId && lib.books[bookId] ? <LibraryCover lib={lib} id={bookId} width={44} /> : <View style={st.emptyCover}><BookOpen size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} /></View>}
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={st.book} numberOfLines={2}>{soundOnly ? '소리와 함께 쉬어 가요' : bookTitle(lib, bookId) ?? '책 연결하기'}</Text>
                  <Text style={st.changeBook}>{soundOnly ? '독서 시간은 기록하지 않아요' : bookId ? '책 변경' : '책 없이 시작해도 좋아요'}</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={st.fold} accessibilityRole="button" accessibilityLabel="조작부 접기"><ChevronDown size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} /><Text style={st.foldText}>접기</Text></Pressable>
            </View>
            {/* 2) 시간(가장 크게, 숫자 폭 고정). 아래 한 줄은 자리를 늘 지켜(일시정지·목표) 멈춰도 시간이 위아래로 흔들리지 않는다 */}
            {!soundOnly ? <Pressable onPress={() => setControls('goal')} accessibilityRole="button" accessibilityLabel={`목표 시간 설정, ${settings.goalMin ? settings.goalMin + '분' : '자유롭게 시간 재기'}`} style={st.timeArea}>
              <Elapsed running={ticking}>{(ms) => <>
                <Text style={st.time} accessibilityLabel={`읽은 시간 ${clock(ms)}`}>{clock(ms)}</Text>
                <Text style={st.status}>{active && !running ? '일시정지' : goalMs ? (ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분`) : ' '}</Text>
              </>}</Elapsed>
              {readingError ? <Text accessibilityRole="alert" style={[st.status, { color: colors.danger }]}>독서 시간을 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.</Text> : null}
            </Pressable> : null}
            {/* 3) [분위기 | 재생·일시정지 | 목표]: 재생은 단색 원(그라데이션·그림자 없음), 실행 중이면 일시정지·멈춰 있으면 재생.
                분위기는 장면과 환경음이 한 세트라 하나로 고른다(소리 크기도 같은 시트) */}
            <View style={st.controls}>
              <Pressable onPress={() => setControls('mood')} style={({ pressed }) => [st.side, pressed && press]} accessibilityRole="button" accessibilityLabel={`분위기 고르기, ${sceneName(scene)}, ${settings.muted ? '음소거' : `소리 ${Math.round(settings.volume * 100)}%`}`}>
                <AudioLines size={26} color={colors.ink} strokeWidth={icon.stroke} />
                <Text style={st.sideText} numberOfLines={2}>{sceneName(scene)}</Text>
              </Pressable>
              <Pressable onPress={playPause} style={({ pressed }) => [st.round, pressed && st.roundPressed]} accessibilityRole="button" accessibilityLabel={playLabel}>
                {playing ? <PauseIcon width={7} height={26} gap={8} color={colors.onAccent} /> : <PlayIcon size={34} color={colors.onAccent} />}
              </Pressable>
              {soundOnly ? (
                <View style={st.side} />
              ) : (
                <Pressable onPress={() => setControls('goal')} style={({ pressed }) => [st.side, pressed && press]} accessibilityRole="button" accessibilityLabel={`목표 시간, ${settings.goalMin ? settings.goalMin + '분' : '목표 없음'}`}>
                  <Timer size={26} color={colors.ink} strokeWidth={icon.stroke} />
                  <Text style={st.sideText} numberOfLines={2}>{settings.goalMin ? `목표 ${settings.goalMin}분` : '목표 없음'}</Text>
                </Pressable>
              )}
            </View>
            {audio.error ? <Text style={st.error}>{audio.error}</Text> : null}
            {soundOnly ? <Btn label="지금부터 독서 기록" kind="ghost" onPress={() => { start(); router.replace('/read'); }} style={{ marginTop: space.s }} /> : null}
          </ScrollView>
        </View>
      {/* 접었을 때: 장면 아래쪽을 어둡게 물들이고 그 위에 밝은 시간과 재생·일시정지만. 시간을 누르면 조작부가 다시 열린다 */}
      {!open ? (
        <>
          <Svg pointerEvents="none" width="100%" height={Math.round(viewportHeight * 0.34)} style={st.fade}>
            <Defs>
              <LinearGradient id="foldFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={night.fade} stopOpacity={0} />
                <Stop offset="0.55" stopColor={night.fade} stopOpacity={0.32} />
                <Stop offset="1" stopColor={night.fade} stopOpacity={0.62} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#foldFade)" />
          </Svg>
          <View style={[st.dock, { bottom: insets.bottom + 26 }]} pointerEvents="box-none">
            <Pressable onPress={() => setOpen(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="조작부 열기" style={st.dockTime}>
              <Text style={st.dockTimeText}>{soundOnly ? '조작부 열기' : <Elapsed running={ticking}>{clock}</Elapsed>}</Text>
            </Pressable>
            <Pressable onPress={playPause} hitSlop={12} accessibilityRole="button" accessibilityLabel={playLabel} style={st.dockPlay}>
              {playing ? <PauseIcon width={5} height={24} gap={6} color={night.ink} /> : <PlayIcon size={30} color={night.ink} />}
            </Pressable>
          </View>
        </>
      ) : null}
      <BookPicker lib={lib} visible={bookPicker} allowNone onClose={() => setBookPicker(false)} onPick={(id) => { setDraftBookId(id); if (active) readingStore.setBook(id); setBookPicker(false); }} />
      <Sheet visible={controls !== null} onClose={() => setControls(null)} title={controls === 'goal' ? '목표 시간' : '분위기'} scroll maxHeight={height * 0.8}>
        {controls === 'goal' ? (
          <View>
            <Text style={[type.sub, { marginBottom: space.s }]}>목표 없이 읽어도 좋아요. 목표를 바꿔도 읽은 시간은 유지돼요.</Text>
            <ListGroup>
              {[null, 15, 30, 60].map((min) => (
                <ListItem key={String(min)} label={min ? `${min}분` : '자유롭게 시간 재기'} selected={settings.goalMin === min} right={settings.goalMin === min ? <Check size={icon.size} color={colors.accent} strokeWidth={2} /> : null} onPress={() => { settingsStore.set({ goalMin: min }); setControls(null); }} />
              ))}
            </ListGroup>
          </View>
        ) : (
          <View>
            <Text style={[type.sub, { marginBottom: space.s }]}>장면과 환경음이 함께 바뀌어요.</Text>
            <ListGroup>
              {SCENES.map((sc) => (
                <ListItem key={sc.id} label={sceneName(sc.id)} sub={`환경음 · ${sc.sound}`} selected={scene === sc.id} right={scene === sc.id ? <Check size={icon.size} color={colors.accent} strokeWidth={2} /> : null} onPress={() => { settingsStore.set({ scene: sc.id }); if (audio.playing) void ambient.play(sc.id); }} />
              ))}
            </ListGroup>
            <Text style={[type.section, { marginTop: space.xl, marginBottom: space.s }]}>소리 크기</Text>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <Pressable onPress={() => settingsStore.set({ muted: !settings.muted })} style={st.control} accessibilityRole="button" accessibilityLabel={settings.muted ? '음소거 해제' : '음소거'}>{settings.muted ? <VolumeX size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /> : <Volume2 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}<Text style={st.controlText}>{settings.muted ? '음소거 해제' : '음소거'}</Text></Pressable>
              <Pressable onPress={() => settingsStore.set({ volume: Math.max(0, Math.round((settings.volume - 0.2) * 10) / 10) })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 작게"><Volume1 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
              <Text style={[type.row, { fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'center' }]}>{Math.round(settings.volume * 100)}%</Text>
              <Pressable onPress={() => settingsStore.set({ volume: Math.min(1, Math.round((settings.volume + 0.2) * 10) / 10), muted: false })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 크게"><Volume2 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
            </Row>
            {!active ? (
              <View style={{ marginTop: space.xl, gap: space.s }}>
                <Text style={type.sub}>시간을 재지 않고 소리만 들을 수 있어요.</Text>
                <Btn label={audio.playing ? '소리 멈추기' : '소리만 듣기'} kind="secondary" onPress={() => audio.playing ? ambient.pause() : void ambient.play(scene)} />
              </View>
            ) : null}
          </View>
        )}
        <Btn label="닫기" kind="ghost" onPress={() => setControls(null)} style={{ marginTop: space.s }} />
      </Sheet>
    </View>
    </Tidy>
  );
}

// 어두운 장면 위 머리줄은 밝은 글자(night)에 옅은 그늘을 깔아 대비를 지킨다. 아래 조작판은 화면 공통 토큰.
const shade = { textShadowColor: night.shade, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };
// 1초마다 바뀌는 시간 글자만 다시 그린다(장면·조작부·책 고르기 창까지 화면 전체를 매초 다시 그리지 않게)
function Elapsed({ running, children }: { running: boolean; children: (ms: number) => ReactNode }) {
  const ms = useElapsed(running);
  return <>{children(ms)}</>;
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, paddingBottom: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topButton: { minWidth: 52, minHeight: space.touch, alignItems: 'center', justifyContent: 'center' },
  heading: { ...type.title, flex: 1, textAlign: 'center', color: LIGHT, ...shade },
  finish: { ...type.button, fontSize: 15, color: LIGHT, ...shade },
  sceneLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, marginTop: 12 },
  sceneName: { ...type.sub, color: LIGHT, ...shade },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, overflow: 'hidden' },
  bookRow: { flexDirection: 'row', gap: space.s, alignItems: 'center' },
  bookPicker: { flex: 1, flexDirection: 'row', gap: space.m, alignItems: 'center', minHeight: 60 },
  emptyCover: { width: 44, height: 56, borderWidth: shape.hairline * 2, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  book: type.rowStrong,
  changeBook: type.caption,
  fold: { alignItems: 'center', gap: 2, minWidth: space.touch, minHeight: 48, justifyContent: 'center' },
  foldText: type.caption,
  timeArea: { alignItems: 'center' },
  // 시간: 숫자 폭 고정(tabular-nums), 자간은 글꼴 기본값
  time: { fontFamily: fonts.ui, fontSize: 48, lineHeight: 56, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  status: { ...type.caption, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  // 양옆 칸은 재생 단추를 뺀 폭을 반씩(글자 확대에서도 '창가의 빗소리'가 잘리지 않게, 넘치면 두 줄)
  side: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.xs },
  sideText: { ...type.caption, color: colors.ink, textAlign: 'center' },
  round: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  roundPressed: { transform: [{ scale: 0.96 }], backgroundColor: colors.accentPressed },
  control: { alignItems: 'center', justifyContent: 'center', gap: space.xs, minWidth: 64, minHeight: 56, paddingVertical: space.s },
  controlText: { ...type.caption, color: colors.ink, textAlign: 'center' },
  icon: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
  error: { ...type.sub, color: colors.danger, marginTop: space.m },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xl },
  dockTime: { minHeight: space.touch, justifyContent: 'center' },
  dockTimeText: { fontFamily: fonts.ui, fontSize: 34, lineHeight: 42, color: night.ink, fontVariant: ['tabular-nums'], includeFontPadding: false, ...shade },
  dockPlay: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
});
