// 선반 바깥 그림자(선반 PNG에서 분리됨). 빛은 왼쪽 위(책 그림자와 같은 방향).
// 나무판 윤곽을 오른쪽 아래로 옮겨 이은 모양을 Skia 블러로 흐린다. 접촉층과 긴 감쇠층은 theme.shelfShadow에서 조정한다.
// 판 뒤에 그리므로 판과 겹치는 부분은 가려진다. 캔버스는 흐림 폭만큼 넓게 잡아 가장자리가 잘리지 않는다.
import { BlurMask, Canvas, Group, LinearGradient, Path, rect, Skia, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { castShape, rgba } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { shelfShadow } from '@/ui/theme';

const toPath = (points: Point[]) => Skia.Path.Polygon(points.map((q) => ({ x: q.x, y: q.y })), true);

type Props = {
  plankLeft: number; // px, 나무판 왼쪽 끝(부모 기준)
  plankRight: number;
  plankTop: number; // px, 윗면 뒤쪽 모서리
  plankBottom: number; // px, 앞턱 아래 끝
  scale: number;
};

// 그림자가 판 아래로 내려가는 최대 거리(DU). 부모 여백 계산용.
export const SHELF_SHADOW_EXTENT = Math.max(
  ...shelfShadow.layers.map((l) => l.dy + l.blur * 3),
  shelfShadow.tail.length + shelfShadow.tail.blur * 3,
);

export const ShelfShadow = memo(function ShelfShadow({ plankLeft, plankRight, plankTop, plankBottom, scale: s }: Props) {
  const { tail } = shelfShadow;
  const pad = Math.max(...shelfShadow.layers.map((l) => Math.abs(l.dx) + l.blur * 3), tail.dx + tail.blur * 3) * s + 2;
  const left = plankLeft - pad;
  const width = plankRight - plankLeft + pad * 2;
  const ph = plankBottom - plankTop;
  const height = ph + (SHELF_SHADOW_EXTENT + 4) * s;
  const { paths, tailPath } = useMemo(() => {
    const r = 3 * s;
    const plank = [
      { x: pad, y: r },
      { x: pad + r, y: 0 },
      { x: width - pad - r, y: 0 },
      { x: width - pad, y: r },
      { x: width - pad, y: ph },
      { x: pad, y: ph },
    ];
    return {
      paths: shelfShadow.layers.map((l) => toPath(castShape(plank, l.dx * s, l.dy * s))),
      tailPath: toPath(castShape(plank, tail.dx * s, tail.length * s)),
    };
  }, [s, pad, width, ph, tail]);
  return (
    <View style={{ position: 'absolute', left, top: plankTop, width, height }} pointerEvents="none">
      <Canvas style={{ width, height }}>
        {/* 판 윗면 위쪽(뒤 벽)으로는 번지지 않게 */}
        <Group clip={rect(0, ph * 0.45, width, height)}>
          <Path path={tailPath}>
            <LinearGradient start={vec(0, ph)} end={vec(0, ph + tail.length * s)}
              colors={tail.fade.map(([, a]) => rgba(shelfShadow.color, a))}
              positions={tail.fade.map(([distance]) => distance / tail.length)} />
            <BlurMask blur={tail.blur * s} style="normal" />
          </Path>
          {shelfShadow.layers.map((l, i) => (
            <Path key={i} path={paths[i]} color={rgba(shelfShadow.color, l.opacity)}>
              <BlurMask blur={l.blur * s} style="normal" />
            </Path>
          ))}
        </Group>
      </Canvas>
    </View>
  );
});
