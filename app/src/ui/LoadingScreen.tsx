import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, type ImageSourcePropType, StyleSheet } from 'react-native';

import { settingsStore } from '@/store/settings-store';
import { bootMark } from '@/ui/boot-trace';
import { loadHomeSnapshot } from '@/ui/home-snapshot';

const quietStart = require('../../assets/loading/quiet-start.png');

// 지난 실행에서 찍어 둔 홈 사진이 있으면 그것을, 없으면 시작 화면 그림을 띄운다(사진 정보를 읽는 동안은 기기 시작 화면이 남아 있다).
// 사진이면 실제 책장이 다 그려진 뒤 겹쳐 바꾼다
export function LoadingScreen({ ready, onFinished }: { ready: boolean; onFinished: () => void }) {
  const [source, setSource] = useState<{ image: ImageSourcePropType; shot: boolean } | null>(null);
  useEffect(() => {
    void loadHomeSnapshot().then((uri) => setSource(uri ? { image: { uri }, shot: true } : { image: quietStart, shot: false }));
  }, []);
  const [imageReady, setImageReady] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const shot = !!source?.shot;

  useEffect(() => {
    if (!imageReady || !laidOut) return;
    // Keep the native splash until the supplied artwork has a painted layout.
    // 홈 사진이면 기기 시작 화면을 바로 걷는다(시작 직후 메인 스레드가 바빠 0.4초 흐려지기가 2초 넘게 늘어져 흐린 책장이 보였다)
    if (shot) SplashScreen.setOptions({ fade: false });
    void SplashScreen.hideAsync();
    if (!ready) return;
    let cancelled = false;
    let fade: Animated.CompositeAnimation | undefined;
    // 사진 아래 실제 책장은 그림이 도착한 뒤 줄을 다시 기록해야 보인다. 몇 프레임 기다려 빈 책이 비치지 않게 한다
    const settle = shot ? new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)))) : Promise.resolve();
    void settle.then(() => AccessibilityInfo.isReduceMotionEnabled().catch(() => true)).then((systemReduce) => {
      if (cancelled) return;
      const preference = settingsStore.get().reduceMotion;
      const reduce = preference === 'on' || (preference === 'system' && systemReduce);
      fade = Animated.timing(opacity, { toValue: 0, duration: reduce ? 0 : 180, useNativeDriver: true });
      fade.start(({ finished }) => { if (finished && !cancelled) onFinished(); });
    });
    return () => { cancelled = true; fade?.stop(); };
  }, [imageReady, laidOut, onFinished, opacity, ready, shot]);

  return (
    <Animated.View
      style={[styles.screen, { opacity }]}
      onLayout={() => setLaidOut(true)}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="책장 한켠, 책장을 준비하고 있어요"
    >
      <StatusBar style="dark" />
      {source ? (
        <Image
          source={source.image}
          style={styles.image}
          resizeMode={source.shot ? 'stretch' : 'contain'}
          fadeDuration={0}
          accessible={false}
          onLoad={() => { if (source.shot) bootMark('snapshot-shown'); }}
          onError={() => { if (source.shot) setSource({ image: quietStart, shot: false }); }}
          onLoadEnd={() => setImageReady(true)}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: '#FCF8F1', zIndex: 10 },
  image: { width: '100%', height: '100%' },
});
