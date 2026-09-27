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
