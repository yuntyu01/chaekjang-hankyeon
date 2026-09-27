// 외부 그림자. 책과 함께 회전하는 부모 밖(선반 좌표)에서 그려서, 기울어진 책도 그림자는 화면 기준 오른쪽 아래로 떨어진다.
// 플랫폼 그림자 API 대신 SVG 도형을 써서 iOS/Android 모양을 맞춘다. 터치·점유 폭에는 포함하지 않는다.
import { memo, useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import type { BookFrame, Point } from '@/domain/shelf-scene';
import { shadow } from '@/ui/theme';

type Props = { frames: BookFrame[]; scale: number; hiddenId?: string | null; height: number };

const SHADOW_INK = '#3B2B18';

export function castShadowPolys(poly: Point[], dx: number, dy: number) {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

// 바닥에 닿는 변(가장 낮은 두 점)을 찾아 접촉 그림자 위치를 정한다.
export function contactOf(poly: Point[]) {
  const sorted = [...poly].sort((a, b) => b.y - a.y);
  const [a, b] = sorted;
  const lo = Math.min(a.x, b.x);
  const hi = Math.max(a.x, b.x);
  // 기울인 책은 바닥에 닿은 모서리 쪽으로 무게를 둔다.
  const pivotX = a.x;
  const cx = (lo + hi) / 2 * 0.4 + pivotX * 0.6;
  return { cx: Math.abs(a.y - b.y) < 0.5 ? (lo + hi) / 2 : cx, half: (hi - lo) / 2 };
}

const toPts = (poly: Point[], s: number) =>
  poly.map((p) => `${(SHELF.sideMargin + p.x) * s},${(SHELF.rowTopPad + p.y) * s}`).join(' ');

export const ShelfShadows = memo(function ShelfShadows({ frames, scale: s, hiddenId, height }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const floorY = (SHELF.rowTopPad + SHELF.clearHeight) * s;
  const visible = frames.filter((f) => f.bookId !== hiddenId);
  const { dx, dy, opacity, blurSteps } = shadow.cast;
  return (
    <Svg style={StyleSheet.absoluteFill} width={DESIGN_WIDTH * s} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id={`${id}c`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={SHADOW_INK} stopOpacity={shadow.contact.opacity} />
          <Stop offset="1" stopColor={SHADOW_INK} stopOpacity={0} />
        </RadialGradient>
        <ClipPath id={`${id}clip`}>
          <Rect x={0} y={0} width={DESIGN_WIDTH * s} height={floorY + SHELF.plankTop * s} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id}clip)`}>
        {visible.map((f) => {
          const pts = toPts(castShadowPolys(f.poly, dx, dy), s);
          return (
            <G key={f.bookId}>
              {blurSteps.map((w, i) => (
                <Polygon
                  key={i}
                  points={pts}
                  fill="none"
                  stroke={SHADOW_INK}
                  strokeOpacity={opacity / (blurSteps.length + 1)}
                  strokeWidth={w * s}
                  strokeLinejoin="round"
                />
              ))}
              <Polygon points={pts} fill={SHADOW_INK} fillOpacity={opacity} />
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
            cx={(SHELF.sideMargin + c.cx + 1) * s}
            cy={floorY + 1 * s}
            rx={(c.half + shadow.contact.spread) * s}
            ry={shadow.contact.height * s}
            fill={`url(#${id}c)`}
          />
        );
      })}
    </Svg>
  );
});
