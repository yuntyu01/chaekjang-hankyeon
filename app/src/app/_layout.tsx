import { GowunBatang_400Regular, GowunBatang_700Bold, useFonts } from '@expo-google-fonts/gowun-batang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RecoveryDialog } from '@/features/reading/ActiveReading';
import { MiniTimer } from '@/features/reading/MiniTimer';
import { bootStores } from '@/store/boot';
import { bootMark } from '@/ui/boot-trace';
import { BookArtProvider } from '@/ui/book3d/art';
import { PaperBackground } from '@/ui/PaperBackground';
import { LoadingScreen } from '@/ui/LoadingScreen';
import { colors } from '@/ui/theme';

// 화면 UI 글꼴: 나눔스퀘어라운드 R·B(본문·제목), EB(홈 머리글). assets/fonts/README.md
const NanumSquareRoundR = require('../../assets/fonts/NanumSquareRoundR.ttf');
const NanumSquareRoundEB = require('../../assets/fonts/NanumSquareRoundEB.ttf');
const NanumSquareRoundB = require('../../assets/fonts/NanumSquareRoundB.ttf');
const ReadingSerif = require('../../assets/fonts/NotoSerifKR-Regular.otf');
const ReadingSerifMedium = require('../../assets/fonts/NotoSerifKR-Medium.otf');
const ReadingSerifSemiBold = require('../../assets/fonts/NotoSerifKR-SemiBold.otf');

bootMark('js-layout-module');
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ GowunBatang_400Regular, GowunBatang_700Bold, NanumSquareRoundR, NanumSquareRoundEB, NanumSquareRoundB, ReadingSerif, ReadingSerifMedium, ReadingSerifSemiBold });
  const [booted, setBooted] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const finishLoading = useCallback(() => setLoadingVisible(false), []);
  useEffect(() => {
    // 저장소를 다 불러온 뒤 첫 화면을 그린다(빈 책장이 잠깐 보였다가 책이 나타나지 않게)
    bootStores().finally(() => {
      bootMark('stores-ready');
      setBooted(true);
    });
  }, []);
  const ready = (loaded || !!error) && booted;
  useEffect(() => {
    if (loaded || error) bootMark('fonts-ready', error ? 'error' : '');
  }, [loaded, error]);
  useEffect(() => { if (!loadingVisible) bootMark('splash-hide'); }, [loadingVisible]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <PaperBackground />
        {ready ? <BookArtProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
            <Stack.Screen name="reading/session" options={{ animation: 'fade', contentStyle: { backgroundColor: '#0E1016' } }} />
          </Stack>
          <MiniTimer />
          <RecoveryDialog />
        </BookArtProvider> : null}
        {loadingVisible ? <LoadingScreen ready={ready} onFinished={finishLoading} /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
