import { GowunBatang_400Regular, GowunBatang_700Bold, useFonts } from '@expo-google-fonts/gowun-batang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { colors as screenColors } from '@/ui/screenTheme';

// 화면 UI 글꼴: Pretendard R·M·SB(시안과 같은 글꼴). 나눔스퀘어라운드 B·EB는 홈 머리글. assets/fonts/README.md
const PretendardRegular = require('../../assets/fonts/Pretendard-Regular.otf');
const PretendardMedium = require('../../assets/fonts/Pretendard-Medium.otf');
const PretendardSemiBold = require('../../assets/fonts/Pretendard-SemiBold.otf');
const NanumSquareRoundEB = require('../../assets/fonts/NanumSquareRoundEB.ttf');
const NanumSquareRoundB = require('../../assets/fonts/NanumSquareRoundB.ttf');
const ReadingSerif = require('../../assets/fonts/NotoSerifKR-Regular.otf');
const ReadingSerifMedium = require('../../assets/fonts/NotoSerifKR-Medium.otf');
const ReadingSerifSemiBold = require('../../assets/fonts/NotoSerifKR-SemiBold.otf');

bootMark('js-layout-module');
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ GowunBatang_400Regular, GowunBatang_700Bold, PretendardRegular, PretendardMedium, PretendardSemiBold, NanumSquareRoundEB, NanumSquareRoundB, ReadingSerif, ReadingSerifMedium, ReadingSerifSemiBold });
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const finishLoading = useCallback(() => setLoadingVisible(false), []);
  useEffect(() => {
    // 저장소를 다 불러온 뒤 첫 화면을 그린다(빈 책장이 잠깐 보였다가 책이 나타나지 않게)
    let active = true;
    bootStores().then(() => {
      if (!active) return;
      bootMark('stores-ready');
      setBooted(true);
    }).catch(() => {
      if (active) setBootError(true);
    });
    return () => { active = false; };
  }, [bootAttempt]);
  useEffect(() => {
    if (bootError) void SplashScreen.hideAsync();
  }, [bootError]);
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
        {bootError ? (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorTitle}>서재를 불러오지 못했어요</Text>
            <Text style={styles.errorBody}>저장된 기록을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.</Text>
            <Pressable accessibilityRole="button" style={styles.retry} onPress={() => { setBootError(false); setBootAttempt((n) => n + 1); }}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : loadingVisible ? <LoadingScreen ready={ready} onFinished={finishLoading} /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  errorTitle: { fontFamily: 'System', fontSize: 20, color: screenColors.ink, textAlign: 'center' },
  errorBody: { fontFamily: 'System', fontSize: 15, lineHeight: 23, color: screenColors.inkSoft, textAlign: 'center', marginTop: 12 },
  retry: { marginTop: 24, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12, backgroundColor: screenColors.accent },
  retryText: { fontFamily: 'System', color: screenColors.onAccent, fontSize: 16 },
});
