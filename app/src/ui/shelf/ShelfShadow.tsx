// 선반 바깥 그림자(선반 PNG에서 분리됨). 빛은 왼쪽 위(책 그림자와 같은 방향).
// 나무판 윤곽을 오른쪽 아래로 옮겨 원래 윤곽과 이은 모양을 가우시안 블러로 흐린다 → 네모 없이 부드럽게,
// 왼쪽 끝은 비스듬히 줄고 오른쪽 끝은 조금 더 나간다. 두 겹(접촉·퍼짐), 수치는 theme.shelfShadow 한곳.
// 판 뒤에 그리므로 판과 겹치는 부분은 가려진다. 캔버스는 흐림 폭만큼 넓게 잡아 가장자리가 잘리지 않는다.
import { memo, useId } from 'react';
import Svg, { ClipPath, Defs, FeGaussianBlur, Filter, G, Polygon, Rect } from 'react-native-svg';

import { castShape } from '@/ui/shelf/ShelfShadows';
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
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pad = Math.max(...shelfShadow.layers.map((l) => Math.abs(l.dx) + l.blur * 3)) * s + 2;
  const left = plankLeft - pad;
  const top = plankTop;
  const width = plankRight - plankLeft + pad * 2;
  const height = plankBottom - plankTop + (SHELF_SHADOW_EXTENT + 4) * s;
  // 판 윤곽(캔버스 좌표)
  const r = 3 * s;
  const plank = [
    { x: pad, y: r },
    { x: pad + r, y: 0 },
    { x: width - pad - r, y: 0 },
    { x: width - pad, y: r },
    { x: width - pad, y: plankBottom - plankTop },
    { x: pad, y: plankBottom - plankTop },
  ];
  return (
    <Svg style={{ position: 'absolute', left, top }} width={width} height={height} pointerEvents="none">
      <Defs>
        {shelfShadow.layers.map((l, i) => (
          <Filter key={i} id={`${id}b${i}`} x={0} y={0} width={width} height={height} filterUnits="userSpaceOnUse">
            <FeGaussianBlur stdDeviation={l.blur * s} />
          </Filter>
        ))}
        {/* 판 윗면 위쪽(뒤 벽)으로 번지지 않게 */}
        <ClipPath id={`${id}clip`}>
          <Rect x={0} y={(plankBottom - plankTop) * 0.45} width={width} height={height} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id}clip)`}>
        {shelfShadow.layers.map((l, i) => (
          <Polygon
            key={i}
            points={castShape(plank, l.dx * s, l.dy * s).map((p) => `${p.x},${p.y}`).join(' ')}
            fill={shelfShadow.color}
            fillOpacity={l.opacity}
            filter={`url(#${id}b${i})`}
          />
        ))}
      </G>
    </Svg>
  );
});
