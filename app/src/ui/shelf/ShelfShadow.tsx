// 서랍 화면의 평면 선반 아래 분위기 그림자(3D 광원 계산이 아님). 홈 선반은 ShelfPlank의 실제 그림자를 쓴다.
// 판 바로 아래의 짧은 그림자 + 아래로 넓고 옅게 번지는 그림자. 판 윗면 위쪽(뒤 벽)으로는 번지지 않게 자른다.
import { BlurMask, Canvas, Group, Path, rect, Skia } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { rgba } from '@/domain/shadow-shape';
import { shadow } from '@/ui/theme';

type Props = {
  plankLeft: number; // px, 나무판 왼쪽 끝(부모 기준)
  plankRight: number;
  plankTop: number; // px, 윗면 뒤쪽 모서리
  plankBottom: number; // px, 앞턱 아래 끝
  scale: number;
};

// 그림자가 판 아래로 내려가는 최대 거리(DU). 부모 여백 계산용.
export const SHELF_SHADOW_EXTENT = shadow.drawerShelf.dy + shadow.drawerShelf.blur * 1.5;

export const ShelfShadow = memo(function ShelfShadow({ plankLeft, plankRight, plankTop, plankBottom, scale: s }: Props) {
  const shelfWall = shadow.drawerShelf;
  const shelfLip = shadow.ao.shelfLip;
  const pad = shelfWall.blur * 2 * s;
  const left = plankLeft - pad;
  const width = plankRight - plankLeft + pad * 2;
  const ph = plankBottom - plankTop;
  const height = ph + (SHELF_SHADOW_EXTENT + 6) * s;
  const [wide, lip] = useMemo(() => {
    const r = 3 * s;
    const box = (dy: number) =>
      Skia.Path.Polygon(
        [
          { x: pad + r, y: dy },
          { x: width - pad - r, y: dy },
          { x: width - pad, y: ph + dy },
          { x: pad, y: ph + dy },
        ],
        true,
      );
    return [box(shelfWall.dy * s), box(shelfLip.dy * s)];
  }, [s, pad, width, ph, shelfWall.dy, shelfLip.dy]);
  return (
    <View style={{ position: 'absolute', left, top: plankTop, width, height }} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Group clip={rect(0, ph * 0.45, width, height)}>
          <Path path={wide} color={rgba(shadow.color, shelfWall.opacity)}>
            <BlurMask blur={(shelfWall.blur / 2) * s} style="normal" />
          </Path>
          <Path path={lip} color={rgba(shadow.color, shelfLip.opacity)}>
            <BlurMask blur={(shelfLip.blur / 2) * s} style="normal" />
          </Path>
        </Group>
      </Canvas>
    </View>
  );
});
