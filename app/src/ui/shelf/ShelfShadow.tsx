// 선반 바깥 그림자(선반 PNG에서 분리됨). 빛은 왼쪽 위(책 그림자와 같은 방향).
// 나무판 윤곽을 오른쪽 아래로 옮겨 이은 모양을 Skia 블러로 흐린다. 세 겹(접촉·중간·퍼짐), 수치는 theme.shelfShadow 한곳.
// 판 뒤에 그리므로 판과 겹치는 부분은 가려진다. 캔버스는 흐림 폭만큼 넓게 잡아 가장자리가 잘리지 않는다.
import { BlurMask, Canvas, Group, Path, rect } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { castShape, rgba } from '@/domain/shadow-shape';
import { toPath } from '@/ui/shelf/ShelfShadows';
import { shelfShadow } from '@/ui/theme';

type Props = {
  plankLeft: number; // px, 나무판 왼쪽 끝(부모 기준)
  plankRight: number;
  plankTop: number; // px, 윗면 뒤쪽 모서리
  plankBottom: number; // px, 앞턱 아래 끝
  scale: number;
};

// 그림자가 판 아래로 내려가는 최대 거리(DU). 부모 여백 계산용.
export const SHELF_SHADOW_EXTENT = Math.max(...shelfShadow.layers.map((l) => l.dy + l.blur * 2.5));

export const ShelfShadow = memo(function ShelfShadow({ plankLeft, plankRight, plankTop, plankBottom, scale: s }: Props) {
  const pad = Math.max(...shelfShadow.layers.map((l) => Math.abs(l.dx) + l.blur * 3)) * s + 2;
  const left = plankLeft - pad;
  const width = plankRight - plankLeft + pad * 2;
  const ph = plankBottom - plankTop;
  const height = ph + (SHELF_SHADOW_EXTENT + 4) * s;
  const paths = useMemo(() => {
    const r = 3 * s;
    const plank = [
      { x: pad, y: r },
      { x: pad + r, y: 0 },
      { x: width - pad - r, y: 0 },
      { x: width - pad, y: r },
      { x: width - pad, y: ph },
      { x: pad, y: ph },
    ];
    return shelfShadow.layers.map((l) => toPath(castShape(plank, l.dx * s, l.dy * s)));
  }, [s, pad, width, ph]);
  return (
    <View style={{ position: 'absolute', left, top: plankTop, width, height }} pointerEvents="none">
      <Canvas style={{ width, height }}>
        {/* 판 윗면 위쪽(뒤 벽)으로는 번지지 않게 */}
        <Group clip={rect(0, ph * 0.45, width, height)}>
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
