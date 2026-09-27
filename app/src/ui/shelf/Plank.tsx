// 코드로 그리는 선반 판. 정면 시점, 윗면 6DU(책 앞으로 또렷하게), 앞면 11.5DU, 양 끝이 보이게 화면 안쪽으로 들인다.
// floorY는 책 밑면이 닿는 선(윗면 뒤쪽). 너비·높이는 px.
import { memo, useId } from 'react';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { SHELF } from '@/domain/geometry';
import { colors, shadow } from '@/ui/theme';

type Props = { left: number; width: number; floorY: number; scale: number; height: number; canvasWidth: number };

export const Plank = memo(function Plank({ left, width: w, floorY, scale: s, height, canvasWidth }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pt = SHELF.plankTop * s;
  const pf = SHELF.plankFront * s;
  return (
    <Svg style={{ position: 'absolute', left: 0, top: 0 }} width={canvasWidth} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}under`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.shadow} stopOpacity={shadow.plank.opacity} />
          <Stop offset="0.4" stopColor={colors.shadow} stopOpacity={shadow.plank.opacity * 0.4} />
          <Stop offset="1" stopColor={colors.shadow} stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={`${id}front`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.plankFront} />
          <Stop offset="1" stopColor={colors.plankFrontLow} />
        </LinearGradient>
        <LinearGradient id={`${id}top`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.plankTopBack} />
          <Stop offset="1" stopColor={colors.plankTop} />
        </LinearGradient>
      </Defs>
      {/* 판 바로 아래 짧은 그림자(빛이 왼쪽 위라 오른쪽으로 조금 밀림) */}
      <Rect x={left + 8 * s} y={floorY + pt + pf - 1 * s} width={w - 5 * s} height={shadow.plank.height * s} fill={`url(#${id}under)`} />
      <Rect x={left} y={floorY - 0.5 * s} width={w} height={pt + 2 * s} rx={2 * s} fill={`url(#${id}top)`} />
      <Rect x={left} y={floorY + pt} width={w} height={pf} rx={2.5 * s} fill={`url(#${id}front)`} />
      {/* 윗면 앞 모서리: 빛을 받는 밝은 선 + 그 아래 앞면 시작의 옅은 그늘 */}
      <Rect x={left + 1 * s} y={floorY + pt - 0.8 * s} width={w - 2 * s} height={1 * s} fill="#FFF6EA" opacity={0.9} />
      <Rect x={left + 1 * s} y={floorY + pt + 0.2 * s} width={w - 2 * s} height={1.2 * s} fill={colors.plankEdge} opacity={0.35} />
      <Rect x={left + 1 * s} y={floorY + pt + pf - 1.2 * s} width={w - 2 * s} height={1.2 * s} rx={0.6 * s} fill={colors.plankEdge} opacity={0.9} />
      {/* 판 양 끝: 나뭇결 단면이 살짝 어둡게 보인다 */}
      <Rect x={left} y={floorY - 0.5 * s} width={2.4 * s} height={pt + pf + 0.5 * s} rx={1.2 * s} fill={colors.plankEdge} opacity={0.45} />
      <Rect x={left + w - 2.4 * s} y={floorY - 0.5 * s} width={2.4 * s} height={pt + pf + 0.5 * s} rx={1.2 * s} fill={colors.plankEdge} opacity={0.6} />
    </Svg>
  );
});
