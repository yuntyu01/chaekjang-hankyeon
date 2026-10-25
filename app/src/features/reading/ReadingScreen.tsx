// 독서 실행 화면: 장면이 화면 대부분, 연결된 책 제목은 작게, 아래에 시간·일시정지/재개·종료·장면·소리.
// 조작부를 접으면 작은 다시 열기 버튼만 남는다(다시 열어도 타이머는 멈추지 않는다).
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect } from 'expo-router';
import { BookOpen, AudioLines, Check, ChevronDown, ChevronUp, ChevronLeft, ImageIcon, Play, Volume1, Volume2, VolumeX } from '@/ui/icons';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { ButtonShading, PaperSurface } from '@/ui/PaperSurface';

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
  const { active } = useReading();
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
  const ms = useElapsed(focused && appActive && running);
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
          <PaperSurface color={colors.bg} radius={shape.sheet} grain={0.04} shaded={false} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.page, paddingTop: 18, paddingBottom: insets.bottom + 22 }}>
            <View style={st.bookRow}>
              <Pressable onPress={() => setBookPicker(true)} accessibilityRole="button" accessibilityLabel={bookId ? '책 변경' : '책 연결하기'} style={st.bookPicker}>
                {!soundOnly && bookId && lib.books[bookId] ? <LibraryCover lib={lib} id={bookId} width={58} /> : <View style={st.emptyCover}><BookOpen size={icon.size} color={colors.inkSoft} strokeWidth={icon.stroke} /></View>}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={st.book} numberOfLines={2}>{soundOnly ? '소리와 함께 쉬어 가요' : bookTitle(lib, bookId) ?? '책 연결하기'}</Text>
                  <Text style={st.changeBook}>{soundOnly ? '독서 시간은 기록하지 않아요' : bookId ? '책 변경' : '책 없이 시작해도 좋아요'}</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={st.fold} accessibilityRole="button" accessibilityLabel="조작부 접기"><ChevronDown size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /><Text style={st.foldText}>접기</Text></Pressable>
            </View>
            {!soundOnly ? <Pressable onPress={() => setControls('goal')} accessibilityRole="button" accessibilityLabel={`목표 시간 설정, ${settings.goalMin ? settings.goalMin + '분' : '자유롭게 시간 재기'}`} style={{ alignItems: 'center', marginTop: 0 }}>
              {active && !running ? <Text style={st.sub}>일시정지</Text> : null}
              <Text style={st.time} accessibilityLabel={`읽은 시간 ${clock(ms)}`}>{clock(ms)}</Text>
              {goalMs ? <Text style={st.goal}>{ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분`}</Text> : null}
            </Pressable> : null}
            <View style={st.controls}>
              <Pressable onPress={() => setControls('sound')} style={st.sideButton} accessibilityRole="button" accessibilityLabel="소리 설정"><AudioLines size={30} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
              <Pressable onPress={soundOnly ? () => audio.playing ? ambient.pause() : void ambient.play(scene) : !active ? start : () => running ? readingStore.pause() : readingStore.resume()} style={({ pressed }) => [st.round, pressed && st.roundPressed]} accessibilityRole="button" accessibilityLabel={soundOnly ? audio.playing ? '소리 멈추기' : '소리 재생' : !active ? '독서 시작' : running ? '일시정지' : '다시 읽기'}>
                <ButtonShading radius={40} />
                {(soundOnly ? audio.playing : running) ? <View style={{ flexDirection: 'row', gap: 7 }}><View style={st.pauseStroke} /><View style={st.pauseStroke} /></View> : <Play size={30} color={colors.onAccent} fill={colors.onAccent} style={{ marginLeft: 3 }} />}
              </Pressable>
              <Pressable onPress={() => setControls('scene')} style={st.sideButton} accessibilityRole="button" accessibilityLabel="장면 변경"><ImageIcon size={30} color={colors.ink} strokeWidth={icon.stroke} /></Pressable>
            </View>
            {audio.error ? <Text style={st.error}>{audio.error}</Text> : null}
            {soundOnly ? <Btn label="지금부터 독서 기록" kind="ghost" onPress={() => { start(); router.replace('/read'); }} /> : null}
          </ScrollView>
        </View>
      {!open ? (
        <Pressable onPress={() => setOpen(true)} style={[st.reopen, { bottom: insets.bottom + 18 }]} accessibilityRole="button" accessibilityLabel="조작부 열기"><ChevronUp size={icon.small} color={colors.ink} strokeWidth={icon.stroke} /><Text style={st.reopenText}>{soundOnly ? '조작부 열기' : clock(ms)}</Text></Pressable>
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
  bookPicker: { flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center', minHeight: 75 },
  emptyCover: { width: 54, height: 66, borderWidth: shape.hairline * 2, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  book: { ...type.rowStrong, fontSize: 18, lineHeight: 25 },
  changeBook: type.caption,
  fold: { alignItems: 'center', gap: 2, minWidth: space.touch, minHeight: 48, justifyContent: 'center' },
  foldText: type.caption,
  time: { fontFamily: fonts.ui, fontSize: 54, lineHeight: 66, color: colors.ink, letterSpacing: 0.5, includeFontPadding: false, marginTop: 6 },
  sub: { ...type.caption, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginTop: 16 },
  round: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 9, color: 'rgba(118,92,83,0.16)' }] },
  roundPressed: { transform: [{ scale: 0.96 }], backgroundColor: colors.accentPressed },
  goal: { ...type.caption, minHeight: 18, marginTop: 2, textAlign: 'center' },
  pauseStroke: { width: 6, height: 27, borderRadius: 3, backgroundColor: colors.onAccent },
  sideButton: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  control: { alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 64, minHeight: 58, paddingVertical: 8 },
  controlText: { ...type.caption, color: colors.ink, textAlign: 'center' },
  icon: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
  error: { ...type.sub, color: colors.danger, marginTop: 12 },
  reopen: { position: 'absolute', alignSelf: 'center', minHeight: space.touch, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.raised, ...shape.floatShadow },
  reopenText: { ...type.row, fontSize: 15 },
});
