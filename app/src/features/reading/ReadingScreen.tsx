// 독서 실행 화면: 장면이 화면 대부분, 아래 조작부는 위에서부터 연결된 책 · 시간 · [분위기 | 재생/일시정지 | 목표] 한 줄.
// 분위기 = 장면+환경음 한 세트(하나로 고른다). 조작부 높이는 예전(2026-10-31 사용자 '하단부 높이 낮춰줘') 수준을 지킨다.
// 조작부를 접으면 [스피커 · 밝은 시간 · 재생·일시정지]가 남는다(다시 열어도 타이머는 멈추지 않는다). 스피커를 누르면 그 줄 위에 왼쪽부터 차는 소리 막대가 열리고,
// 한 번 더 누르거나 막대를 맨 왼쪽까지 내리면 음소거(2026-11-11 사용자 '시간 왼쪽에 스피커 … 한 번 더 누르거나 맨 밑이면 음소거',
// 2026-11-12 '위부터 말고 왼쪽부터, 검은 테두리 없이 아래 그라데이션을 조금 더 세게').
// 장면은 옆으로 밀어 바꾼다(접었을 때 아래 점이 지금 장면, 2026-11-11 사용자 '내린 거에 소리 크기랑 옆으로 넘기기').
// 2026-10-31 일반 UI 정돈: 조작부·시트는 정돈 변형(Tidy). 배경 장면(그림·영상)과 독서 세션 동작은 그대로.
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect } from 'expo-router';
import { BookOpen, AudioLines, Check, ChevronDown, ChevronLeft, Timer, Volume2, VolumeX } from '@/ui/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { bookTitle, clock, useElapsed } from '@/features/reading/ActiveReading';
import { Scene, SCENE_POSTERS } from '@/features/reading/Scene';
import { ambient, SCENES, useAmbient } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { saveAndStartOther } from '@/store/finish-reading';
import { settingsStore, useSettings, type SceneId } from '@/store/settings-store';
import { colors, fonts, icon, night, press, shape, space, type } from '@/ui/theme';
import { LibraryCover } from '@/ui/BookVisual';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { Btn, Choice, Sheet, Slider } from '@/ui/kit';
import { StatusBar } from 'expo-status-bar';
import { appAlert } from '@/ui/alert';

const LIGHT = night.ink;
const GOALS = [15, 30, 60] as const;
// 장면 이름(밤의 창가는 소리 쪽 이름으로 부른다: 머리줄·분위기 줄·시트가 같은 이름)
const sceneName = (id: string) => (id === 'rain' ? '창가의 빗소리' : SCENES.find((s) => s.id === id)?.name ?? '');

// 재생 삼각형: 모서리를 둥글게(같은 색 굵은 둥근 이음 윤곽). 눈으로 가운데 보이게 오른쪽으로 조금
export function PlayIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginLeft: size * 0.08 }}>
      <Path d="M8.6 7v10l8.2-5z" fill={color} stroke={color} strokeWidth={5} strokeLinejoin="round" />
    </Svg>
  );
}
// 일시정지: 끝이 둥근 두 막대
export function PauseIcon({ height, width, gap, color }: { height: number; width: number; gap: number; color: string }) {
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
  const { height, width, fontScale } = useWindowDimensions();
  // 좁은 화면·큰 글자: 장면은 1열, 목표 세 칸은 세로로(글자를 자르지 않게)
  const oneColumn = width < 340 || fontScale >= 1.5;
  // 장면 미리보기 크기는 화면 폭에서 직접 계산(그림 원본 크기가 칸 폭을 밀어내지 않게): 시트 좌우 여백 24·칸 사이 12·칸 안 여백 8
  const tileW = oneColumn ? width - 48 : (width - 48 - 12) / 2;
  const posterW = tileW - 16 - 3;
  const bigText = fontScale >= 1.6 || width < 330;
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  // 접었을 때 스피커 위 세로 소리 막대(열림)와 그 자리(접힌 조작 묶음 안 줄 위치·묶음 높이)
  const [volOpen, setVolOpen] = useState(false);
  const [rowW, setRowW] = useState(0);
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
    // 다른 책을 읽는 중에 이 책의 '읽기'를 눌렀다: 계속할지, 지금까지 저장하고 이 책으로 새로 읽을지 묻는다
    else if (lib.books[initialBookId] && active && active.myBookId !== initialBookId) askSwitch(initialBookId);
    // Consume the book-detail handoff so revisiting that same book can select it again.
    // Leaving and returning to the tab must retain the choice made inside the timer.
    router.setParams({ book: undefined });
  }, [initialBookId, lib.books, active]);
  useEffect(() => { if (!active && !soundOnly && !audio.playing) setOpen(true); }, [active, soundOnly, audio.playing]);
  useEffect(() => { if (open) setVolOpen(false); }, [open]);

  // 읽는 중에 다른 책을 골랐을 때: '이 기록의 책 정정'(같은 독서를 다른 책으로 바로잡기)과 '다른 책 읽기 시작'(지금까지 저장 후 새 타이머)을 나눈다.
  // 앞 책에서 잰 시간이 설명 없이 새 책으로 옮겨 가지 않게
  const askSwitch = (nextId: string | undefined) => {
    const cur = readingStore.get().active;
    if (!cur) return;
    const title = (id?: string) => (id ? bookTitle(lib, id) : undefined) ?? '책 없음';
    appAlert('읽는 책을 바꿀까요?', `지금 ‘${title(cur.myBookId)}’를 읽는 중이에요.`, [
      { text: '계속 읽기', style: 'cancel' },
      { text: '이 기록의 책을 바꾸기', onPress: () => { setDraftBookId(nextId); readingStore.setBook(nextId, nextId ? lib.books[nextId]?.currentPage : undefined); } },
      { text: `지금까지 저장하고 새로 읽기`, onPress: () => { setDraftBookId(nextId); void saveAndStartOther(nextId).catch((err) => appAlert('저장하지 못했어요', String((err as Error)?.message ?? err))); } },
    ]);
  };

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
    const id = draftBookId && lib.books[draftBookId] ? draftBookId : undefined;
    readingStore.start(id, id ? lib.books[id]?.currentPage : undefined);
    void ambient.play(settings.scene);
  };
  // 재생·일시정지: 펼친 조작부의 둥근 단추와 접었을 때 시간 옆 아이콘이 같은 동작이다
  const playing = soundOnly ? audio.playing : running;
  const playPause = soundOnly ? () => audio.playing ? ambient.pause() : void ambient.play(scene) : !active ? start : () => running ? readingStore.pause() : readingStore.resume();
  // 장면 고르기: 배경과 환경음이 함께 바뀐다(소리가 나는 중이면 새 장면 소리로 바로 바꾼다)
  const chooseScene = (id: SceneId) => {
    settingsStore.set({ scene: id });
    if (audio.playing) void ambient.play(id);
  };
  // 옆으로 밀어 장면 바꾸기: 왼쪽으로 밀면 다음 장면, 끝에서는 처음으로 돈다. 장면 칸 어디서나(조작부·버튼 위는 제외)
  const stepScene = (dir: 1 | -1) => {
    const i = SCENES.findIndex((x) => x.id === settingsStore.get().scene);
    chooseScene(SCENES[(i + dir + SCENES.length) % SCENES.length].id);
  };
  const stepRef = useRef(stepScene);
  stepRef.current = stepScene;
  const [swipe] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => { if (Math.abs(g.dx) > 60 || Math.abs(g.vx) > 0.5) stepRef.current(g.dx < 0 ? 1 : -1); },
  }));
  // 스피커: 닫혀 있으면 막대를 연다(음소거였으면 소리를 켠다), 열려 있으면 음소거하고 닫는다
  const tapSpeaker = () => {
    if (!volOpen) {
      if (settings.muted) settingsStore.set({ muted: false });
      setVolOpen(true);
    } else {
      settingsStore.set({ muted: true });
      setVolOpen(false);
    }
  };
  const pickGoal = (min: number | null) => {
    settingsStore.set({ goalMin: min });
    setControls(null);
  };
  // 퍼센트는 실제로 적용되는 값(끄는 중이면 그 값, 음소거면 '음소거')
  const volumeText = settings.muted && dragVolume === null ? '음소거' : `${Math.round((dragVolume ?? settings.volume) * 100)}%`;
  const playLabel = soundOnly ? audio.playing ? '소리 멈추기' : '소리 재생' : !active ? '독서 시작' : running ? '일시정지' : '다시 읽기';

  return (
    <>
    <View onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: '#182C44' }}>
      {focused ? <StatusBar style="light" /> : null}
      <Scene id={scene} animate={focused && appActive && !reduce} height={open ? Math.max(viewportHeight * 0.3, viewportHeight - panelHeight + 22) : viewportHeight} />
      <View style={StyleSheet.absoluteFill} {...swipe.panHandlers} />
      <View style={[st.top, { paddingTop: insets.top + 6 }]}>
        <View style={st.topRow}>
          <Pressable onPress={leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={active ? '나가기(독서는 계속)' : '책장으로'}><ChevronLeft size={28} color={LIGHT} strokeWidth={icon.stroke} /></Pressable>
          <Text style={st.heading}>{soundOnly ? '소리 듣기' : '읽기'}</Text>
          <Pressable onPress={soundOnly ? () => { ambient.stop(); leave(); } : active ? finish : leave} style={st.topButton} accessibilityRole="button" accessibilityLabel={soundOnly ? '소리 끄고 나가기' : active ? '독서 끝내기' : '닫기'}><Text style={st.finish}>{active || soundOnly ? '끝내기' : '닫기'}</Text></Pressable>
        </View>
        {/* 왼쪽 지금 장면(소리), 오른쪽 읽는 책 이름(2026-11-11 사용자 '좌측 위 벽난로, 우측엔 책 이름') */}
        <View style={st.sceneRow}>
          <View style={st.sceneLabel}><AudioLines size={icon.small} color={LIGHT} strokeWidth={1.9} /><Text style={st.sceneName}>{sceneName(scene)}</Text></View>
          {!soundOnly && bookId ? <Text style={[st.sceneName, st.bookName]} numberOfLines={1}>{bookTitle(lib, bookId)}</Text> : null}
        </View>
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
                {/* 상태 글은 시간 아래 여백 안에 겹쳐 둔다: 나타나도 시간이 움직이지 않고, 없을 때 시간 위아래 여백이 같다(2026-11-05 사용자 '위아래 여백이 애매') */}
                <Text style={st.status}>{active && !running ? '일시정지' : goalMs ? (ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분`) : ' '}</Text>
              </>}</Elapsed>
              {readingError ? <Text accessibilityRole="alert" style={[st.status, { position: 'relative', bottom: 0, color: colors.danger }]}>독서 시간을 기기에 저장하지 못했어요. 저장 공간을 확인해 주세요.</Text> : null}
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
            {/* 소리만 듣다가 기록 시작: 같은 장면에 타이머를 띄운다(읽기 탭은 2026-11-11부터 책 목록이라 그쪽으로 돌아가지 않는다) */}
            {soundOnly ? <Btn label="지금부터 독서 기록" kind="ghost" onPress={() => { start(); router.replace('/reading/session'); }} style={{ marginTop: space.s }} /> : null}
          </ScrollView>
        </View>
      {/* 접었을 때: 장면 아래쪽을 어둡게 물들이고 그 위에 장면 점, [스피커 · 밝은 시간 · 재생·일시정지]. 시간을 누르면 조작부가 다시 열린다 */}
      {!open ? (
        <>
          <Svg pointerEvents="none" width="100%" height={Math.round(viewportHeight * 0.42)} style={st.fade}>
            <Defs>
              <LinearGradient id="foldFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={night.fade} stopOpacity={0} />
                <Stop offset="0.5" stopColor={night.fade} stopOpacity={0.4} />
                <Stop offset="1" stopColor={night.fade} stopOpacity={0.76} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#foldFade)" />
          </Svg>
          {/* 소리 막대가 열린 동안 장면을 누르면 닫는다 */}
          {volOpen ? <Pressable style={StyleSheet.absoluteFill} onPress={() => setVolOpen(false)} accessibilityLabel="소리 크기 닫기" /> : null}
          <View style={[st.dock, { bottom: insets.bottom + 18 }]} pointerEvents="box-none">
            {/* 장면 점(지금 장면). 점을 눌러도 바뀌고, 화면 읽기에서는 위아래로 넘긴다 */}
            <View style={st.dots} accessible accessibilityRole="adjustable" accessibilityLabel={`장면, ${sceneName(scene)}`} accessibilityHint="옆으로 밀어 장면을 바꿔요" accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => stepScene(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
              {SCENES.map((sc) => (
                <Pressable key={sc.id} onPress={() => chooseScene(sc.id)} hitSlop={10} importantForAccessibility="no">
                  <View style={[st.dot, sc.id === scene && st.dotOn]} />
                </Pressable>
              ))}
            </View>
            {/* 소리 막대: 스피커 줄과 같은 폭으로 그 위에, 왼쪽(스피커 쪽)부터 찬다. 맨 왼쪽까지 내리면 음소거, 다시 밀면 켠다 */}
            {volOpen && rowW ? (
              <View style={{ width: rowW + 2 * space.s }}>
                <Slider
                  tone="night"
                  label="소리 크기"
                  value={dragVolume ?? (settings.muted ? 0 : settings.volume)}
                  valueText={volumeText}
                  onChange={(v) => { setDragVolume(v); ambient.preview(v); }}
                  onCommit={(v) => {
                    setDragVolume(null);
                    if (v <= 0.02) settingsStore.set({ muted: true });
                    else settingsStore.set({ volume: Math.round(v * 100) / 100, muted: false });
                  }}
                />
              </View>
            ) : null}
            <View style={st.dockRow} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
              <Pressable onPress={tapSpeaker} hitSlop={12} accessibilityRole="button" accessibilityState={{ expanded: volOpen }} accessibilityLabel={settings.muted ? '소리 꺼짐, 눌러서 소리 켜기' : volOpen ? `소리 ${Math.round(settings.volume * 100)}%, 눌러서 음소거` : `소리 ${Math.round(settings.volume * 100)}%, 눌러서 크기 조절`} style={st.dockPlay}>
                {settings.muted ? <VolumeX size={26} color={night.inkSoft} strokeWidth={icon.stroke} /> : <Volume2 size={26} color={night.ink} strokeWidth={icon.stroke} />}
              </Pressable>
              <Pressable onPress={() => { setVolOpen(false); setOpen(true); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="조작부 열기" style={st.dockTime}>
                <Text style={st.dockTimeText}>{soundOnly ? '조작부 열기' : <Elapsed running={ticking}>{clock}</Elapsed>}</Text>
              </Pressable>
              <Pressable onPress={playPause} hitSlop={12} accessibilityRole="button" accessibilityLabel={playLabel} style={st.dockPlay}>
                {playing ? <PauseIcon width={5} height={24} gap={6} color={night.ink} /> : <PlayIcon size={30} color={night.ink} />}
              </Pressable>
            </View>
          </View>

        </>
      ) : null}
      <BookPicker lib={lib} visible={bookPicker} allowNone onClose={() => setBookPicker(false)} onPick={(id) => { setBookPicker(false); if (active && active.myBookId !== id) askSwitch(id); else setDraftBookId(id); }} />
      {/* 목표 시간: 넓은 '목표 없이 읽기' 한 줄 + 15·30·60분 같은 크기 세 칸. 고르면 바로 적용하고 닫는다(경과 시간·책·회차·재생 상태는 그대로) */}
      <Sheet visible={controls === 'goal'} onClose={() => setControls(null)} title="목표 시간" description="목표를 바꿔도 읽은 시간은 유지돼요." scroll maxHeight={height * 0.85}>
        <Choice label="목표 없이 읽기" selected={settings.goalMin === null} onPress={() => pickGoal(null)} />
        <View style={[st.goalRow, bigText && { flexDirection: 'column' }]}>
          {GOALS.map((min) => <Choice key={min} label={`${min}분`} compact={!bigText} selected={settings.goalMin === min} onPress={() => pickGoal(min)} style={bigText ? undefined : { flex: 1 }} />)}
        </View>
      </Sheet>
      {/* 분위기: 장면 고르기(기존 영상의 정지 화면 미리보기, 2열·좁거나 글자가 크면 1열) → 소리 크기(음소거 + 슬라이더) → 소리만 듣기 */}
      <Sheet visible={controls === 'mood'} onClose={() => setControls(null)} title="분위기" description="장면과 소리가 함께 바뀌어요." scroll maxHeight={height * 0.88}>
        <View style={[st.sceneGrid, oneColumn && { flexDirection: 'column' }]}>
          {SCENES.map((sc) => {
            const on = scene === sc.id;
            return (
              <Pressable key={sc.id} onPress={() => chooseScene(sc.id)} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} accessibilityLabel={sceneName(sc.id)} style={({ pressed }) => [st.sceneTile, { width: tileW }, on && st.sceneTileOn, pressed && !on && { backgroundColor: colors.line }]}>
                <Image source={SCENE_POSTERS[sc.id]} style={[st.scenePoster, { width: posterW, height: Math.round(posterW / (oneColumn ? 2 : 4 / 3)) }]} resizeMode="cover" accessibilityIgnoresInvertColors />
                <Text style={[type.button, { color: colors.ink, marginTop: space.s }]}>{sceneName(sc.id)}</Text>
                {on ? <View style={st.sceneCheck} pointerEvents="none"><Check size={13} color={colors.onAccent} strokeWidth={3} /></View> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={st.volHead}>
          <Text style={type.label}>소리 크기</Text>
          <Text style={[type.sub, { fontVariant: ['tabular-nums'] }]} accessibilityLiveRegion="polite">{volumeText}</Text>
        </View>
        <View style={st.volRow}>
          <Pressable onPress={() => settingsStore.set({ muted: !settings.muted })} style={({ pressed }) => [st.mute, settings.muted && st.muteOn, pressed && press]} accessibilityRole="button" accessibilityState={{ selected: settings.muted }} accessibilityLabel={settings.muted ? '음소거 해제' : '음소거'}>
            {settings.muted ? <VolumeX size={icon.size} color={colors.accent} strokeWidth={icon.stroke} /> : <Volume2 size={icon.size} color={colors.ink} strokeWidth={icon.stroke} />}
          </Pressable>
          <Slider
            label="소리 크기"
            value={dragVolume ?? settings.volume}
            dim={settings.muted && dragVolume === null}
            valueText={volumeText}
            onChange={(v) => { setDragVolume(v); ambient.preview(v); }}
            onCommit={(v) => { setDragVolume(null); settingsStore.set({ volume: Math.round(v * 100) / 100, muted: false }); }}
          />
        </View>
        <View style={st.soundBlock}>
          <Text style={type.label}>{active ? '소리' : '소리만 듣기'}</Text>
          <Text style={[type.sub, { marginTop: space.xs }]}>{active ? '소리는 독서 타이머와 따로 켜고 꺼요. 읽은 시간은 그대로예요.' : '시간을 재지 않고 소리만 들어요. 독서 시간에는 쌓이지 않아요.'}</Text>
          <Btn label={audio.playing ? (active ? '소리 끄기' : '소리 멈추기') : active ? '소리 켜기' : '소리만 듣기'} kind="secondary" size="m" onPress={() => (audio.playing ? ambient.pause() : void ambient.play(scene))} style={{ marginTop: space.m }} />
        </View>
      </Sheet>
    </View>
    </>
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
  sceneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, paddingHorizontal: 14, marginTop: 12 },
  sceneLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  bookName: { flexShrink: 1, textAlign: 'right' },
  sceneName: { ...type.sub, color: LIGHT, ...shade },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, overflow: 'hidden' },
  bookRow: { flexDirection: 'row', gap: space.s, alignItems: 'center' },
  bookPicker: { flex: 1, flexDirection: 'row', gap: space.m, alignItems: 'center', minHeight: 60 },
  emptyCover: { width: 44, height: 56, borderWidth: shape.hairline * 2, borderColor: colors.border, borderRadius: 4, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  book: type.rowStrong,
  changeBook: type.caption,
  fold: { alignItems: 'center', gap: 2, minWidth: space.touch, minHeight: 48, justifyContent: 'center' },
  foldText: type.caption,
  timeArea: { alignItems: 'center', paddingTop: space.l, paddingBottom: space.l },
  // 시간: 숫자 폭 고정(tabular-nums), 자간은 글꼴 기본값
  time: { fontFamily: fonts.ui, fontSize: 48, lineHeight: 56, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  status: { ...type.caption, textAlign: 'center', position: 'absolute', bottom: -3, left: 0, right: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs },
  // 양옆 칸은 재생 단추를 뺀 폭을 반씩(글자 확대에서도 '창가의 빗소리'가 잘리지 않게, 넘치면 두 줄)
  side: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.xs },
  sideText: { ...type.caption, color: colors.ink, textAlign: 'center' },
  round: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  roundPressed: { transform: [{ scale: 0.96 }], backgroundColor: colors.accentPressed },
  goalRow: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  sceneGrid: { flexDirection: 'row', gap: space.m },
  sceneTile: { borderRadius: 14, padding: space.s, paddingBottom: space.m, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.bg },
  sceneTileOn: { borderColor: colors.accent },
  scenePoster: { borderRadius: 10, backgroundColor: colors.surface },
  sceneCheck: { position: 'absolute', top: 14, right: 14, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  volHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.xl },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.xs },
  mute: { width: space.touch, height: space.touch, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  muteOn: { borderWidth: shape.border, borderColor: colors.track },
  // 소리 묶음: 회색 상자 대신 위 얇은 선과 여백으로 나눈다(2026-11-01)
  soundBlock: { marginTop: space.xl, paddingTop: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  error: { ...type.sub, color: colors.danger, marginTop: space.m },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: space.s },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  dots: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(246,239,230,0.42)' },
  dotOn: { backgroundColor: night.ink },
  dockTime: { minHeight: space.touch, justifyContent: 'center' },
  dockTimeText: { fontFamily: fonts.ui, fontSize: 34, lineHeight: 42, color: night.ink, fontVariant: ['tabular-nums'], includeFontPadding: false, ...shade },
  dockPlay: { width: space.touch, height: space.touch, alignItems: 'center', justifyContent: 'center' },
});
