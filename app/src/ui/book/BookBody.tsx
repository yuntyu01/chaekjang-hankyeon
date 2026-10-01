// 책 면 그림(캔버스 없이, 면 그림 좌표 0..w, 0..h). 상자 렌더러(ui/book3d)가 Skia Picture로 기록해 면 변환에 태워 그린다.
// 책등 면: 책 색 한 가지(균일한 무광). 표지 면: 표지 그림(없으면 책 색 + 모티프) + 제본 홈. 제목은 따로 그린다(세움·눕힘 조판을 자세에 따라 고른다).
// 거친 붓결·얼룩 질감과 책등 장식 그림은 그리지 않는다. 둥근 모서리·빛 받는 모서리는 여기서 굽지 않는다: 자세와 공통 광원으로 매 프레임 덧그린다(BookNode).
import { BlurMask, Group, Image as SkImage, LinearGradient, Rect, Skia, vec, type SkImage as SkImageType } from '@shopify/react-native-skia';

import { GROOVE } from '@/domain/book-parts';

// 속지(종이 단면) 색: 밝은 아이보리(시안 느린 계절 머리 쪽 속지 약 (241,229,213)보다 조금 밝게). 표지색·판 그늘은 섞지 않는다(속지 면에만).
export const PAGE_BASE = '#F4E9D8';
export const PAGE_RIM = '#C6B293'; // 표지와 맞닿는 안쪽의 좁은 그늘(따뜻한 베이지)
export const PAGE_LINE = '#E0D1BA';

// 책 색을 k배로 어둡게. 시안의 그늘은 회색이 아니라 따뜻한 갈색 쪽으로 어두워진다
// (모순 옆면: 앞면 대비 R 0.88, G 0.82, B 0.77) → 채널마다 지수를 달리한다. 밝게(k>1)는 그대로 곱한다.
export function scaleColor(hex: string, k: number) {
  'worklet';
  const WARM = [0.64, 1, 1.32];
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.max(0, Math.min(255, Math.round(v * (k < 1 ? Math.pow(k, WARM[i]) : k)))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// 두 색 섞기(a: 'rgb(...)' 또는 '#RRGGBB')
export function mix(a: string, b: string, t: number) {
  'worklet';
  const parse = (c: string) =>
    c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const x = parse(a);
  const y = parse(b);
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
}

// 색에 투명도 붙이기(a: 'rgb(...)' 또는 '#RRGGBB')
export function withAlpha(c: string, alpha: number) {
  'worklet';
  const v = c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  return `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

// 책 색에서 이어지는 빛: 흰색이 아니라 그 책 색을 따뜻한 빛 쪽으로 밝힌 색(모서리 하이라이트가 표지색과 이어지게)
export const LIGHT_TINT = '#FFF4E2';
export function litTone(tone: string) {
  'worklet';
  return mix(tone, LIGHT_TINT, 0.5);
}

// 책등 면(제목 제외): 책 색 한 가지. 장식 그림·질감 없이 균일한 무광 면이고, 명암은 그릴 때 광원으로 덧칠한다.
export function SpineFaceArt({ w, h, face }: { w: number; h: number; face: string }) {
  return <Rect x={0} y={0} width={w} height={h} color={face} />;
}

// 표지 그림 왼쪽(제본 쪽)을 면 밖으로 미는 비율(아래 CoverFaceArt 설명)
const COVER_ART_TRIM = 0.015;

// 표지 면(제목 제외). 표지 그림(달·풍경 등)은 그대로 두고, 그림이 없으면 책 색 + 모티프. 질감은 덧씌우지 않는다.
export function CoverFaceArt({
  w: fw,
  h,
  s,
  face,
  tone,
  image,
  motif,
}: {
  w: number;
  h: number;
  s: number;
  face: string;
  tone: string;
  image: SkImageType | null;
  motif: SkImageType | null;
}) {
  let mh = h * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  return (
    <Group clip={Skia.XYWHRect(0, 0, fw, h)}>
      <Rect x={0} y={0} width={fw} height={h} color={face} />
      {/* 표지 그림 왼쪽(제본 쪽) 끝 약 1%에는 시안에서 뽑을 때 따라온 어두운 윤곽 한 줄이 있다(b04 50 vs 안쪽 82). 제본 홈·가장자리 명암은
          코드가 그리므로 그림을 1.5% 왼쪽으로 밀어 그 줄을 면 밖으로 보낸다 */}
      {image ? <SkImage image={image} x={-fw * COVER_ART_TRIM} y={0} width={fw * (1 + COVER_ART_TRIM)} height={h} fit="cover" /> : null}
      {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
      {/* 제본 홈(책등 쪽에서 GROOVE.at 안쪽): 책 색을 낮춘 좁은 그늘 + 바로 뒤 책 색을 밝힌 가는 밝음(흰·검정 고정색이 아니다) */}
      <Rect x={0} y={0} width={(GROOVE.at + GROOVE.dark) * s} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec((GROOVE.at + GROOVE.dark) * s, 0)} colors={[withAlpha(scaleColor(tone, 0.6), 0.05), withAlpha(scaleColor(tone, 0.6), 0)]} />
      </Rect>
      <Rect x={(GROOVE.at - GROOVE.dark / 2) * s} y={0} width={GROOVE.dark * s} height={h} color={withAlpha(scaleColor(tone, 0.55), 0.14)}>
        <BlurMask blur={0.45 * s} style="normal" />
      </Rect>
      <Rect x={(GROOVE.at + GROOVE.gap) * s} y={0} width={GROOVE.lit * s} height={h} color={withAlpha(litTone(tone), 0.12)} />
    </Group>
  );
}
