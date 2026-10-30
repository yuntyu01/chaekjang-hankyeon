import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';

import { settingsStore } from '@/store/settings-store';
import { bootMark } from '@/ui/boot-trace';
import { loadHomeSnapshot } from '@/ui/home-snapshot';

const quietStart = require('../../assets/loading/quiet-start.png');
// 시작 화면 그림(853×1844, 가운데 맞춤)에서 점 세 개 자리. 그림에서는 점을 지웠고 준비 단계(step)만큼 채워 그린다
const ART = { w: 853, h: 1844 };
const DOTS = { cx: 426, cy: 1286, gap: 37.5, d: 16 };

// 지난 실행에서 찍어 둔 홈 사진이 있으면 그것을, 없으면 시작 화면 그림을 띄운다(사진 정보를 읽는 동안은 기기 시작 화면이 남아 있다).
// 사진이면 실제 책장이 다 그려진 뒤 겹쳐 바꾼다
// step: 1 서재 불러오는 중 · 2 책 그림 그리는 중 · 3 다 됨(시작 화면 그림의 점으로만 보인다)
export function LoadingScreen({ ready, step, onFinished }: { ready: boolean; step: 1 | 2 | 3; onFinished: () => void }) {
  const [source, setSource] = useState<{ image: ImageSourcePropType; shot: boolean } | null>(null);
  useEffect(() => {
    void loadHomeSnapshot().then((uri) => setSource(uri ? { image: { uri }, shot: true } : { image: quietStart, shot: false }));
  }, []);
  const [imageReady, setImageReady] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const laidOut = !!size;
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
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="책장 한켠, 책장을 준비하고 있어요"
      accessibilityValue={{ min: 0, max: 3, now: step }}
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
      {source && !source.shot && imageReady && size ? <Dots step={step} w={size.w} h={size.h} /> : null}
    </Animated.View>
  );
}

function Dots({ step, w, h }: { step: number; w: number; h: number }) {
  const k = Math.min(w / ART.w, h / ART.h);
  const x0 = (w - ART.w * k) / 2;
  const y0 = (h - ART.h * k) / 2;
  const d = DOTS.d * k;
  return <>
    {[0, 1, 2].map((i) => (
      <View
        key={i}
        style={{ position: 'absolute', left: x0 + (DOTS.cx + (i - 1) * DOTS.gap) * k - d / 2, top: y0 + DOTS.cy * k - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: i < step ? '#7C6253' : '#DBCDC1' }}
      />
    ))}
  </>;
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: '#FCF8F1', zIndex: 10 },
  image: { width: '100%', height: '100%' },
});
