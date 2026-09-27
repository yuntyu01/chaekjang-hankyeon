// 외부 그림자. 책과 함께 회전하는 부모 밖(선반 좌표)에서 그려서, 기울어진 책도 그림자는 화면 기준 오른쪽 아래로 떨어진다.
// 플랫폼 그림자 API 대신 SVG 도형을 써서 iOS/Android 모양을 맞춘다. 터치·점유 폭에는 포함하지 않는다.
// 시안: 책 오른쪽 벽에 넓게 흐린 그림자. 바닥 쪽이 진하고(밝기 -20~30) 위로 사라진다. 색은 따뜻한 갈색. 가우시안 블러(SVG 필터).
import { memo, useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, FeGaussianBlur, Filter, G, LinearGradient, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

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

// 볼록 껍질(모노톤 체인). 책 윤곽과 오른쪽으로 옮긴 윤곽을 합친 '끌린 그림자' 모양을 만든다.
export function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function castShape(poly: Point[], dx: number, dy: number, sweep: number) {
  const moved = poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return hull([...moved, ...moved.map((p) => ({ x: p.x + sweep, y: p.y }))]);
}

export const ShelfShadows = memo(function ShelfShadows({ frames, scale: s, hiddenId, height, clear }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const X = (x: number) => (SHELF.sideMargin + x) * s;
  const Y = (y: number) => (clear + y - FLOOR) * s;
  const floorY = clear * s;
  const visible = frames.filter((f) => f.bookId !== hiddenId);
  const { dx, dy, sweep, opacity, blur, fade } = shadow.cast;
  const fadeTop = fade[fade.length - 1][0];
  return (
    <Svg style={StyleSheet.absoluteFill} width={DESIGN_WIDTH * s} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id={`${id}c`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={colors.shadow} stopOpacity={shadow.contact.opacity} />
          <Stop offset="1" stopColor={colors.shadow} stopOpacity={0} />
        </RadialGradient>
        {/* 바닥 쪽이 진하고 위로 옅어지는 그림자(theme.shadow.cast.fade) */}
        <LinearGradient id={`${id}cast`} x1="0" y1={floorY - fadeTop * s} x2="0" y2={floorY} gradientUnits="userSpaceOnUse">
          {[...fade].reverse().map(([h, k]) => (
            <Stop key={h} offset={1 - h / fadeTop} stopColor={colors.shadow} stopOpacity={opacity * k} />
          ))}
        </LinearGradient>
        {/* 진짜 가우시안 블러. 영역을 캔버스 전체로 잡아 흐린 가장자리가 잘리지 않게 한다 */}
        <Filter id={`${id}blur`} x={0} y={0} width={DESIGN_WIDTH * s} height={height} filterUnits="userSpaceOnUse">
          <FeGaussianBlur stdDeviation={blur * s} />
        </Filter>
        <ClipPath id={`${id}clip`}>
          <Rect x={0} y={0} width={DESIGN_WIDTH * s} height={floorY + SHELF.lip * s} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id}clip)`}>
        <G filter={`url(#${id}blur)`}>
          {visible.map((f) => (
            <Polygon key={f.bookId} points={castShape(f.poly, dx, dy, sweep).map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} fill={`url(#${id}cast)`} />
          ))}
        </G>
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
