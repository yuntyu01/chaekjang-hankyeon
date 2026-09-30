// 독서 실행 화면: 장면이 화면 대부분, 연결된 책 제목은 작게, 아래에 시간·일시정지/재개·종료·장면·소리.
// 조작부를 접으면 작은 다시 열기 버튼만 남는다(다시 열어도 타이머는 멈추지 않는다).
// 소리만 듣기(sound=1)는 타이머 없이 소리만: 독서 시간으로 기록하지 않는다.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronUp, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bookTitle, clock, useElapsed } from '@/features/reading/ActiveReading';
import { Scene } from '@/features/reading/Scene';
import { ambient, SCENES, TEMP_ASSETS, useAmbient } from '@/services/ambient';
import { useLibrary } from '@/store/library-store';
import { readingStore, useReading } from '@/store/reading-store';
import { settingsStore, useSettings } from '@/store/settings-store';
import { fonts } from '@/ui/theme';

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
    <View style={{ flex: 1, backgroundColor: '#111' }}>
      <Scene id={scene} animate={focused && appActive && !reduce} />
      <View style={[st.top, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={leave} hitSlop={12} accessibilityRole="button" accessibilityLabel="나가기(독서는 계속)">
          <ChevronDown size={26} color={LIGHT} strokeWidth={1.6} />
        </Pressable>
        <Text style={st.book} numberOfLines={1}>
          {soundOnly ? '소리만 듣는 중 · 독서 시간은 기록하지 않아요' : (bookTitle(lib, active?.myBookId) ?? '책 연결 없이 읽는 중')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {open ? (
        <View style={[st.panel, { paddingBottom: insets.bottom + 16 }]}>
          {soundOnly ? null : (
            <>
              <Text style={st.time} accessibilityLabel={`읽은 시간 ${clock(ms)}`}>
                {clock(ms)}
              </Text>
              {goalMs ? <Text style={st.sub}>{ms >= goalMs ? `목표 ${settings.goalMin}분을 채웠어요` : `목표 ${settings.goalMin}분까지 ${Math.ceil((goalMs - ms) / 60000)}분`}</Text> : <Text style={st.sub}>{running ? '읽는 중' : '일시정지'}</Text>}
              <View style={st.row}>
                <Pressable onPress={() => (running ? readingStore.pause() : readingStore.resume())} style={st.round} accessibilityRole="button" accessibilityLabel={running ? '일시정지' : '다시 읽기'}>
                  {running ? <Pause size={26} color="#111" fill="#111" /> : <Play size={26} color="#111" fill="#111" />}
                </Pressable>
                <Pressable onPress={finish} style={st.end} accessibilityRole="button" accessibilityLabel="독서 끝내기">
                  <Text style={st.endText}>끝내기</Text>
                </Pressable>
              </View>
            </>
          )}
          {/* 장면·소리 */}
          <View style={[st.row, { marginTop: 14 }]}>
            {SCENES.map((sc) => (
              <Pressable
                key={sc.id}
                onPress={() => {
                  settingsStore.set({ scene: sc.id });
                  if (audio.playing || audio.scene) void ambient.play(sc.id);
                }}
                style={[st.chip, scene === sc.id && st.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: scene === sc.id }}>
                <Text style={[st.chipText, scene === sc.id && { color: '#111' }]}>{sc.name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[st.row, { marginTop: 10 }]}>
            <Pressable
              onPress={() => (audio.playing ? ambient.pause() : void ambient.play(scene))}
              style={st.chip}
              accessibilityRole="button"
              accessibilityLabel={audio.playing ? '소리 멈추기' : '소리 재생'}>
              <Text style={st.chipText}>{audio.playing ? `${SCENES.find((x) => x.id === scene)?.sound} 재생 중 · 멈추기` : '소리 켜기'}</Text>
            </Pressable>
            <Pressable onPress={() => settingsStore.set({ muted: !settings.muted })} style={st.icon} accessibilityRole="button" accessibilityLabel={settings.muted ? '음소거 해제' : '음소거'}>
              {settings.muted ? <VolumeX size={20} color={LIGHT} /> : <Volume2 size={20} color={LIGHT} />}
            </Pressable>
            <Pressable onPress={() => settingsStore.set({ volume: Math.max(0, Math.round((settings.volume - 0.2) * 10) / 10) })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 작게">
              <Volume1 size={20} color={LIGHT} />
            </Pressable>
            <Text style={st.vol}>{settings.muted ? '음소거' : `${Math.round(settings.volume * 100)}%`}</Text>
            <Pressable onPress={() => settingsStore.set({ volume: Math.min(1, Math.round((settings.volume + 0.2) * 10) / 10), muted: false })} style={st.icon} accessibilityRole="button" accessibilityLabel="소리 크게">
              <Volume2 size={20} color={LIGHT} />
            </Pressable>
          </View>
          {audio.error ? <Text style={[st.sub, { color: '#F2B8A8' }]}>{audio.error}</Text> : null}
          {TEMP_ASSETS ? <Text style={[st.sub, { marginTop: 8 }]}>임시 장면·소리</Text> : null}
          {soundOnly ? (
            <View style={[st.row, { marginTop: 14 }]}>
              <Pressable
                onPress={() => {
                  readingStore.start(undefined);
                  router.setParams({ sound: '0' });
                }}
                style={st.end}
                accessibilityRole="button">
                <Text style={st.endText}>지금부터 독서 기록</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  ambient.stop();
                  leave();
                }}
                style={st.end}
                accessibilityRole="button">
                <Text style={st.endText}>소리 끄고 나가기</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={() => setOpen(false)} style={st.fold} accessibilityRole="button" accessibilityLabel="조작부 접기">
            <ChevronDown size={20} color={LIGHT} />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={[st.reopen, { bottom: insets.bottom + 18 }]} accessibilityRole="button" accessibilityLabel="조작부 열기">
          <ChevronUp size={18} color={LIGHT} />
          {soundOnly ? null : <Text style={st.reopenText}>{clock(ms)}</Text>}
        </Pressable>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  book: { flex: 1, textAlign: 'center', color: LIGHT, fontFamily: fonts.serif, fontSize: 14, opacity: 0.9 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 20, paddingHorizontal: 20, backgroundColor: 'rgba(14,12,11,0.62)', borderTopLeftRadius: 22, borderTopRightRadius: 22, alignItems: 'center' },
  time: { color: LIGHT, fontSize: 52, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  sub: { color: '#BDB6AA', fontSize: 13, marginTop: 2, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 },
  round: { width: 64, height: 64, borderRadius: 32, backgroundColor: LIGHT, alignItems: 'center', justifyContent: 'center' },
  end: { height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(243,238,228,0.5)', paddingHorizontal: 20, justifyContent: 'center' },
  endText: { color: LIGHT, fontSize: 15 },
  chip: { height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(243,238,228,0.35)', paddingHorizontal: 12, justifyContent: 'center' },
  chipOn: { backgroundColor: LIGHT, borderColor: LIGHT },
  chipText: { color: LIGHT, fontSize: 13 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  vol: { color: '#BDB6AA', fontSize: 12.5, width: 50, textAlign: 'center' },
  fold: { marginTop: 10, padding: 6 },
  reopen: { position: 'absolute', alignSelf: 'center', height: 36, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(14,12,11,0.55)' },
  reopenText: { color: LIGHT, fontSize: 13.5, fontVariant: ['tabular-nums'] },
});
