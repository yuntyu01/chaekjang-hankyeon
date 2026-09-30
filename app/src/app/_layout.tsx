import { GowunBatang_400Regular, GowunBatang_700Bold, useFonts } from '@expo-google-fonts/gowun-batang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReadingPill, RecoveryDialog } from '@/features/reading/ActiveReading';
import { bootStores } from '@/store/boot';
import { BookArtProvider } from '@/ui/book3d/art';
import { PaperBackground } from '@/ui/PaperBackground';
import { colors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ GowunBatang_400Regular, GowunBatang_700Bold });
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    // 저장소를 다 불러온 뒤 첫 화면을 그린다(빈 책장이 잠깐 보였다가 책이 나타나지 않게)
    bootStores().finally(() => setBooted(true));
  }, []);
  const ready = (loaded || !!error) && booted;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <PaperBackground />
        <BookArtProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }}>
            <Stack.Screen name="reading/session" options={{ animation: 'fade', contentStyle: { backgroundColor: '#0E1016' } }} />
          </Stack>
          <ReadingPill />
          <RecoveryDialog />
        </BookArtProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
