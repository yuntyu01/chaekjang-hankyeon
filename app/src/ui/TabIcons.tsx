// 탭 아이콘. 시안의 '책장' 아이콘(책 세 권, 하나는 기울어짐)을 SVG로.
import Svg, { Path, Rect } from 'react-native-svg';

export function ShelfIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  const fill = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Rect x={3} y={6} width={5} height={16} rx={1.2} fill={fill} stroke={color} strokeWidth={1.6} />
      <Rect x={10} y={4} width={5} height={18} rx={1.2} fill={fill} stroke={color} strokeWidth={1.6} />
      <Path d="M17.2 7.4 L21.4 6.4 L24.6 20.8 L20.4 21.8 Z" fill={fill} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

// 기록: 속이 찬 문서(줄은 배경색으로 뚫는다)
export function RecordIcon({ color, size = 26, bg }: { color: string; size?: number; bg: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Path d="M7 3.5 H16.5 L21 8 V21 A1.8 1.8 0 0 1 19.2 22.8 H7 A1.8 1.8 0 0 1 5.2 21 V5.3 A1.8 1.8 0 0 1 7 3.5 Z" fill={color} />
      <Path d="M16.5 3.5 V8 H21" fill={bg} opacity={0.35} />
      <Rect x={8.4} y={11} width={9} height={1.7} rx={0.85} fill={bg} />
      <Rect x={8.4} y={14.6} width={9} height={1.7} rx={0.85} fill={bg} />
      <Rect x={8.4} y={18.2} width={6} height={1.7} rx={0.85} fill={bg} />
    </Svg>
  );
}

// 마이: 속이 찬 사람
export function MyIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Path d="M13 3.6 A4.9 4.9 0 1 1 13 13.4 A4.9 4.9 0 1 1 13 3.6 Z" fill={color} />
      <Path d="M4.4 22.6 C4.9 17.8 8.6 15.2 13 15.2 C17.4 15.2 21.1 17.8 21.6 22.6 Z" fill={color} />
    </Svg>
  );
}
