// 독서 장면(교체용 임시 그림): 밤의 창가와 비 · 벽난로 · 조용한 방. Skia로 그린다.
// 움직임은 보이는 동안(animate)만 프레임을 돌린다(화면을 나가거나 동작 줄이기면 멈춘 한 장면).
import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { Image, useWindowDimensions } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import type { SceneId } from '@/store/settings-store';

export function Scene({ id, animate, height }: { id: SceneId; animate: boolean; height?: number }) {
  const { width: W, height: windowHeight } = useWindowDimensions();
  const H = height ?? windowHeight;
  const t = useSharedValue(0);
  const cb = useFrameCallback((f) => {
    t.value = f.timeSinceFirstFrame / 1000;
  }, false);
  useEffect(() => {
    cb.setActive(animate && id !== 'rain');
    return () => cb.setActive(false);
  }, [animate, cb, id]);
  if (id === 'rain') return <Image source={require('../../../assets/scenes/rain-window-reference-v2.png')} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} accessibilityIgnoresInvertColors />;
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} pointerEvents="none">
      {id === 'fire' ? <Fire W={W} H={H} t={t} /> : <Room W={W} H={H} t={t} />}
    </Canvas>
  );
}

type P = { W: number; H: number; t: { value: number } };

function Rain({ W, H, t }: P) {
  const win = { x: W * 0.12, y: H * 0.12, w: W * 0.76, h: H * 0.5 };
  const drops = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ x: ((i * 7919) % 1000) / 1000, sp: 0.5 + ((i * 131) % 100) / 120, len: 14 + ((i * 17) % 22), ph: ((i * 613) % 1000) / 1000 })), []);
  const path = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    for (const d of drops) {
      const y = ((d.ph + t.value * d.sp * 0.45) % 1) * (win.h + 40) - 20;
      const x = win.x + d.x * win.w;
      p.moveTo(x, win.y + y);
      p.lineTo(x - 3, win.y + y + d.len);
    }
    return p.detach();
  });
  const frame = Skia.PathBuilder.Make();
  frame.addRect(Skia.XYWHRect(win.x, win.y, win.w, win.h));
  frame.moveTo(win.x + win.w / 2, win.y);
  frame.lineTo(win.x + win.w / 2, win.y + win.h);
  frame.moveTo(win.x, win.y + win.h * 0.45);
  frame.lineTo(win.x + win.w, win.y + win.h * 0.45);
  const clip = Skia.XYWHRect(win.x, win.y, win.w, win.h);
  return (
    <Group>
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={['#1B2233', '#241F28', '#1A1512']} />
      </Rect>
      <Rect x={win.x} y={win.y} width={win.w} height={win.h}>
        <LinearGradient start={vec(0, win.y)} end={vec(0, win.y + win.h)} colors={['#23324A', '#35425A', '#2A2E3C']} />
      </Rect>
      <Circle cx={win.x + win.w * 0.72} cy={win.y + win.h * 0.22} r={W * 0.06} color="#E8DCC0" opacity={0.75} />
      <Group clip={clip}>
        <Path path={path} style="stroke" strokeWidth={1.2} color="rgba(210,220,235,0.45)" strokeCap="round" />
      </Group>
      <Path path={frame.detach()} style="stroke" strokeWidth={10} color="#15110F" />
      {/* 창턱과 작은 스탠드 불빛 */}
      <Rect x={win.x - 14} y={win.y + win.h} width={win.w + 28} height={16} color="#2B221C" />
      <Circle cx={W * 0.2} cy={H * 0.78} r={W * 0.45}>
        <RadialGradient c={vec(W * 0.2, H * 0.78)} r={W * 0.45} colors={['rgba(240,180,110,0.35)', 'rgba(240,180,110,0)']} />
      </Circle>
    </Group>
  );
}

function Fire({ W, H, t }: P) {
  const cx = W / 2;
  const cy = H * 0.66;
  const r = useDerivedValue(() => W * (0.36 + 0.03 * Math.sin(t.value * 7.3) + 0.02 * Math.sin(t.value * 13.1)));
  const op = useDerivedValue(() => 0.8 + 0.12 * Math.sin(t.value * 9.7) + 0.06 * Math.sin(t.value * 23.3));
  const flame = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const base = cy + W * 0.1;
    for (let k = 0; k < 5; k++) {
      const x = cx + (k - 2) * W * 0.05;
      const h = W * (0.16 + 0.05 * Math.sin(t.value * (5 + k) + k));
      p.moveTo(x - W * 0.04, base);
      p.quadTo(x - W * 0.03, base - h * 0.6, x + Math.sin(t.value * 3 + k) * 6, base - h);
      p.quadTo(x + W * 0.03, base - h * 0.6, x + W * 0.04, base);
      p.close();
    }
    return p.detach();
  });
  const arch = Skia.PathBuilder.Make();
  arch.moveTo(cx - W * 0.3, cy + W * 0.2);
  arch.lineTo(cx - W * 0.3, cy - W * 0.12);
  arch.quadTo(cx, cy - W * 0.34, cx + W * 0.3, cy - W * 0.12);
  arch.lineTo(cx + W * 0.3, cy + W * 0.2);
  arch.close();
  return (
    <Group>
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={['#1E1612', '#2A1C15', '#140E0B']} />
      </Rect>
      <Rect x={cx - W * 0.4} y={cy - W * 0.26} width={W * 0.8} height={W * 0.5} color="#3A2A21" />
      <Path path={arch.detach()} color="#0D0907" />
      <Circle cx={cx} cy={cy + W * 0.04} r={r} opacity={op}>
        <RadialGradient c={vec(cx, cy + W * 0.04)} r={W * 0.4} colors={['rgba(255,170,80,0.55)', 'rgba(255,120,50,0.15)', 'rgba(255,120,50,0)']} />
      </Circle>
      <Path path={flame} opacity={op}>
        <LinearGradient start={vec(0, cy + W * 0.1)} end={vec(0, cy - W * 0.12)} colors={['#FFD58A', '#FF9A45', 'rgba(255,90,40,0.2)']} />
      </Path>
      <Rect x={cx - W * 0.22} y={cy + W * 0.1} width={W * 0.44} height={W * 0.04} color="#4A2E1F" />
    </Group>
  );
}

function Room({ W, H, t }: P) {
  const glow = useDerivedValue(() => 0.32 + 0.04 * Math.sin(t.value * 0.8));
  return (
    <Group>
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(0, H)} colors={['#E9DFD0', '#DCCFBC', '#CDBFAA']} />
      </Rect>
      {/* 오후 창빛 */}
      <Path
        path={(() => {
          const p = Skia.PathBuilder.Make();
          p.moveTo(W * 0.55, H * 0.08);
          p.lineTo(W * 0.92, H * 0.08);
          p.lineTo(W * 0.78, H * 0.62);
          p.lineTo(W * 0.3, H * 0.62);
          p.close();
          return p.detach();
        })()}
        color="rgba(255,248,230,0.35)"
      />
      <Rect x={W * 0.1} y={H * 0.7} width={W * 0.8} height={10} color="#B59E82" />
      <Rect x={W * 0.18} y={H * 0.56} width={W * 0.08} height={H * 0.14} color="#8C7760" />
      <Circle cx={W * 0.22} cy={H * 0.5} r={W * 0.5} opacity={glow}>
        <RadialGradient c={vec(W * 0.22, H * 0.5)} r={W * 0.5} colors={['rgba(255,214,150,0.9)', 'rgba(255,214,150,0)']} />
      </Circle>
    </Group>
  );
}
