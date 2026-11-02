// 탭 아이콘(2026-11-01 사용자: '속 비게, 인스타처럼 둥글게' → '고르면 눌린 바탕 말고 그 아이콘 속이 차게, 회색보다 진한 색'):
// 고르지 않은 탭은 속이 빈 회색 윤곽선, 고른 탭은 진한 색으로 속이 찬 같은 모양. 선 굵기 2, 끝·꺾임은 둥글게, 모서리도 크게 굴린다.
// 속이 찬 모양에서 안쪽 선(펼친 책 가운데·앞 말풍선 테두리)은 탭 바 바탕색(bg)으로 뚫는다.
import Svg, { Path, Rect } from 'react-native-svg';

const W = 2; // 선 굵기(24 칸 기준 2, 인스타 하단 바와 같은 무게)
const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

// 책장: 벽을 함께 쓰는 책 두 권에 한 권이 기대 있는 한 덩어리(2026-11-01 사용자: 따로 놀지 않게 이어지게, 다만 높이만 다른 세 칸과 바닥 줄은 막대그래프 같다고 함).
// 찬 모양은 두 권 사이를 바탕색 선으로 나눈다
export function ShelfIcon({ color, size = 26, filled, bg }: { color: string; size?: number; filled?: boolean; bg: string }) {
  const fill = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={2.6} y={3.8} width={10.8} height={16.8} rx={2.4} fill={fill} stroke={color} strokeWidth={W} {...round} />
      <Path d="M8 4.6 V19.8" fill="none" stroke={filled ? bg : color} strokeWidth={filled ? 1.5 : W} {...round} />
      <Rect x={17.3} y={4.6} width={4.9} height={16} rx={2} transform="rotate(-15 19.75 20.6)" fill={fill} stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 갈피: 끝이 갈라진 가름끈 종이
export function BookmarkTabIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="-0.5 -1.2 26 26">
      <Path d="M8.6 3.8 H17.4 A2.6 2.6 0 0 1 20 6.4 V21.6 A0.9 0.9 0 0 1 18.6 22.3 L13 18 L7.4 22.3 A0.9 0.9 0 0 1 6 21.6 V6.4 A2.6 2.6 0 0 1 8.6 3.8 Z" fill={filled ? color : 'none'} stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 읽기: 펼친 책. 바깥 모서리를 크게 굴리고 책장 끝은 곡선으로 이어(2026-11-01 사용자 '모서리들이 너무 각지네'). 찬 모양은 가운데를 바탕색 선으로 나눈다
export function ReadTabIcon({ color, size = 26, filled, bg }: { color: string; size?: number; filled?: boolean; bg: string }) {
  const fill = filled ? color : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 7.2 C10.2 5.4 7.6 4.7 4.8 4.8 A2.3 2.3 0 0 0 2.6 7.1 V16.6 A2.3 2.3 0 0 0 4.9 18.9 C7.6 18.9 10.2 19.5 12 21 C13.8 19.5 16.4 18.9 19.1 18.9 A2.3 2.3 0 0 0 21.4 16.6 V7.1 A2.3 2.3 0 0 0 19.2 4.8 C16.4 4.7 13.8 5.4 12 7.2 Z" fill={fill} stroke={color} strokeWidth={W} {...round} />
      <Path d="M12 7.6 V20.4" fill="none" stroke={filled ? bg : color} strokeWidth={filled ? 1.4 : W} {...round} />
    </Svg>
  );
}

// 커뮤니티: 말풍선 두 개. 빈 모양은 앞 말풍선을 바탕색으로 채워 뒤 말풍선 선을 가리고, 찬 모양은 앞 말풍선 테두리를 바탕색으로 둘러 띄운다
export function CommunityTabIcon({ color, size = 26, bg, filled }: { color: string; size?: number; bg: string; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 -0.6 26 26">
      <Path d="M9.4 7.6 V6.8 A2.6 2.6 0 0 1 12 4.2 H20.2 A2.6 2.6 0 0 1 22.8 6.8 V12.2 A2.6 2.6 0 0 1 20.2 14.8 H20 V17.4 L17.2 14.8" fill={filled ? color : 'none'} stroke={color} strokeWidth={W} {...round} />
      <Path d="M5.8 8.6 H14.2 A2.6 2.6 0 0 1 16.8 11.2 V16.6 A2.6 2.6 0 0 1 14.2 19.2 H9.6 L6.2 21.9 V19.2 H5.8 A2.6 2.6 0 0 1 3.2 16.6 V11.2 A2.6 2.6 0 0 1 5.8 8.6 Z" fill={filled ? color : bg} stroke={filled ? bg : color} strokeWidth={filled ? 2.4 : W} {...round} />
    </Svg>
  );
}
