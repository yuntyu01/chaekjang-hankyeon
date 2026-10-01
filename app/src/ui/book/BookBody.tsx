// 책 면 그림(캔버스 없이, 면 그림 좌표 0..w, 0..h). 상자 렌더러(ui/book3d)가 Skia Picture로 기록해 면 변환에 태워 그린다.
// 책등 면: 책 색 + 붓결 + 장면 그림. 표지 면: 표지 그림(없으면 책 색 + 모티프) + 붓결 + 제본 홈. 제목·작은 모티프는 따로 그린다(누울 때 바로 세우려고).
// 둥근 모서리·책등 곡면·빛 받는 모서리는 여기서 굽지 않는다: 자세와 공통 광원으로 매 프레임 덧그린다(BookNode).
import {
  BlurMask,
  Group,
  Image as SkImage,
  ImageShader,
  LinearGradient,
  Mask,
  Rect,
  Skia,
  vec,
  type SkImage as SkImageType,
} from '@shopify/react-native-skia';

import { GROOVE } from '@/domain/book-parts';
import type { BodyArt } from '@/domain/types';

export const SRC_DU = 390 / 941; // 시안 원본 1px = DU(붓결 크기를 시안과 맞춘다)
// 붓결 세기(시안: 은은함). 질감 이미지는 명암 차를 5배로 담아 두었으므로 여기서 줄인다.
export const GRAIN_STRENGTH = 0.22;
// 속지(종이 단면) 색: 따뜻한 백색. 표지색·판 그늘은 섞지 않는다(속지 면에만).
export const PAGE_BASE = '#FAF8F2';
export const PAGE_RIM = '#B8A993'; // 표지와 맞닿는 안쪽의 좁은 회베이지 그늘
export const PAGE_LINE = '#DDCFB8';

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

// 결정적 잡음(책마다 같은 모양)
export function Grain({ w, h, s, image }: { w: number; h: number; s: number; image: SkImageType | null }) {
  if (!image) return null;
  return (
    <Rect x={0} y={0} width={w} height={h} blendMode="softLight" opacity={GRAIN_STRENGTH}>
      <ImageShader image={image} tx="repeat" ty="repeat" transform={[{ scale: SRC_DU * s }]} />
    </Rect>
  );
}

// 책등 면(제목·작은 모티프 제외). 장면(scene) 그림은 면에 그대로 붙인다.
export function SpineFaceArt({ w, h, s, face, art, grain, motif }: { w: number; h: number; s: number; face: string; art?: BodyArt; grain: SkImageType | null; motif: SkImageType | null }) {
  // 책등 그림은 면 전체(사각형)에 색·결·모티프만 기록한다. 둥근 모서리는 3D 렌더러가 책 전체 윤곽을 공통 반지름으로 깎아 만들고,
  // 빛 받는 모서리 명암은 지금 자세와 공통 광원으로 매 프레임 덧그린다(BookNode 베벨). 고정된 윤곽·명암을 굽지 않는다.
  return (
    <Group clip={Skia.XYWHRect(0, 0, w, h)}>
      <Rect x={0} y={0} width={w} height={h} color={face} />
      <Grain w={w} h={h} s={s} image={grain} />
      {art?.scene && motif ? <SceneArt h={h} art={art} motif={motif} faceW={w * 0.94} /> : null}
    </Group>
  );
}

// 책등 장면 그림: 앞면 폭을 채우고 윗경계를 책 색으로 녹인다
function SceneArt({ h, art, motif, faceW }: { h: number; art: BodyArt; motif: SkImageType; faceW: number }) {
  const top = art.motifTop * h;
  const bh = h - top;
  const fade = bh * 0.34;
  return (
    <Mask
      mode="alpha"
      mask={
        <Rect x={0} y={top} width={faceW + 1} height={bh}>
          <LinearGradient start={vec(0, top)} end={vec(0, top + fade)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']} />
        </Rect>
      }>
      <SkImage image={motif} x={0} y={top} width={faceW + 1} height={bh} fit="cover" />
    </Mask>
  );
}

// 책등의 작은 모티프 자리(면 그림 px). 장면 그림이면 null(면에 붙어 있다).
export function spineMotifRect(art: BodyArt | undefined, motif: SkImageType | null, h: number, faceW: number) {
  if (!art || art.scene || !motif) return null;
  const top = art.motifTop * h;
  const mh = Math.max(4, (Math.max(art.motifBottom, art.motifTop + 0.1) - art.motifTop) * h);
  // 그림 칸 높이를 채우되 가로세로 비율은 그대로, 폭은 책등의 62%까지(시안: 가지·꽃이 책등 폭의 절반 남짓). 가운데 정렬
  let mw = (mh * motif.width()) / motif.height();
  let mH = mh;
  if (mw > faceW * 0.62) {
    mH = (mH * faceW * 0.62) / mw;
    mw = faceW * 0.62;
  }
  const cx = faceW / 2;
  return { x: cx - mw / 2, y: top + (mh - mH), w: mw, h: mH };
}

// 표지 그림 왼쪽(제본 쪽)을 면 밖으로 미는 비율(아래 CoverFaceArt 설명)
const COVER_ART_TRIM = 0.015;

// 표지 면(제목 제외). 표지 그림이 없으면 책 색 + 모티프.
export function CoverFaceArt({
  id,
  w: fw,
  h,
  s,
  face,
  tone,
  image,
  motif,
  grain,
}: {
  id: string;
  w: number;
  h: number;
  s: number;
  face: string;
  tone: string;
  image: SkImageType | null;
  motif: SkImageType | null;
  grain: SkImageType | null;
}) {
  let mh = h * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  return (
    <Group>
      <Group clip={Skia.XYWHRect(0, 0, fw, h)}>
        <Rect x={0} y={0} width={fw} height={h} color={face} />
        {/* 표지 그림 왼쪽(제본 쪽) 끝 약 1%에는 시안에서 뽑을 때 따라온 어두운 윤곽 한 줄이 있다(b04 50 vs 안쪽 82). 제본 홈·가장자리 명암은
            코드가 그리므로 그림을 1.5% 왼쪽으로 밀어 그 줄을 면 밖으로 보낸다 */}
        {image ? <SkImage image={image} x={-fw * COVER_ART_TRIM} y={0} width={fw * (1 + COVER_ART_TRIM)} height={h} fit="cover" /> : null}
        {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
        <Grain w={fw} h={h} s={s} image={grain} />
        {/* 제본 홈(책등 쪽에서 GROOVE.at 안쪽): 책 색을 낮춘 좁은 그늘 + 바로 뒤 책 색을 밝힌 가는 밝음(흰·검정 고정색이 아니다) */}
        <Rect x={0} y={0} width={(GROOVE.at + GROOVE.dark) * s} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec((GROOVE.at + GROOVE.dark) * s, 0)} colors={[withAlpha(scaleColor(tone, 0.6), 0.07), withAlpha(scaleColor(tone, 0.6), 0)]} />
        </Rect>
        <Rect x={(GROOVE.at - GROOVE.dark / 2) * s} y={0} width={GROOVE.dark * s} height={h} color={withAlpha(scaleColor(tone, 0.55), 0.18)}>
          <BlurMask blur={0.4 * s} style="normal" />
        </Rect>
        <Rect x={(GROOVE.at + GROOVE.gap) * s} y={0} width={GROOVE.lit * s} height={h} color={withAlpha(litTone(tone), 0.16)} />
      </Group>
    </Group>
  );
}
