// 독서 실행 화면: 장면이 화면 대부분, 연결된 책 제목은 작게, 아래에 시간·일시정지/재개·종료·장면·소리.
// 조작부를 접으면 작은 다시 열기 버튼만 남는다(다시 열어도 타이머는 멈추지 않는다).
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronUp, ChevronLeft, ImageIcon, Pause, Play, Volume1, Volume2, VolumeX } from '@/ui/icons';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookTitle, clock, useElapsed } from '@/features/reading/ActiveReading';
import { Scene } from '@/features/reading/Scene';
import { ambient, SCENES, useAmbient } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore, useSettings } from '@/store/settings-store';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { LibraryCover } from '@/ui/BookVisual';
import { BookPicker } from '@/features/bookmark/BookPicker';
import { Btn, Chip, Row } from '@/ui/kit';
import { StatusBar } from 'expo-status-bar';

const LIGHT = '#F3EEE4';

export default function Session() {
  const { sound } = useLocalSearchParams<{ sound?: string }>();
  const soundOnly = sound === '1';
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
  const [controls, setControls] = useState<'sound' | 'scene' | null>(null);
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

  // 진행 중 독서가 없는데(끝냈거나 다른 기기) 독서 모드로 들어오면 읽기 탭으로
  useEffect(() => {
    if (!soundOnly && !active && !readingStore.get().pending) router.replace('/read');
  }, [soundOnly, active]);

  const finish = () => {
    readingStore.finish();
    router.replace('/reading/finish');
  };
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/read'));

  return (
    <View onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: '#182C44' }}>
      {focused ? <StatusBar style="light" /> : null}
      <Scene id={scene} animate={focused && appActive && !reduce} height={open ? Math.max(viewportHeight * 0.3, viewportHeight - panelHeight + 22) : viewportHeight} />
      <View style={[st.top, { paddingTop: insets.top + 6 }]}>
        <View style={st.topRow}>
          <Pressable onPress={leave} style={st.topButton} accessibilityRole="button" accessibilityLabel="나가기(독서는 계속)"><ChevronLeft size={26} color={LIGHT} strokeWidth={1.6} /></Pressable>
          <Text style={st.heading}>{soundOnly ? '소리 듣기' : running ? '읽는 중' : '잠시 쉬는 중'}</Text>
          <Pressable onPress={soundOnly ? () => { ambient.stop(); leave(); } : finish} style={st.topButton} accessibilityRole="button" accessibilityLabel={soundOnly ? '소리 끄고 나가기' : '독서 끝내기'}><Text style={st.finish}>종료</Text></Pressable>
        </View>
        <Text style={st.sceneName}>{scene === 'rain' ? '창가의 빗소리' : SCENES.find((s) => s.id === scene)?.name}</Text>
      </View>
      {open ? (
        <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={[st.panel, { maxHeight: height * 0.65 }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 21, paddingBottom: insets.bottom + 16 }}>
            <View style={st.bookRow}>
              {!soundOnly && active?.myBookId && lib.books[active.myBookId] ? <LibraryCover lib={lib} id={active.myBookId} width={43} /> : null}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={st.book}>{soundOnly ? '소리와 함께 쉬어 가요' : bookTitle(lib, active?.myBookId) ?? '책 연결 없이 읽는 중'}</Text>
                {!soundOnly ? <Pressable onPress={() => setBookPicker(true)} accessibilityRole="button" accessibilityLabel="책 변경" style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 20 }}><Text style={st.changeBook}>책 변경</Text></Pressable> : <Text style={st.sub}>독서 시간은 기록하지 않아요</Text>}
              </View>
              <Pressable onPress={() => setOpen(false)} style={st.fold} accessibilityRole="button" accessibilityLabel="조작부 접기"><ChevronDown size={21} color={colors.inkSoft} /><Text style={st.foldText}>접기</Text></Pressable>
            </View>
            <View style={st.rule} />
            {!soundOnly ? <View style={{ alignItems: 'center', marginTop: 16 }}>
              <Text style={st.sub}>{running ? '읽은 시간' : '일시정지'}</Text>
              <Text style={st.time} accessibilityLabel={`읽은 시간 ${clock(ms)}`}>{clock(ms)}</Text>
              {goalMs ? <Text style={st.sub}>{ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분까지 ${Math.ceil((goalMs - ms) / 60000)}분`}</Text> : null}
            </View> : null}
            <View style={st.controls}>
              <Pressable onPress={() => setControls('sound')} style={st.control} accessibilityRole="button" accessibilityLabel="소리 설정">{settings.muted || !audio.playing ? <VolumeX size={24} color={colors.inkSoft} /> : <Volume2 size={24} color={colors.inkSoft} />}<Text style={st.controlText}>소리</Text></Pressable>
              <Pressable onPress={soundOnly ? () => audio.playing ? ambient.pause() : void ambient.play(scene) : () => running ? readingStore.pause() : readingStore.resume()} style={st.round} accessibilityRole="button" accessibilityLabel={soundOnly ? audio.playing ? '소리 멈추기' : '소리 재생' : running ? '일시정지' : '다시 읽기'}>
                {(soundOnly ? audio.playing : running) ? <Pause size={30} color={LIGHT} fill={LIGHT} /> : <Play size={30} color={LIGHT} fill={LIGHT} />}
              </Pressable>
              <Pressable onPress={() => setControls('scene')} style={st.control} accessibilityRole="button" accessibilityLabel="장면 변경"><ImageIcon size={24} color={colors.inkSoft} /><Text style={st.controlText}>장면</Text></Pressable>
            </View>
            {audio.error ? <Text style={st.error}>{audio.error}</Text> : null}
            {soundOnly ? <Btn label="지금부터 독서 기록" kind="ghost" onPress={() => { readingStore.start(undefined); router.setParams({ sound: '0' }); }} /> : null}
          </ScrollView>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={[st.reopen, { bottom: insets.bottom + 18 }]} accessibilityRole="button" accessibilityLabel="조작부 열기"><ChevronUp size={18} color={colors.ink} /><Text style={st.reopenText}>{soundOnly ? '조작부 열기' : clock(ms)}</Text></Pressable>
      )}
      <BookPicker lib={lib} visible={bookPicker} allowNone onClose={() => setBookPicker(false)} onPick={(id) => { readingStore.setBook(id); setBookPicker(false); }} />
      <Modal visible={controls !== null} transparent animationType="fade" onRequestClose={() => setControls(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,18,15,0.32)' }} onPress={() => setControls(null)} accessibilityLabel="닫기" />
        <View style={[st.modal, { paddingBottom: insets.bottom + 18, maxHeight: height * 0.75 }]}>
          <ScrollView contentContainerStyle={{ gap: 16 }}>
            <Text style={st.modalTitle}>{controls === 'scene' ? '장면 변경' : '소리 설정'}</Text>
            {controls === 'scene' ? <View style={{ gap: 10 }}>{SCENES.map((sc) => <Btn key={sc.id} label={sc.id === 'rain' ? '창가의 빗소리' : sc.name} kind={scene === sc.id ? 'primary' : 'secondary'} onPress={() => { settingsStore.set({ scene: sc.id }); if (audio.playing || audio.scene) void ambient.play(sc.id); setControls(null); }} />)}</View> : <View style={{ gap: 14 }}>
              <Btn label={audio.playing ? '소리 멈추기' : '소리 재생'} onPress={() => audio.playing ? ambient.pause() : void ambient.play(scene)} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Pressable onPress={() => settingsStore.set({ muted: !settings.muted })} style={st.control} accessibilityRole="button" accessibilityLabel={settings.muted ? '음소거 해제' : '음소거'}>{settings.muted ? <VolumeX size={22} color={colors.ink} /> : <Volume2 size={22} color={colors.ink} />}<Text style={st.controlText}>{settings.muted ? '음소거 해제' : '음소거'}</Text></Pressable>
                <Pressable onPress={() => settingsStore.set({ volume: Math.max(0, Math.round((settings.volume - 0.2) * 10) / 10) })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 작게"><Volume1 size={22} color={colors.ink} /></Pressable>
                <Text style={st.sub}>{Math.round(settings.volume * 100)}%</Text>
                <Pressable onPress={() => settingsStore.set({ volume: Math.min(1, Math.round((settings.volume + 0.2) * 10) / 10), muted: false })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 크게"><Volume2 size={22} color={colors.ink} /></Pressable>
              </Row>
            </View>}
            <Btn label="닫기" kind="ghost" onPress={() => setControls(null)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, backgroundColor: 'rgba(11,26,43,0.12)', paddingBottom: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topButton: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, textAlign: 'center', color: LIGHT, fontFamily: fonts.round, fontSize: 19 },
  finish: { color: LIGHT, fontSize: 15 },
  sceneName: { color: LIGHT, opacity: 0.8, textAlign: 'center', fontSize: 13, marginTop: 5 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 23, borderTopRightRadius: 23, overflow: 'hidden' },
  bookRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  book: { color: colors.ink, fontFamily: fonts.round, fontSize: 18, lineHeight: 26 },
  changeBook: { color: colors.inkSoft, fontSize: 12, textDecorationLine: 'underline' },
  fold: { alignItems: 'center', gap: 3, minWidth: 44, minHeight: 48, justifyContent: 'center' },
  foldText: { color: colors.inkSoft, fontSize: 11 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: screenTheme.border, marginTop: 13 },
  time: { color: colors.ink, fontSize: 52, fontWeight: '300', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  sub: { color: colors.inkSoft, fontSize: 13, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', marginTop: 14 },
  round: { width: 74, height: 74, borderRadius: 37, backgroundColor: screenTheme.primary, alignItems: 'center', justifyContent: 'center' },
  control: { alignItems: 'center', justifyContent: 'center', gap: 7, minWidth: 64, minHeight: 58, paddingVertical: 8 },
  controlText: { color: colors.inkSoft, fontSize: 12, textAlign: 'center' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#A45140', fontSize: 13, marginTop: 12 },
  reopen: { position: 'absolute', alignSelf: 'center', minHeight: 44, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg },
  reopenText: { color: colors.ink, fontSize: 14, fontVariant: ['tabular-nums'] },
  modal: { backgroundColor: colors.bg, padding: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalTitle: { fontFamily: fonts.roundTitle, fontSize: 21, color: colors.ink },
});
