// 개발용 샘플 표지 그림(SVG). 실제 재장정 자산이 들어오면 coverArtUri로 교체된다.
// 모든 장면은 viewBox 0 0 100 140 기준이며, 책등은 같은 장면의 일부를 크롭해서 쓴다.
import { memo, useId } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { SceneId } from '@/domain/types';

export const SCENE_W = 100;
export const SCENE_H = 140;

type Props = { scene: SceneId; width: number; height: number; viewBox?: string };

const pine = (x: number, base: number, h: number, fill: string, key?: string) => (
  <Path
    key={key}
    d={`M${x} ${base - h} L${x - h * 0.28} ${base - h * 0.45} L${x - h * 0.14} ${base - h * 0.45} L${x - h * 0.34} ${base} L${x + h * 0.34} ${base} L${x + h * 0.14} ${base - h * 0.45} L${x + h * 0.28} ${base - h * 0.45} Z`}
    fill={fill}
  />
);

const leafyTree = (x: number, base: number, r: number, trunk: string, leaf: string, leaf2: string, key: string) => (
  <G key={key}>
    <Rect x={x - r * 0.12} y={base - r * 2.4} width={r * 0.24} height={r * 2.4} fill={trunk} />
    <Circle cx={x} cy={base - r * 2.6} r={r} fill={leaf} />
    <Circle cx={x - r * 0.7} cy={base - r * 2.1} r={r * 0.75} fill={leaf2} />
    <Circle cx={x + r * 0.75} cy={base - r * 2.2} r={r * 0.7} fill={leaf} />
    <Circle cx={x + r * 0.2} cy={base - r * 3.2} r={r * 0.6} fill={leaf2} />
  </G>
);

function MoonLake({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#15264A" />
          <Stop offset="1" stopColor="#2C4A78" />
        </LinearGradient>
        <LinearGradient id={`${id}lake`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2B4C7E" />
          <Stop offset="1" stopColor="#1B3158" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      {[
        [12, 14], [30, 8], [48, 20], [22, 30], [60, 10], [88, 26], [40, 36], [8, 44], [92, 8], [70, 38],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 0.9 : 0.55} fill="#F5E9C0" opacity={0.85} />
      ))}
      <Circle cx={74} cy={28} r={13} fill="#F4E3A6" opacity={0.18} />
      <Circle cx={74} cy={28} r={9} fill="#F6E7B0" />
      <Path d="M0 84 L18 66 L30 74 L46 60 L62 72 L78 58 L100 74 L100 90 L0 90 Z" fill="#314D78" />
      <Path d="M0 90 L14 78 L28 84 L40 76 L56 86 L100 82 L100 92 L0 92 Z" fill="#23385E" />
      {[6, 12, 18, 24, 31].map((x, i) => pine(x, 92, 14 + (i % 2) * 6, '#1A2E4E', `p${i}`))}
      <Rect x={32} y={84} width={16} height={8} fill="#1F3356" />
      <Path d="M31 84 L40 78 L49 84 Z" fill="#1F3356" />
      {[34, 38, 43].map((x, i) => (
        <Rect key={i} x={x} y={86} width={2.2} height={2.2} fill="#F2C86B" />
      ))}
      <Rect y={92} width={100} height={48} fill={`url(#${id}lake)`} />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Rect key={i} x={70 - i * 1.5} y={95 + i * 4} width={8 + i * 3} height={1.2} rx={0.6} fill="#F6E2A0" opacity={0.75 - i * 0.08} />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <Path key={i} d={`M${6 + i * 22} ${104 + i * 5} q6 -2 12 0`} stroke="#5E7FB0" strokeWidth={0.6} fill="none" opacity={0.6} />
      ))}
      <Path d="M0 122 Q10 110 22 118 Q30 108 40 120 Q46 116 52 124 L52 140 L0 140 Z" fill="#40663F" />
      <Path d="M0 130 Q12 120 24 128 Q34 122 44 132 L44 140 L0 140 Z" fill="#557D48" />
      <Path d="M70 140 Q76 124 88 128 Q94 118 100 124 L100 140 Z" fill="#3F6540" />
      <Path d="M52 140 Q60 128 72 134 L72 140 Z" fill="#E9D7A8" opacity={0.7} />
    </>
  );
}

function Forest({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F3EAD2" />
          <Stop offset="1" stopColor="#DDE6CF" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      <Path d="M0 88 L20 70 L36 80 L54 64 L72 78 L100 66 L100 96 L0 96 Z" fill="#9FB8B0" />
      <Path d="M0 96 L24 84 L50 92 L76 82 L100 90 L100 100 L0 100 Z" fill="#7F9E86" />
      <Path d="M38 100 Q50 96 62 100 Q70 110 56 116 Q44 120 50 132 L60 140 L34 140 Q32 124 44 116 Q52 110 38 100 Z" fill="#BFD6DA" />
      <Path d="M44 122 Q40 130 44 140 L58 140 Q50 132 54 124 Z" fill="#EADBB5" />
      {leafyTree(12, 118, 13, '#6B4E36', '#3F6B40', '#557F4A', 't1')}
      {leafyTree(86, 116, 14, '#6B4E36', '#44703F', '#5C874C', 't2')}
      {leafyTree(30, 104, 8, '#6B4E36', '#5D8A52', '#6E9A5C', 't3')}
      {leafyTree(70, 102, 8, '#6B4E36', '#58844C', '#6E9A5C', 't4')}
      <Path d="M0 30 Q10 10 30 14 Q40 2 56 10 L56 0 L0 0 Z" fill="#4A7543" opacity={0.95} />
      <Path d="M100 0 L60 0 Q70 12 84 8 Q96 16 100 30 Z" fill="#3F6A3E" />
      <Path d="M0 126 Q14 116 30 124 Q36 130 34 140 L0 140 Z" fill="#46703F" />
      <Path d="M100 124 Q86 118 72 128 Q68 134 70 140 L100 140 Z" fill="#46703F" />
      {[
        [10, 130, '#F1C7B8'], [22, 134, '#F7E6B8'], [80, 132, '#F1C7B8'], [90, 128, '#FFFFFF'], [16, 124, '#FFFFFF'],
      ].map(([x, y, c], i) => (
        <Circle key={i} cx={x as number} cy={y as number} r={1.6} fill={c as string} />
      ))}
    </>
  );
}

function Sunset({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#EBC7C9" />
          <Stop offset="0.6" stopColor="#F4CDB0" />
          <Stop offset="1" stopColor="#F5DDBB" />
        </LinearGradient>
        <LinearGradient id={`${id}lake`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#B7B9D2" />
          <Stop offset="1" stopColor="#7E8DB5" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      <Circle cx={66} cy={78} r={9} fill="#F8E3B8" />
      <Path d="M0 84 L16 66 L30 76 L44 62 L60 80 L78 68 L100 82 L100 96 L0 96 Z" fill="#9A93B8" />
      <Path d="M0 92 L20 80 L40 90 L58 84 L80 90 L100 86 L100 100 L0 100 Z" fill="#6F7AA6" />
      <Rect y={98} width={100} height={42} fill={`url(#${id}lake)`} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Rect key={i} x={62 - i * 1.5} y={102 + i * 4} width={8 + i * 3} height={1.2} rx={0.6} fill="#F8E0B6" opacity={0.8 - i * 0.12} />
      ))}
      {[4, 10, 16, 22].map((x, i) => pine(x, 110, 16 + (i % 2) * 5, '#3E5A58', `p${i}`))}
      <Path d="M0 116 Q14 104 30 114 Q38 120 36 140 L0 140 Z" fill="#5A7B55" />
      <Path d="M100 118 Q86 110 74 122 Q70 130 72 140 L100 140 Z" fill="#577650" />
      <Path d="M0 132 Q10 124 22 132 L22 140 L0 140 Z" fill="#E4A96A" opacity={0.8} />
    </>
  );
}

function River({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#C9DAE8" />
          <Stop offset="1" stopColor="#E9EEE6" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      <Path d="M0 78 L22 58 L40 70 L62 52 L84 68 L100 60 L100 90 L0 90 Z" fill="#8FA9C4" />
      <Path d="M0 88 L30 74 L52 84 L78 72 L100 82 L100 100 L0 100 Z" fill="#6E91A8" />
      {[8, 16, 70, 80, 90].map((x, i) => pine(x, 104, 14 + (i % 2) * 5, '#3D6150', `p${i}`))}
      <Path d="M0 100 L100 100 L100 140 L0 140 Z" fill="#7FA36F" />
      <Path d="M44 100 Q60 106 52 114 Q40 124 58 132 Q66 136 62 140 L36 140 Q30 128 42 120 Q52 112 38 104 Z" fill="#9CC3DA" />
      <Path d="M46 108 q4 -1 7 0 M44 124 q5 -1 9 0" stroke="#E8F2F5" strokeWidth={0.8} fill="none" />
      <Path d="M0 124 Q16 116 28 128 L30 140 L0 140 Z" fill="#5F8A55" />
    </>
  );
}

function NightPine({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1C2F55" />
          <Stop offset="1" stopColor="#2A4470" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      <Path d="M58 20 a10 10 0 1 0 12 14 a8 8 0 1 1 -12 -14 Z" fill="#F1D58A" />
      {[[20, 16], [40, 30], [82, 14], [12, 46], [70, 52]].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={0.7} fill="#F2E6C4" />
      ))}
      <Path d="M0 110 L20 96 L44 106 L70 94 L100 104 L100 140 L0 140 Z" fill="#20375E" />
      {[6, 16, 28, 40, 54, 66, 78, 90].map((x, i) => pine(x, 140, 26 + (i % 3) * 8, i % 2 ? '#152845' : '#1A3050', `p${i}`))}
    </>
  );
}

function Meadow({ id }: { id: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2EADB" />
          <Stop offset="1" stopColor="#EEE3CF" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={140} fill={`url(#${id}sky)`} />
      {[[30, 30], [62, 18], [76, 44], [20, 60], [50, 70]].map(([x, y], i) => (
        <Path key={i} d={`M${x} ${y - 2.4} L${x + 0.7} ${y - 0.7} L${x + 2.4} ${y} L${x + 0.7} ${y + 0.7} L${x} ${y + 2.4} L${x - 0.7} ${y + 0.7} L${x - 2.4} ${y} L${x - 0.7} ${y - 0.7} Z`} fill="#D9AE52" opacity={0.85} />
      ))}
      <Ellipse cx={46} cy={140} rx={64} ry={34} fill="#9BB08C" />
      <Ellipse cx={46} cy={142} rx={52} ry={24} fill="#8AA27D" />
      {/* 앉아 있는 작은 인물 */}
      <Ellipse cx={46} cy={108} rx={5} ry={6} fill="#3E6C8A" />
      <Circle cx={46} cy={99} r={3.6} fill="#F1D3B3" />
      <Path d="M42.6 98 Q46 92 49.6 98 Q48 95.5 46 95.8 Q44 95.5 42.6 98 Z" fill="#E7B84C" />
      <Path d="M48 103 Q56 101 62 96 Q58 104 49 105 Z" fill="#E4B24A" />
      {[[16, 124], [74, 122], [30, 132]].map(([x, y], i) => (
        <Path key={i} d={`M${x} ${y} q-2 -5 0 -9 M${x} ${y} q3 -4 5 -6`} stroke="#6E8A5B" strokeWidth={0.8} fill="none" />
      ))}
    </>
  );
}

const SCENES: Record<SceneId, (p: { id: string }) => React.JSX.Element> = {
  moonlake: MoonLake,
  forest: Forest,
  sunset: Sunset,
  river: River,
  nightpine: NightPine,
  meadow: Meadow,
};

export const SceneArt = memo(function SceneArt({ scene, width, height, viewBox }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const Scene = SCENES[scene];
  return (
    <Svg width={width} height={height} viewBox={viewBox ?? `0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice">
      <Scene id={id} />
    </Svg>
  );
});

// 책등용 크롭: 장면 아래쪽 풍경에서 책등 비율 그대로 한 줄기를 잘라낸다(표지를 눌러 찌그러뜨리지 않음).
export function spineCropViewBox(areaW: number, areaH: number, cropX = 0.5) {
  const ch = Math.min(SCENE_H * 0.62, SCENE_W * (areaH / areaW));
  const cw = ch * (areaW / areaH);
  const x = Math.max(0, Math.min(SCENE_W - cw, cropX * (SCENE_W - cw)));
  return `${x} ${SCENE_H - ch} ${cw} ${ch}`;
}

// 장면 표지 위 제목 색과 위치(0~1, 위에서부터). 그림의 빈 하늘 쪽에 제목을 둔다.
export const SCENE_TITLE: Record<SceneId, { ink: string; top: number }> = {
  moonlake: { ink: '#F5ECD6', top: 0.3 },
  forest: { ink: '#24331F', top: 0.36 },
  sunset: { ink: '#3B3346', top: 0.12 },
  river: { ink: '#2B3E52', top: 0.14 },
  nightpine: { ink: '#F2E7C8', top: 0.36 },
  meadow: { ink: '#3A3A36', top: 0.16 },
};
