// 탭 아이콘(2026-11-03 사용자 시안 '하단바 이렇게'): 고르지 않은 탭은 속이 빈 중립 회색 윤곽선, 고른 탭은 진한 색으로 속이 찬 같은 모양.
// 모양·굵기는 시안에서 잰 값이다: 키 24칸에 선 굵기 2.4(키의 10%), 끝·꺾임은 둥글게. 칸(28)은 아이콘보다 조금 크고 아래·위 여백이 같아 탭끼리 줄이 맞는다.
// 속이 찬 모양에서 안쪽 선(펼친 책 가운데·달력 머리줄)은 탭 바 바탕색(bg)으로 뚫는다.
import Svg, { Path, Rect } from 'react-native-svg';

const W = 2.4;
const BOX = 28;
const round = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
// 가로 폭이 w칸인 아이콘: 세로 칸은 모두 28칸이고 화면 크기는 칸에 비례한다
const box = (size: number, w: number) => ({ width: (size * w) / BOX, height: size, viewBox: `0 -2 ${w} ${BOX}` });

// 책장: 책 세 권, 세 번째는 앞 책에 기대 있다(시안 약 18°). 윤곽선은 면 안쪽으로 그려 겉 크기가 찬 모양과 같다
export function ShelfIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  const inset = filled ? 0 : W / 2;
  const line = filled ? {} : { stroke: color, strokeWidth: W, ...round };
  const fill = filled ? color : 'none';
  const bar = (x: number, w: number) => ({ x: x + inset, y: 1.1 + inset, width: w - 2 * inset, height: 24.9 - 2 * inset, rx: Math.max(0.6, 2 - inset * 0.6), fill, ...line });
  return (
    <Svg {...box(size, 33)}>
      <Rect {...bar(0.6, 7.8)} />
      <Rect {...bar(10, 8.1)} />
      <Rect {...bar(21.2, 7)} transform="rotate(-18 24.7 13.5)" />
    </Svg>
  );
}

// 갈피: 위가 둥글고 아래가 V로 파인 가름끈 종이
export function BookmarkTabIcon({ color, size = 26, filled }: { color: string; size?: number; filled?: boolean }) {
  return (
    <Svg {...box(size, 20)}>
      <Path d="M5.1 1.2 H14.9 A3.9 3.9 0 0 1 18.8 5.1 V21.3 A0.95 0.95 0 0 1 17.25 22.05 L11.05 17 Q10 16.15 8.95 17 L2.75 22.05 A0.95 0.95 0 0 1 1.2 21.3 V5.1 A3.9 3.9 0 0 1 5.1 1.2 Z" fill={filled ? color : 'none'} stroke={color} strokeWidth={W} {...round} />
    </Svg>
  );
}

// 읽기: 펼친 책. 위는 가운데로 파이고 아래는 가운데가 조금 내려온다. 찬 모양은 가운데를 바탕색 선으로 나눈다
export function ReadTabIcon({ color, size = 26, filled, bg }: { color: string; size?: number; filled?: boolean; bg: string }) {
  return (
    <Svg {...box(size, 29)}>
      <Path d="M14.5 4.2 C12.7 2.2 10.3 1.2 7.3 1.2 H5.5 A4.3 4.3 0 0 0 1.2 5.5 V16 A4.3 4.3 0 0 0 5.5 20.3 H7.7 C10.3 20.3 12.5 21.1 14.5 22.8 C16.5 21.1 18.7 20.3 21.3 20.3 H23.5 A4.3 4.3 0 0 0 27.8 16 V5.5 A4.3 4.3 0 0 0 23.5 1.2 H21.7 C18.7 1.2 16.3 2.2 14.5 4.2 Z" fill={filled ? color : 'none'} stroke={color} strokeWidth={W} {...round} />
      <Path d="M14.5 4.6 V22" fill="none" stroke={filled ? bg : color} strokeWidth={filled ? 1.6 : W} {...round} />
    </Svg>
  );
}

// 기록: 달력(첫 화면이 달력이고, 막대그래프는 책 세 권인 책장 아이콘과 헷갈린다). 찬 모양은 머리줄을 바탕색 선으로 나눈다
export function RecordTabIcon({ color, size = 26, filled, bg }: { color: string; size?: number; filled?: boolean; bg: string }) {
  return (
    <Svg {...box(size, 25)}>
      <Rect x={1.2} y={3.6} width={22.6} height={19.2} rx={4.2} fill={filled ? color : 'none'} stroke={color} strokeWidth={W} {...round} />
      <Path d="M1.8 10.2 H23.2" fill="none" stroke={filled ? bg : color} strokeWidth={filled ? 1.6 : W} {...round} />
      <Path d="M7.6 1.2 V5.6 M17.4 1.2 V5.6" fill="none" stroke={color} strokeWidth={W} {...round} />
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
