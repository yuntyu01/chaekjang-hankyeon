import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecoveryDialog } from '@/features/reading/ActiveReading';
import { NoRoomSheet } from '@/features/book/NoRoomSheet';
import { AlertHost } from '@/ui/alert';
import { MiniTimer } from '@/features/reading/MiniTimer';
import { bootStores } from '@/store/boot';
import { backfillCoverColors } from '@/services/cover-color-backfill';
import { bootMark } from '@/ui/boot-trace';
import { startProfile } from '@/ui/profile';
import { BookArtProvider } from '@/ui/book3d/art';
import { finishLightStages, lightStage, setLightArtReady, startLightStages } from '@/ui/light-stage';
import { warmLight } from '@/ui/SceneLight';
import { setSnapshotRoot, setSnapshotShown } from '@/ui/home-snapshot';
import { hideStartPhoto } from '../../modules/screen-capture';
import { PaperBackground } from '@/ui/PaperBackground';
import { LoadingScreen } from '@/ui/LoadingScreen';
import { colors } from '@/ui/theme';
import { colors as screenColors } from '@/ui/theme';

// 화면 UI 글꼴: Pretendard R·M·SB(시안과 같은 글꼴, 홈 머리글 포함). assets/fonts/README.md
const PretendardRegular = require('../../assets/fonts/Pretendard-Regular.otf');
const PretendardMedium = require('../../assets/fonts/Pretendard-Medium.otf');
const PretendardSemiBold = require('../../assets/fonts/Pretendard-SemiBold.otf');
const PretendardBold = require('../../assets/fonts/Pretendard-Bold.otf');
const ReadingSerif = require('../../assets/fonts/NotoSerifKR-Regular.otf');

startProfile();
bootMark('js-layout-module');
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ PretendardRegular, PretendardMedium, PretendardSemiBold, PretendardBold, ReadingSerif });
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const finishLoading = useCallback(() => {
    setSnapshotShown();
    setLoadingVisible(false);
    // 시작 화면이 걷혔다: 이제부터 새로 붙는 빛 겹은 차례를 기다리지 않는다(ui/light-stage)
    finishLightStages();
  }, []);
  // 홈 사진(다음 실행의 시작 화면)을 찍을 화면: 시작 화면을 뺀 앱 전체
  const shotRoot = useRef<View>(null);
  useEffect(() => setSnapshotRoot(shotRoot), []);
  useEffect(() => {
    // 저장소를 다 불러온 뒤 첫 화면을 그린다(빈 책장이 잠깐 보였다가 책이 나타나지 않게)
    let active = true;
    // 굽기 셰이더를 서재를 읽는 동안 미리 컴파일한다(UI 스레드가 노는 때, SceneLight warmLight)
    warmLight();
    bootStores().then(() => {
      if (!active) return;
      bootMark('stores-ready');
      setBooted(true);
      // 첫 화면을 그린 뒤 뒤에서(첫 화면이 늦어지지 않게)
      setTimeout(() => { void backfillCoverColors().catch((e: unknown) => console.warn('표지 색 맞추기 실패(다음 시작 때 다시)', String(e))); }, 3000);
    }).catch((e) => {
      // 화면에는 짧은 안내만, 원인은 기기 로그로(배포 번들에서도 남는다)
      console.warn('boot failed', String((e as Error)?.stack ?? e));
      if (active) setBootError(true);
    });
    return () => { active = false; };
  }, [bootAttempt]);
  useEffect(() => {
    if (bootError) { hideStartPhoto(); void SplashScreen.hideAsync(); }
  }, [bootError]);
  const ready = (loaded || !!error) && booted;
  // 첫 책장의 책 그림(글꼴·원본 그림·입힌 장정 그림, 책마다 기록)이 다 되면 시작 화면을 걷는다(그림 표지 책만 빈자리로 보이다 나타나지 않게).
  // 그림 하나를 못 읽어도 멈추지 않게 15초 뒤에는 걷는다(느린 에뮬레이터에서 첫 기록이 20초 가까이 걸린 적이 있어 넉넉히)
  const [artReady, setArtReady] = useState(false);
  const onArtReady = useCallback(() => setArtReady(true), []);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setArtReady(true), 15000);
    return () => clearTimeout(t);
  }, [ready]);
  // 첫 화면 빛은 시작 화면 뒤에서 겹마다 차례로 처음 그린다(ui/light-stage: 셰이더 컴파일이 한 프레임에 몰리지 않게).
  // 붙은 겹을 모두 연 뒤에 시작 화면을 걷는다(빛 없는 책이 비치지 않게). 책은 그림이 다 된 뒤 붙으므로 그때까지는 끝내지 않는다.
  // 빛 겹이 없는 화면으로 시작하면(딥 링크) 조금 뒤 그냥 끝낸다
  const lightDone = useSyncExternalStore(lightStage.subscribe, lightStage.done);
  useEffect(() => {
    if (artReady) setLightArtReady();
  }, [artReady]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(startLightStages, 1500);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    if (loaded || error) bootMark('fonts-ready', error ? 'error' : '');
  }, [loaded, error]);
  useEffect(() => { if (!loadingVisible) bootMark('splash-hide'); }, [loadingVisible]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <View ref={shotRoot} collapsable={false} style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar style="dark" />
          <PaperBackground />
          {ready ? <BookArtProvider onReady={onArtReady}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
              <Stack.Screen name="reading/session" options={{ animation: 'fade', contentStyle: { backgroundColor: '#0E1016' } }} />
            </Stack>
            <MiniTimer />
            <RecoveryDialog />
            <NoRoomSheet />
            <AlertHost />
          </BookArtProvider> : null}
        </View>
        {bootError ? (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorTitle}>서재를 불러오지 못했어요</Text>
            <Text style={styles.errorBody}>저장된 기록을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.</Text>
            <Pressable accessibilityRole="button" style={styles.retry} onPress={() => { setBootError(false); setBootAttempt((n) => n + 1); }}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : loadingVisible ? <LoadingScreen ready={ready && artReady && lightDone} step={!ready ? 1 : !(artReady && lightDone) ? 2 : 3} onFinished={finishLoading} /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  errorTitle: { fontFamily: 'System', fontSize: 20, color: screenColors.ink, textAlign: 'center' },
  errorBody: { fontFamily: 'System', fontSize: 15, lineHeight: 23, color: screenColors.inkSoft, textAlign: 'center', marginTop: 12 },
  retry: { marginTop: 24, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: screenColors.border, backgroundColor: screenColors.raised },
  retryText: { fontFamily: 'System', color: screenColors.ink, fontSize: 16 },
});
