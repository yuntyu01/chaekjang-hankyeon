import { GowunBatang_400Regular, GowunBatang_700Bold, useFonts } from '@expo-google-fonts/gowun-batang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PaperBackground } from '@/ui/PaperBackground';
import { colors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({ GowunBatang_400Regular, GowunBatang_700Bold });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <PaperBackground />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
