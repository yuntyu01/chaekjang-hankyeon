// 탭 아이콘. 시안의 '책장' 아이콘(책 세 권, 하나는 기울어짐)을 SVG로.
import Svg, { Path, Rect } from 'react-native-svg';

export function ShelfIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  const fill = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0.8 -0.7 26 26">
      <Rect x={3} y={6} width={5} height={16} rx={1.2} fill={fill} stroke={color} strokeWidth={1.6} />
      <Rect x={10} y={4} width={5} height={18} rx={1.2} fill={fill} stroke={color} strokeWidth={1.6} />
      <Path d="M17.2 7.4 L21.4 6.4 L24.6 20.8 L20.4 21.8 Z" fill={fill} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

// 기록: 선택되면 속이 찬 문서(줄은 배경색으로 뚫는다), 아니면 윤곽
export function RecordIcon({ color, size = 26, bg, filled }: { color: string; size?: number; bg: string; filled?: boolean }) {
  const line = filled ? bg : color;
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Path
        d="M7 3.5 H16.5 L21 8 V21 A1.8 1.8 0 0 1 19.2 22.8 H7 A1.8 1.8 0 0 1 5.2 21 V5.3 A1.8 1.8 0 0 1 7 3.5 Z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Rect x={8.4} y={11} width={9} height={1.6} rx={0.8} fill={line} />
      <Rect x={8.4} y={14.6} width={9} height={1.6} rx={0.8} fill={line} />
      <Rect x={8.4} y={18.2} width={6} height={1.6} rx={0.8} fill={line} />
    </Svg>
  );
}

// 마이: 선택되면 속이 찬 사람, 아니면 윤곽
export function MyIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  const f = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Path d="M13 3.9 A4.6 4.6 0 1 1 13 13.1 A4.6 4.6 0 1 1 13 3.9 Z" fill={f} stroke={color} strokeWidth={1.6} />
      <Path d="M4.6 22.4 C5.1 17.9 8.7 15.4 13 15.4 C17.3 15.4 20.9 17.9 21.4 22.4 Z" fill={f} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

// 갈피: 끝이 갈라진 가름끈 종이(선택되면 속이 참)
export function BookmarkTabIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="-0.5 -1.2 26 26">
      <Path d="M7.5 3.8 H18.5 A1.4 1.4 0 0 1 19.9 5.2 V22.4 L13 17.6 L6.1 22.4 V5.2 A1.4 1.4 0 0 1 7.5 3.8 Z" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

// 읽기: 펼친 책(선택되면 속이 참)
export function ReadTabIcon({ color, size = 26, filled, bg }: { color: string; size?: number; filled?: boolean; bg: string }) {
  const f = filled ? color : 'none';
  return (
    <Svg width={size * 1.2} height={size * 1.05} viewBox="0 -0.7 26 26" preserveAspectRatio="none">
      <Path d="M13 7.2 C10.6 5.4 7.2 4.8 3.6 5.4 V20.4 C7.2 19.8 10.6 20.4 13 22.2 Z" fill={f} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M13 7.2 C15.4 5.4 18.8 4.8 22.4 5.4 V20.4 C18.8 19.8 15.4 20.4 13 22.2 Z" fill={f} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      {filled ? <Path d="M13 8 V21.2" stroke={bg} strokeWidth={1.2} /> : null}
    </Svg>
  );
}
