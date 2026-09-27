// 선반 바깥 그림자(선반 PNG에서 분리됨). 두 레이어:
//  1) 접촉: 판 바로 밑의 좁고 진한 그림자
//  2) 퍼짐: 아래로 넓게 퍼지는 옅은 그림자
// 수치는 theme.shelfShadow 한곳에서 조절한다. 블러는 플랫폼마다 다른 SVG 필터 대신
// 세로 그라데이션 + 좌우·위쪽 가장자리 마스크로 만들어 iOS/Android에서 같은 모양이 나온다.
// 캔버스는 흐린 가장자리가 잘리지 않도록 그림자보다 blur만큼 넓게 잡고, 부모는 overflow를 자르지 않는다.
import { memo, useId } from 'react';
import Svg, { Defs, G, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { shelfShadow } from '@/ui/theme';

type Layer = (typeof shelfShadow)['contact'];

type Props = {
  plankLeft: number; // px, 나무판 왼쪽 끝(화면 좌표, 부모 기준)
  plankRight: number;
  plankBottom: number; // px, 앞턱 아래 끝
  scale: number;
};

// 그림자 전체가 차지하는 세로 범위(DU). 부모 여백 계산용.
export const SHELF_SHADOW_EXTENT = Math.max(
  shelfShadow.contact.height + shelfShadow.contact.offsetY,
  shelfShadow.ambient.height + shelfShadow.ambient.offsetY,
);

function ShadowLayer({ id, layer, x0, x1, y0, s }: { id: string; layer: Layer; x0: number; x1: number; y0: number; s: number }) {
  const h = layer.height * s;
  const blur = Math.max(0.5, layer.blur * s);
  const w = x1 - x0;
  const fx = Math.min(0.5, blur / w);
  return (
    <G>
      <Defs>
        {/* 세로 감쇠(theme.shelfShadow.*.stops) */}
        <LinearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
          {layer.stops.map(([o, k]) => (
            <Stop key={o} offset={o} stopColor={shelfShadow.color} stopOpacity={layer.opacity * k} />
          ))}
        </LinearGradient>
        {/* 가장자리 흐림: 좌우 끝을 부드럽게(위쪽 시작은 stops로) */}
        <LinearGradient id={`${id}mx`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset={fx} stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset={1 - fx} stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
        <Mask id={`${id}m`} x={x0} y={y0} width={w} height={h} maskUnits="userSpaceOnUse">
          <Rect x={x0} y={y0} width={w} height={h} fill={`url(#${id}mx)`} />
        </Mask>
      </Defs>
      <Rect x={x0} y={y0} width={w} height={h} fill={`url(#${id}v)`} mask={`url(#${id}m)`} />
    </G>
  );
}

export const ShelfShadow = memo(function ShelfShadow({ plankLeft, plankRight, plankBottom, scale: s }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { contact, ambient } = shelfShadow;
  const pad = Math.max(contact.blur, ambient.blur, Math.abs(ambient.insetRight), Math.abs(ambient.offsetX)) * s + 2;
  const top = plankBottom + Math.min(contact.offsetY, ambient.offsetY) * s;
  const height = (SHELF_SHADOW_EXTENT + 2) * s;
  const left = plankLeft - pad;
  const width = plankRight - plankLeft + pad * 2;
  const layerProps = (l: Layer) => ({
    x0: pad + (l.insetLeft + l.offsetX) * s,
    x1: pad + (plankRight - plankLeft) + (l.offsetX - l.insetRight) * s,
    y0: plankBottom + l.offsetY * s - top,
    s,
  });
  return (
    <Svg style={{ position: 'absolute', left, top }} width={width} height={height} pointerEvents="none">
      <ShadowLayer id={`${id}a`} layer={ambient} {...layerProps(ambient)} />
      <ShadowLayer id={`${id}c`} layer={contact} {...layerProps(contact)} />
    </Svg>
  );
});
