import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet } from 'react-native';

import { settingsStore } from '@/store/settings-store';

const quietStart = require('../../assets/loading/quiet-start.png');

export function LoadingScreen({ ready, onFinished }: { ready: boolean; onFinished: () => void }) {
  const [imageReady, setImageReady] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!imageReady || !laidOut) return;
    // Keep the native splash until the supplied artwork has a painted layout.
    void SplashScreen.hideAsync();
    if (!ready) return;
    let cancelled = false;
    let fade: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => true).then((systemReduce) => {
      if (cancelled) return;
      const preference = settingsStore.get().reduceMotion;
      const reduce = preference === 'on' || (preference === 'system' && systemReduce);
      fade = Animated.timing(opacity, { toValue: 0, duration: reduce ? 0 : 180, useNativeDriver: true });
      fade.start(({ finished }) => { if (finished && !cancelled) onFinished(); });
    });
    return () => { cancelled = true; fade?.stop(); };
  }, [imageReady, laidOut, onFinished, opacity, ready]);

  return (
    <Animated.View
      style={[styles.screen, { opacity }]}
      onLayout={() => setLaidOut(true)}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="책장 한켠, 책장을 준비하고 있어요"
    >
      <StatusBar style="dark" />
      <Image
        source={quietStart}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        onLoadEnd={() => setImageReady(true)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: '#FCF8F1', zIndex: 10 },
  image: { width: '100%', height: '100%' },
});
