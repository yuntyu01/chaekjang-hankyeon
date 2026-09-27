// 책 그림자. 책과 함께 회전하는 부모 밖(선반 좌표)에서 그려서, 기울어진 책도 그림자는 화면 기준으로 떨어진다.
// 빛은 왼쪽 위: 책 윤곽을 오른쪽 아래로 옮겨 이은 모양(castShape)을 Skia 블러로 흐린다.
// react-native-svg의 안드로이드 블러는 반경이 25px로 잘려 넓은 그림자가 네모나게 나오므로 Skia를 쓴다.
// 터치·점유 폭에는 포함하지 않는다. 수치는 theme.shadow.cast.
import { BlurMask, Canvas, Group, LinearGradient, Oval, Path, Skia, rect, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DESIGN_WIDTH, SHELF } from '@/domain/geometry';
import { castShape, rgba } from '@/domain/shadow-shape';
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
  const flat = Math.abs(a.y - b.y) < 0.5;
  return { cx: flat ? (lo + hi) / 2 : ((lo + hi) / 2) * 0.4 + a.x * 0.6, half: (hi - lo) / 2 };
}

export function toPath(points: Point[]) {
  return Skia.Path.Polygon(points.map((q) => ({ x: q.x, y: q.y })), true);
}

export const ShelfShadows = memo(function ShelfShadows({ frames, scale: s, hiddenId, height, clear }: Props) {
  const floorY = clear * s;
  const width = DESIGN_WIDTH * s;
  const { layers, fade } = shadow.cast;
  const fadeTop = fade[fade.length - 1][0];
  const visible = useMemo(() => frames.filter((f) => f.bookId !== hiddenId), [frames, hiddenId]);
  const paths = useMemo(() => {
    const X = (x: number) => (SHELF.sideMargin + x) * s;
    const Y = (y: number) => (clear + y - FLOOR) * s;
    return layers.map((l) => visible.map((f) => toPath(castShape(f.poly, l.dx, l.dy).map((p) => ({ x: X(p.x), y: Y(p.y) })))));
  }, [visible, layers, s, clear]);
  // 바닥에서 위로 옅어지는 색(fade)
  const gradColors = fade.map(([, k]) => rgba(colors.shadow, k));
  const gradPos = fade.map(([h]) => h / fadeTop);
  return (
    <View style={[StyleSheet.absoluteFill, { height }]} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Group clip={rect(0, 0, width, floorY + SHELF.lip * s)}>
          {layers.map((l, i) => (
            <Group key={i} opacity={l.opacity}>
              {paths[i].map((p, j) => (
                <Path key={j} path={p}>
                  <LinearGradient start={vec(0, floorY)} end={vec(0, floorY - fadeTop * s)} colors={gradColors} positions={gradPos} />
                  <BlurMask blur={l.blur * s} style="normal" />
                </Path>
              ))}
            </Group>
          ))}
        </Group>
        {/* 책이 선반에 닿는 곳의 좁은 접촉 그림자 */}
        {visible.map((f) => {
          if (f.stackIndex > 0) return null;
          const c = contactOf(f.poly);
          const cx = (SHELF.sideMargin + c.cx + 1.5) * s;
          const rx = (c.half + shadow.contact.spread) * s;
          const ry = shadow.contact.height * s;
          return (
            <Oval key={f.bookId} x={cx - rx} y={floorY + 0.5 * s - ry} width={rx * 2} height={ry * 2} color={rgba(colors.shadow, shadow.contact.opacity)}>
              <BlurMask blur={1.6 * s} style="normal" />
            </Oval>
          );
        })}
      </Canvas>
    </View>
  );
});
