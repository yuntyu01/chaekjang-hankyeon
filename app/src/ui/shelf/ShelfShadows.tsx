// 외부 그림자. 책과 함께 회전하는 부모 밖(선반 좌표)에서 그려서, 기울어진 책도 그림자는 화면 기준 오른쪽 아래로 떨어진다.
// 플랫폼 그림자 API 대신 SVG 도형을 써서 iOS/Android 모양을 맞춘다. 터치·점유 폭에는 포함하지 않는다.
// 시안: 벽에 떨어지는 그림자는 바닥 쪽이 가장 진하고(밝기 약 -25%) 위로 갈수록 옅다. 색은 따뜻한 갈색.
import { memo, useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, LinearGradient, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { BookFrame, Point } from '@/domain/shelf-scene';
import { colors, shadow } from '@/ui/theme';

type Props = { frames: BookFrame[]; scale: number; hiddenId?: string | null; height: number; clear: number };

const FLOOR = SHELF.clearHeight;

// 바닥에 닿는 변(가장 낮은 두 점)을 찾아 접촉 그림자 위치를 정한다.
export function contactOf(poly: Point[]) {
  const sorted = [...poly].sort((a, b) => b.y - a.y);
  const [a, b] = sorted;
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  // 기울인 책은 바닥에 닿은 모서리 쪽으로 무게를 둔다.
  const flat = Math.abs(a.y - b.y) < 0.5;
  return { cx: flat ? (lo + hi) / 2 : ((lo + hi) / 2) * 0.4 + a.x * 0.6, half: (hi - lo) / 2 };
}

export const ShelfShadows = memo(function ShelfShadows({ frames, scale: s, hiddenId, height, clear }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const X = (x: number) => (SHELF.sideMargin + x) * s;
  const Y = (y: number) => (clear + y - FLOOR) * s;
  const floorY = clear * s;
  const visible = frames.filter((f) => f.bookId !== hiddenId);
  const { dx, dy, opacity, blurSteps } = shadow.cast;
  return (
    <Svg style={StyleSheet.absoluteFill} width={DESIGN_WIDTH * s} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id={`${id}c`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={colors.shadow} stopOpacity={shadow.contact.opacity} />
          <Stop offset="1" stopColor={colors.shadow} stopOpacity={0} />
        </RadialGradient>
        {/* 위는 옅고 바닥 쪽이 진한 그림자 */}
        <LinearGradient id={`${id}cast`} x1="0" y1="0" x2="0" y2={floorY} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.shadow} stopOpacity={opacity * 0.12} />
          <Stop offset="0.6" stopColor={colors.shadow} stopOpacity={opacity * 0.6} />
          <Stop offset="1" stopColor={colors.shadow} stopOpacity={opacity} />
        </LinearGradient>
        <ClipPath id={`${id}clip`}>
          <Rect x={0} y={0} width={DESIGN_WIDTH * s} height={floorY + SHELF.lip * s} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id}clip)`}>
        {visible.map((f) => {
          const pts = f.poly.map((p) => `${X(p.x + dx)},${Y(p.y + dy)}`).join(' ');
          // 시안: 기울인 책·누운 책·표지 책 옆에만 그림자가 눈에 띄고, 나란히 선 책 사이는 거의 없다
          const strong = f.tilt !== 0 || f.pose !== 'spine';
          return (
            <G key={f.bookId} opacity={strong ? 1 : 0.4}>
              {blurSteps.map((w, i) => (
                <Polygon key={i} points={pts} fill="none" stroke={`url(#${id}cast)`} strokeOpacity={1 / (blurSteps.length + 2)} strokeWidth={w * s} strokeLinejoin="round" />
              ))}
              {/* 가운데는 옅게: 경계가 또렷한 상자처럼 보이지 않게 */}
              <Polygon points={pts} fill={`url(#${id}cast)`} fillOpacity={0.5} />
            </G>
          );
        })}
      </G>
      {visible.map((f) => {
        if (f.stackIndex > 0) return null;
        const c = contactOf(f.poly);
        return (
          <Ellipse
            key={`c-${f.bookId}`}
            cx={X(c.cx + 1.5)}
            cy={floorY + 0.5 * s}
            rx={(c.half + shadow.contact.spread) * s}
            ry={shadow.contact.height * s}
            fill={`url(#${id}c)`}
          />
        );
      })}
    </Svg>
  );
});
