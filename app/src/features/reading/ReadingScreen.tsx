// 독서 실행 화면: 장면이 화면 대부분, 연결된 책 제목은 작게, 아래에 시간·일시정지/재개·종료·장면·소리.
// 조작부를 접으면 작은 다시 열기 버튼만 남는다(다시 열어도 타이머는 멈추지 않는다).
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect } from 'expo-router';
import { BookOpen, AudioLines, Check, ChevronDown, ChevronLeft, ImageIcon, Play, Volume1, Volume2, VolumeX } from '@/ui/icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { bookTitle, clock, useElapsed } from '@/features/reading/ActiveReading';
import { Scene } from '@/features/reading/Scene';
import { ambient, SCENES, useAmbient } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore, useSettings } from '@/store/settings-store';
import { colors, fonts, icon, night, shape, space, type } from '@/ui/screenTheme';
import { LibraryCover } from '@/ui/BookVisual';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { Btn, ListGroup, ListItem, Row, Sheet } from '@/ui/kit';
import { StatusBar } from 'expo-status-bar';
import { ButtonShading } from '@/ui/PaperSurface';

const LIGHT = night.ink;

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
  const [controls, setControls] = useState<'sound' | 'scene' | 'goal' | null>(null);
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
    <View onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: '#182C44' }}>
      {focused ? <StatusBar style="light" /> : null}
      <Scene id={scene} animate={focused && appActive && !reduce} height={open ? Math.max(viewportHeight * 0.3, viewportHeight - panelHeight + 22) : viewportHeight} />
      <View style={[st.top, { paddingTop: insets.top + 6 }]}>
        <View style={st.topRow}>
          <Pressable onPress={leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={active ? '나가기(독서는 계속)' : '책장으로'}><ChevronLeft size={28} color={LIGHT} strokeWidth={icon.stroke} /></Pressable>
          <Text style={st.heading}>{soundOnly ? '소리 듣기' : '읽기'}</Text>
          <Pressable onPress={soundOnly ? () => { ambient.stop(); leave(); } : active ? finish : leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={soundOnly ? '소리 끄고 나가기' : active ? '독서 끝내기' : '닫기'}><Text style={st.finish}>{active || soundOnly ? '끝내기' : '닫기'}</Text></Pressable>
        </View>
        <View style={st.sceneLabel}><AudioLines size={icon.small} color={LIGHT} strokeWidth={1.9} /><Text style={st.sceneName}>{scene === 'rain' ? '창가의 빗소리' : SCENES.find((s) => s.id === scene)?.name}</Text></View>
      </View>
      {/* Preserve the cover canvas and paper surface while folded. */}
        <View pointerEvents={open ? 'auto' : 'none'} onLayout={(e) => { if (open) setPanelHeight(e.nativeEvent.layout.height); }} style={[st.panel, { maxHeight: height * 0.65, display: open ? 'flex' : 'none' }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.page, paddingTop: 12, paddingBottom: insets.bottom + 14 }}>
            <View style={st.bookRow}>
              <Pressable onPress={() => setBookPicker(true)} accessibilityRole="button" accessibilityLabel={bookId ? '책 변경' : '책 연결하기'} style={st.bookPicker}>
                {!soundOnly && bookId && lib.books[bookId] ? <LibraryCover lib={lib} id={bookId} width={48} /> : <View style={st.emptyCover}><BookOpen size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} /></View>}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={st.book} numberOfLines={2}>{soundOnly ? '소리와 함께 쉬어 가요' : bookTitle(lib, bookId) ?? '책 연결하기'}</Text>
                  <Text style={st.changeBook}>{soundOnly ? '독서 시간은 기록하지 않아요' : bookId ? '책 변경' : '책 없이 시작해도 좋아요'}</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={st.fold} accessibilityRole="button" accessibilityLabel="조작부 접기"><ChevronDown size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /><Text style={st.foldText}>접기</Text></Pressable>
            </View>
            {!soundOnly ? <Pressable onPress={() => setControls('goal')} accessibilityRole="button" accessibilityLabel={`목표 시간 설정, ${settings.goalMin ? settings.goalMin + '분' : '자유롭게 시간 재기'}`} style={{ alignItems: 'center', marginTop: 0 }}>
              {active && !running ? <Text style={st.sub}>일시정지</Text> : null}
              <Elapsed running={ticking}>{(ms) => <>
                <Text style={st.time} accessibilityLabel={`읽은 시간 ${clock(ms)}`}>{clock(ms)}</Text>
                {goalMs ? <Text style={st.goal}>{ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분`}</Text> : null}
              </>}</Elapsed>
              {readingError ? <Text accessibilityRole="alert" style={st.sub}>독서 시간을 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.</Text> : null}
            </Pressable> : null}
            <View style={st.controls}>
              <Pressable onPress={() => setControls('sound')} style={st.sideButton} accessibilityRole="button" accessibilityLabel="소리 설정"><AudioLines size={30} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
              <Pressable onPress={playPause} style={({ pressed }) => [st.round, pressed && st.roundPressed]} accessibilityRole="button" accessibilityLabel={playLabel}>
                <ButtonShading radius={36} />
                {playing ? <View style={{ flexDirection: 'row', gap: 7 }}><View style={st.pauseStroke} /><View style={st.pauseStroke} /></View> : <Play size={30} color={colors.onAccent} fill={colors.onAccent} style={{ marginLeft: 3 }} />}
              </Pressable>
              <Pressable onPress={() => setControls('scene')} style={st.sideButton} accessibilityRole="button" accessibilityLabel="장면 변경"><ImageIcon size={30} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
            </View>
            {audio.error ? <Text style={st.error}>{audio.error}</Text> : null}
            {soundOnly ? <Btn label="지금부터 독서 기록" kind="ghost" onPress={() => { start(); router.replace('/read'); }} /> : null}
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
              {playing ? <View style={{ flexDirection: 'row', gap: 6 }}><View style={st.dockPause} /><View style={st.dockPause} /></View> : <Play size={28} color={night.ink} fill={night.ink} />}
            </Pressable>
          </View>
        </>
      ) : null}
      <BookPicker lib={lib} visible={bookPicker} allowNone onClose={() => setBookPicker(false)} onPick={(id) => { setDraftBookId(id); if (active) readingStore.setBook(id); setBookPicker(false); }} />
      <Sheet visible={controls !== null} onClose={() => setControls(null)} title={controls === 'scene' ? '장면 변경' : controls === 'goal' ? '목표 시간' : '소리 설정'} scroll maxHeight={height * 0.75}>
        {controls === 'goal' ? (
          <View>
            <Text style={[type.sub, { marginBottom: space.tight }]}>목표 없이 읽어도 좋아요. 목표를 바꿔도 읽은 시간은 유지돼요.</Text>
            <ListGroup>
              {[null, 15, 30, 60].map((min) => (
                <ListItem key={String(min)} label={min ? `${min}분` : '자유롭게 시간 재기'} selected={settings.goalMin === min} chevron={false} right={settings.goalMin === min ? <Check size={icon.size} color={colors.accent} strokeWidth={2} /> : null} onPress={() => { settingsStore.set({ goalMin: min }); setControls(null); }} />
              ))}
            </ListGroup>
          </View>
        ) : controls === 'scene' ? (
          <ListGroup>
            {SCENES.map((sc) => (
              <ListItem key={sc.id} label={sc.id === 'rain' ? '창가의 빗소리' : sc.name} selected={scene === sc.id} chevron={false} right={scene === sc.id ? <Check size={icon.size} color={colors.accent} strokeWidth={2} /> : null} onPress={() => { settingsStore.set({ scene: sc.id }); if (audio.playing) void ambient.play(sc.id); setControls(null); }} />
            ))}
          </ListGroup>
        ) : (
          <View style={{ gap: 14 }}>
            {!active ? <Text style={type.sub}>시간을 재지 않고 소리만 들을 수 있어요.</Text> : null}
            <Btn label={audio.playing ? '소리 멈추기' : '소리 재생'} onPress={() => audio.playing ? ambient.pause() : void ambient.play(scene)} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable onPress={() => settingsStore.set({ muted: !settings.muted })} style={st.control} accessibilityRole="button" accessibilityLabel={settings.muted ? '음소거 해제' : '음소거'}>{settings.muted ? <VolumeX size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /> : <Volume2 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}<Text style={st.controlText}>{settings.muted ? '음소거 해제' : '음소거'}</Text></Pressable>
              <Pressable onPress={() => settingsStore.set({ volume: Math.max(0, Math.round((settings.volume - 0.2) * 10) / 10) })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 작게"><Volume1 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
              <Text style={[type.row, { fontVariant: ['tabular-nums'] }]}>{Math.round(settings.volume * 100)}%</Text>
              <Pressable onPress={() => settingsStore.set({ volume: Math.min(1, Math.round((settings.volume + 0.2) * 10) / 10), muted: false })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 크게"><Volume2 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
            </Row>
          </View>
        )}
        <Btn label="닫기" kind="ghost" onPress={() => setControls(null)} style={{ marginTop: space.tight }} />
      </Sheet>
    </View>
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
  heading: { ...type.title, fontSize: 20, flex: 1, textAlign: 'center', color: LIGHT, ...shade },
  finish: { ...type.button, fontSize: 15, color: LIGHT, ...shade },
  sceneLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, marginTop: 12 },
  sceneName: { ...type.sub, color: LIGHT, ...shade },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, overflow: 'hidden' },
  bookRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  bookPicker: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 62 },
  emptyCover: { width: 44, height: 54, borderWidth: shape.hairline * 2, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  book: { ...type.rowStrong, fontSize: 18, lineHeight: 25 },
  changeBook: type.caption,
  fold: { alignItems: 'center', gap: 2, minWidth: space.touch, minHeight: 48, justifyContent: 'center' },
  foldText: type.caption,
  time: { fontFamily: fonts.ui, fontSize: 48, lineHeight: 58, color: colors.ink, letterSpacing: 0.5, fontVariant: ['tabular-nums'], includeFontPadding: false, marginTop: 2 },
  sub: { ...type.caption, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginTop: 10 },
  round: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 9, color: 'rgba(118,92,83,0.16)' }] },
  roundPressed: { transform: [{ scale: 0.96 }], backgroundColor: colors.accentPressed },
  goal: { ...type.caption, minHeight: 18, marginTop: 2, textAlign: 'center' },
  pauseStroke: { width: 6, height: 27, borderRadius: 3, backgroundColor: colors.onAccent },
  sideButton: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  control: { alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 64, minHeight: 58, paddingVertical: 8 },
  controlText: { ...type.caption, color: colors.ink, textAlign: 'center' },
  icon: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
  error: { ...type.sub, color: colors.danger, marginTop: 12 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 22 },
  dockTime: { minHeight: space.touch, justifyContent: 'center' },
  dockTimeText: { fontFamily: fonts.ui, fontSize: 34, lineHeight: 42, color: night.ink, fontVariant: ['tabular-nums'], includeFontPadding: false, ...shade },
  dockPlay: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
  dockPause: { width: 5, height: 24, borderRadius: 2.5, backgroundColor: night.ink },
});
