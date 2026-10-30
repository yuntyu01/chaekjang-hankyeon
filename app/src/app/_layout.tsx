import { GowunBatang_400Regular, GowunBatang_700Bold, useFonts } from '@expo-google-fonts/gowun-batang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecoveryDialog } from '@/features/reading/ActiveReading';
import { MiniTimer } from '@/features/reading/MiniTimer';
import { bootStores } from '@/store/boot';
import { bootMark } from '@/ui/boot-trace';
import { startProfile } from '@/ui/profile';
import { BookArtProvider } from '@/ui/book3d/art';
import { setSnapshotRoot, setSnapshotShown } from '@/ui/home-snapshot';
import { PaperBackground } from '@/ui/PaperBackground';
import { LoadingScreen } from '@/ui/LoadingScreen';
import { colors } from '@/ui/theme';

// 홈 머리글의 작고 둥근 고딕(나눔스퀘어라운드, assets/fonts/README.md)
const NanumSquareRoundEB = require('../../assets/fonts/NanumSquareRoundEB.ttf');
const NanumSquareRoundB = require('../../assets/fonts/NanumSquareRoundB.ttf');
const ReadingSerif = require('../../assets/fonts/NotoSerifKR-Regular.otf');
const ReadingSerifMedium = require('../../assets/fonts/NotoSerifKR-Medium.otf');
const ReadingSerifSemiBold = require('../../assets/fonts/NotoSerifKR-SemiBold.otf');

startProfile();
bootMark('js-layout-module');
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ GowunBatang_400Regular, GowunBatang_700Bold, NanumSquareRoundEB, NanumSquareRoundB, ReadingSerif, ReadingSerifMedium, ReadingSerifSemiBold });
  const [booted, setBooted] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const finishLoading = useCallback(() => {
    setSnapshotShown();
    setLoadingVisible(false);
  }, []);
  // 홈 사진(다음 실행의 시작 화면)을 찍을 화면: 시작 화면을 뺀 앱 전체
  const shotRoot = useRef<View>(null);
  useEffect(() => setSnapshotRoot(shotRoot), []);
  useEffect(() => {
    // 저장소를 다 불러온 뒤 첫 화면을 그린다(빈 책장이 잠깐 보였다가 책이 나타나지 않게)
    bootStores().finally(() => {
      bootMark('stores-ready');
      setBooted(true);
    });
  }, []);
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
  useEffect(() => {
    if (loaded || error) bootMark('fonts-ready', error ? 'error' : '');
  }, [loaded, error]);
  useEffect(() => {
    if (!loadingVisible) bootMark('splash-hide');
  }, [loadingVisible]);
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
          </BookArtProvider> : null}
        </View>
        {loadingVisible ? <LoadingScreen ready={ready && artReady} onFinished={finishLoading} /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
