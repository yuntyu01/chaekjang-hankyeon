// 코드로 그리는 책 몸체. 형태는 코드, 재료(색·붓결·모티프·표지 그림)는 평평한 그림 자산.
// 세 자세가 같은 몸체를 쓴다: 세운 책(SpineBody), 누운 책(LyingBody = 세운 몸체를 눕힌 것), 표지 전시(CoverBody).
// 시안 '데미안'에서 잰 책등 구조(책 폭 대비): 앞면(둥근 책등, 왼쪽 1/4이 가장 밝음) → 짙은 홈 → 옆면(윗부분이 비스듬히 깎여 보이는 3/4 시점).
// 가장자리는 살짝 불규칙(손으로 그린 느낌). 제목은 BookRenderer가 위에 조판한다.
import {
  Canvas,
  Group,
  Image as SkImage,
  ImageShader,
  BlurMask,
  LinearGradient,
  Mask,
  Path,
  Rect,
  RoundedRect,
  Skia,
  useImage,
  vec,
  type SkImage as SkImageType,
  type SkPath,
} from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';

import { BRUSH_DETAIL } from '@/domain/body-art.generated';
import { TOP_VIEW } from '@/domain/geometry';
import type { Point } from '@/domain/shelf-scene';
import type { BodyArt, ImageSource } from '@/domain/types';

const SRC_DU = 390 / 941; // 시안 원본 1px = DU(붓결 크기를 시안과 맞춘다)
// 붓결 세기(시안: 은은함). 질감 이미지는 명암 차를 5배로 담아 두었으므로 여기서 줄인다.
export const GRAIN_STRENGTH = 0.22;
export const SPINE_SIDE = 0.87; // 세운 책(시점 기본값): 옆면 시작(책 폭 비율)

// 가운데 시점: view(-1~1)에 따라 옆면 폭과 어느 쪽 옆면이 보이는지 정한다.
export function spineView(view: number) {
  const side = 1 - (0.1 + 0.1 * Math.abs(view)); // 가운데 책도 옆면이 3DU쯤, 양끝은 책 폭의 20%(시안 데미안 19%)
  return { side, mirror: view > 0.02 };
}
// 모서리 빛 반사: 빛이 오는 끝에서 가장 밝고 반쯤에서 거의 사라진다(선 전체가 고르게 빛나지 않게)
// (시안: 가늘고 또렷한 선이 끝까지 이어지되 빛 쪽이 조금 더 밝다)
const GLINT = ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.3)', 'rgba(255,255,255,0.17)', 'rgba(255,255,255,0.08)'];
const GLINT_AT = [0, 0.15, 0.5, 1];
export const CHAMFER = 0.14; // 옆면 윗부분이 깎여 내려가는 정도(책 폭 비율)
export const PAGE = '#F4ECDD';
export const PAGE_LINE = '#DDCFB8';

// 책 색을 k배로 어둡게. 시안의 그늘은 회색이 아니라 따뜻한 갈색 쪽으로 어두워진다
// (모순 옆면: 앞면 대비 R 0.88, G 0.82, B 0.77) → 채널마다 지수를 달리한다. 밝게(k>1)는 그대로 곱한다.
const WARM = [0.64, 1, 1.32];
export function scaleColor(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) =>
    Math.max(0, Math.min(255, Math.round(v * (k < 1 ? Math.pow(k, WARM[i]) : k)))),
  );
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export const GROOVE = 0.06; // 앞면과 옆면 사이 홈 폭(책 폭 비율)

// 앞면·홈·옆면의 가로 명암(위치: 책 폭 비율, 값: 어두운 책 기준 밝기 배율). side = 옆면 시작 비율.
// 시안(데미안·모순)에서 잰 값: 앞면은 왼쪽 가까이가 가장 밝고 오른쪽 끝으로 0.86까지 어두워지며,
// 좁은 홈(시안 0.5, 앱은 조금 연하게) 뒤에 한 톤 어두운 옆면(0.78 → 바깥 0.66)이 온다.
export function spineProfile(side: number): [number, number][] {
  const f = side - GROOVE; // 앞면 끝
  return [
    [0, 0.86],
    [0.02, 0.95],
    [0.06, 1.0],
    [0.4 * f, 1.0],
    [f, 0.86],
    [f + 0.015, 0.68],
    [side - 0.012, 0.68],
    [side + 0.008, 0.78],
    [0.97, 0.72],
    [1, 0.66],
  ];
}

// 밝은 책일수록 명암 폭이 줄어든다(시안: 모순 앞면 0.95, 데미안 0.85). 옆면은 밝은 책도 꽤 어둡다.
// mirror(왼쪽 옆면)는 빛을 향하므로 옆면이 덜 어둡다.
export function shadeProfile(prof: [number, number][], side: number, face: string, mirror = false): [number, number][] {
  const lum = luminance(face);
  const f = side - GROOVE;
  const wFront = 0.35 + 0.75 * (1 - lum);
  const wSide = (0.8 + 0.3 * (1 - lum)) * (mirror ? 0.85 : 1); // 시안: 왼쪽 옆면도 꽤 어둡다(아주 보통의 하루)
  // 홈은 어두운 책에서만 또렷하다(시안 모순은 앞면에서 옆면으로 바로 넘어간다)
  return prof.map(([p, k]) => {
    const groove = p > f + 1e-6 && p < side - 1e-6;
    const kk = groove ? k + (0.78 - k) * lum : k;
    return [p, 1 - (1 - kk) * (p <= f + 1e-6 ? wFront : wSide)];
  });
}

// 상자 모델의 앞면만: 옆면으로 꺾이는 오른쪽 끝(누운 책은 아래쪽)이 조금 어둡다
export function frontProfile(face: string, lying: boolean): [number, number][] {
  const lum = luminance(face);
  const w = 0.35 + 0.75 * (1 - lum);
  const raw: [number, number][] = lying
    ? [[0, 0.84], [0.05, 0.93], [0.5, 1.0], [0.94, 1.02], [1, 0.94]]
    : [[0, 0.86], [0.02, 0.95], [0.06, 1.0], [0.4, 1.0], [0.9, 0.93], [0.97, 0.86], [1, 0.82]];
  return raw.map(([p, k]) => [p, 1 - (1 - k) * w] as [number, number]);
}

// 누운 책: 옆면이 위를 향한 윗면이 되어 빛을 받는다(시안: 앞면보다 밝거나 같고, 사이에 옅은 홈).
export function lyingProfile(side: number, face: string): [number, number][] {
  const lum = luminance(face);
  const w = 0.35 + 0.75 * (1 - lum);
  const f = side - GROOVE;
  return [
    [0, 0.86],
    [0.04, 0.97],
    [0.5 * f, 1.0],
    [f, 0.9],
    [f + 0.015, 0.8],
    [side - 0.012, 0.8],
    [side + 0.008, 1.05],
    [0.95, 1.03],
    [1, 0.92],
  ].map(([p, k]) => [p, 1 - (1 - k) * w] as [number, number]);
}

// 두 색 섞기(a: 'rgb(...)' 또는 '#RRGGBB')
export function mix(a: string, b: string, t: number) {
  const parse = (c: string) =>
    c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const [x, y] = [parse(a), parse(b)];
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
}

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// 실루엣 가장자리 선: 책 색을 어둡게 한 같은 색(회색 아님). 시안은 어두운 책일수록 선이 진하다.
export const edgeFactor = (face: string) => 0.74 + 0.2 * luminance(face); // 선은 구분만 될 만큼(진하면 틀처럼 보인다)

// 결정적 잡음(책마다 같은 모양)
function jitter(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (i: number) => {
    const x = Math.sin((h % 1000) * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
}

// 손으로 그은 선의 흔들림: 파장이 다른 사인 둘을 더한 부드러운 잡음(0~1). t는 선을 따라간 거리(DU).
// 늘 안쪽으로만 밀어서 캔버스 밖으로 나가지 않는다.
export const WOBBLE = 0.32; // 최대 흔들림(DU)
function wobble(seed: string, edge: number) {
  const r = jitter(seed);
  const waves = [24, 10].map((len, i) => ({ len, amp: [0.65, 0.35][i], ph: (r(edge * 7 + i) + 0.5) * Math.PI * 2 }));
  return (t: number) => 0.5 + 0.5 * waves.reduce((sum, w) => sum + w.amp * Math.sin((t / w.len) * Math.PI * 2 + w.ph), 0);
}

// 책등 머리가 볼록한 정도(DU). 시안 데미안·모순: 가운데가 양끝보다 1DU쯤 높다.
export const HEAD_BOW = 0.9;

// 세운 책 몸체 윤곽(px): 둥근 왼쪽 위, 살짝 볼록한 머리, 비스듬히 깎인 오른쪽 위, 평평한 바닥,
// 손으로 그은 듯 부드럽게 흔들리는 가장자리.
// chamfer: 옆면 윗부분이 깎이는 높이(px). 주지 않으면 옆면 폭에서 정한다(누운 책은 윗면 폭 그대로 = 45도).
// topH(px) > 0: 내려다보는 시점. 윗면(머리)이 앞면 위로 보이고, 옆면 위·아래 모서리가 뒤로 갈수록 올라간다.
export function bodyOutline(w: number, h: number, s: number, seed: string, side = SPINE_SIDE, chamfer?: number, topH = 0): Point[] {
  if (topH > 0) return topViewOutline(w, h, s, seed, side, topH);
  const r = 4.6 * s;
  const rb = 2 * s;
  const sideX = w * side;
  const ch = chamfer ?? w * Math.max(0.03, Math.min(CHAMFER, 1 - side)); // 옆면이 좁을수록 윗부분 깎임도 작다
  const bow = HEAD_BOW * s;
  const amp = WOBBLE * s;
  const step = 1.5 * s;
  const [wTop, wRight, wBottom, wLeft] = [0, 1, 2, 3].map((e) => wobble(seed, e));
  const headY = (x: number) => bow * (1 - Math.sin((Math.PI * Math.min(x, sideX)) / sideX)); // 머리 곡선
  const pts: Point[] = [];
  // 왼쪽 위 모서리(머리 곡선 높이에 맞춰 붙인다)
  const y0 = headY(r);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / 6);
    pts.push({ x: r + r * Math.cos(a), y: y0 + r + r * Math.sin(a) });
  }
  // 앞면만(상자 모델: 옆면은 따로 그린다)이면 오른쪽 윗모서리도 왼쪽처럼 둥글게
  const frontOnly = side >= 0.999;
  // 옆면 바깥 윗모서리도 둥글게(시안: 머리 양쪽 모서리가 모두 둥글다)
  // 크게 깎일 때(올려다봄)는 모서리를 작게 해서 깎인 대각선이 살아 있게 한다
  const rs = frontOnly ? Math.min(3 * s, w * 0.2) : ch > 2 * s ? Math.min(1.2 * s, (w - sideX) * 0.3) : Math.min(3 * s, (w - sideX) * 0.9);
  for (let x = r + step; x < (frontOnly ? w - rs : sideX); x += step) pts.push({ x, y: headY(x) + amp * wTop(x / s) });
  if (!frontOnly) pts.push({ x: sideX, y: headY(sideX) });
  // 옆면 윗모서리는 앞면 모서리 높이(머리 곡선 끝)에서 시작해 ch만큼 내려간다(앞면보다 튀어 오르지 않게)
  const sy = frontOnly ? headY(w) : headY(sideX) + ch;
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 5);
    pts.push({ x: w - rs + rs * Math.cos(a), y: sy + rs + rs * Math.sin(a) });
  }
  for (let y = sy + rs + step; y < h - rb; y += step) pts.push({ x: w - amp * wRight(y / s), y });
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI / 2) * (i / 4);
    pts.push({ x: w - rb + rb * Math.cos(a), y: h - rb + rb * Math.sin(a) });
  }
  for (let x = w - rb - step; x > rb; x -= step) pts.push({ x, y: h - 0.5 * amp * wBottom(x / s) });
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / 4);
    pts.push({ x: rb + rb * Math.cos(a), y: h - rb + rb * Math.sin(a) });
  }
  for (let y = h - rb - step; y > y0 + r; y -= step) pts.push({ x: amp * wLeft(y / s), y });
  return pts;
}

// 내려다보는 세운 책: 앞면 위에 윗면 평행사변형(뒤 모서리가 옆면 폭만큼 오른쪽으로 밀림), 옆면 바닥도 뒤로 올라간다.
function topViewOutline(w: number, h: number, s: number, seed: string, side: number, topH: number): Point[] {
  const sideX = w * side;
  const d = w - sideX; // 옆면 폭 = 뒤로 물러나는 가로 거리
  const rb = 2 * s;
  const amp = WOBBLE * s;
  const step = 1.5 * s;
  const [wTop, wRight, wBottom, wLeft] = [0, 1, 2, 3].map((e) => wobble(seed, e));
  const pts: Point[] = [];
  pts.push({ x: 0, y: topH + 1.4 * s });
  pts.push({ x: 0.7 * s, y: topH + 0.3 * s });
  pts.push({ x: d + 0.4 * s, y: 0.35 * s });
  for (let x = d + 0.4 * s + step; x < w - 1.2 * s; x += step) pts.push({ x, y: 0.5 * amp * wTop(x / s) });
  pts.push({ x: w - 0.6 * s, y: 0.1 * s });
  pts.push({ x: w, y: 0.9 * s });
  for (let y = 0.9 * s + step; y < h - topH - rb; y += step) pts.push({ x: w - amp * wRight(y / s), y });
  pts.push({ x: w, y: h - topH });
  pts.push({ x: sideX + 0.6 * s, y: h - 0.3 * s });
  for (let x = sideX - step; x > rb; x -= step) pts.push({ x, y: h - 0.5 * amp * wBottom(x / s) });
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / 4);
    pts.push({ x: rb + rb * Math.cos(a), y: h - rb + rb * Math.sin(a) });
  }
  for (let y = h - rb - step; y > topH + 1.4 * s; y -= step) pts.push({ x: amp * wLeft(y / s), y });
  return pts;
}

// 표지 윤곽: 둥근 네 모서리 + 손으로 그은 듯한 흔들림
function coverOutline(w: number, h: number, s: number, seed: string): Point[] {
  const r = 3 * s;
  const amp = WOBBLE * s;
  const step = 2 * s;
  const wv = [0, 1, 2, 3].map((e) => wobble(seed, e));
  const pts: Point[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (Math.PI / 2) * (i / 5);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  corner(w - r, r, -Math.PI / 2);
  for (let y = r + step; y < h - r; y += step) pts.push({ x: w - amp * wv[1](y / s), y });
  corner(w - r, h - r, 0);
  for (let x = w - r - step; x > r; x -= step) pts.push({ x, y: h - 0.5 * amp * wv[2](x / s) });
  corner(r, h - r, Math.PI / 2);
  for (let y = h - r - step; y > r; y -= step) pts.push({ x: amp * wv[3](y / s), y });
  corner(r, r, Math.PI);
  for (let x = r + step; x < w - r; x += step) pts.push({ x, y: amp * wv[0](x / s) });
  return pts;
}

const poly = (pts: Point[]) => Skia.Path.Polygon(pts.map((q) => ({ x: q.x, y: q.y })), true);
const line = (pts: Point[]) => Skia.Path.Polygon(pts.map((q) => ({ x: q.x, y: q.y })), false);

// 빛 받는 가장자리: 왼쪽 위에서 오는 빛에 둥근 모서리(머리·왼쪽 가장자리)가 밝게 빛난다(시안 모순·데미안).
// 윤곽 선을 흰색으로 그리고 위쪽·왼쪽 띠로만 보이게 가린다. lying: 몸체가 눕혀져 그려지는 경우(화면 위 = 몸체 오른쪽).
function RimLight({ outline, w, h, s, lying = false }: { outline: SkPath; w: number; h: number; s: number; lying?: boolean }) {
  const t = 6 * s;
  const l = 4 * s;
  const fade = (x0: number, y0: number, x1: number, y1: number) => (
    <LinearGradient start={vec(x0, y0)} end={vec(x1, y1)} colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']} />
  );
  const mask = lying ? (
    <Group>
      <Rect x={w - t} y={0} width={t} height={h}>{fade(w, 0, w - t, 0)}</Rect>
      <Rect x={0} y={0} width={w} height={l}>{fade(0, 0, 0, l)}</Rect>
    </Group>
  ) : (
    <Group>
      <Rect x={0} y={0} width={w} height={t}>{fade(0, 0, 0, t)}</Rect>
      <Rect x={0} y={0} width={l} height={h}>{fade(0, 0, l, 0)}</Rect>
    </Group>
  );
  return (
    <Mask mode="alpha" mask={mask}>
      <Path path={outline} style="stroke" strokeWidth={7 * s} color="rgba(255,255,255,0.18)">
        <BlurMask blur={1.1 * s} style="normal" />
      </Path>
      {/* 가장자리 선 바로 안쪽의 가늘고 또렷한 빛 선(시안: 책등 왼쪽·머리, 누운 책 앞면 윗모서리) */}
      <Path path={outline} style="stroke" strokeWidth={4.2 * s} color="rgba(255,255,255,0.5)">
        <BlurMask blur={0.25 * s} style="normal" />
      </Path>
    </Mask>
  );
}

// 가장자리 선: 책 색을 어둡게 한 또렷한 선 + 조금 어긋난 두 번째 선(굵기가 고르지 않은 손그림 선)
function EdgeLine({ outline, outline2, s, face, opacity = 1 }: { outline: SkPath; outline2: SkPath; s: number; face: string; opacity?: number }) {
  const edge = scaleColor(face, edgeFactor(face));
  return (
    <Group opacity={opacity}>
      <Path path={outline} style="stroke" strokeWidth={2.2 * s} color={edge}>
        <BlurMask blur={0.3 * s} style="normal" />
      </Path>
      <Path path={outline2} style="stroke" strokeWidth={2.2 * s} color={edge} opacity={0.3}>
        <BlurMask blur={0.35 * s} style="normal" />
      </Path>
    </Group>
  );
}

export function Grain({ w, h, s, image }: { w: number; h: number; s: number; image: SkImageType | null }) {
  if (!image) return null;
  return (
    <Rect x={0} y={0} width={w} height={h} blendMode="softLight" opacity={GRAIN_STRENGTH}>
      <ImageShader image={image} tx="repeat" ty="repeat" transform={[{ scale: SRC_DU * s }]} />
    </Rect>
  );
}

// 세운 책 몸체(캔버스 없이, 부모 좌표 0..w, 0..h). side: 옆면 시작 비율. mirror: 옆면을 왼쪽에(가운데보다 오른쪽 책).
// 가장자리는 회색 선 대신 책 색보다 조금 진한 같은 색 테두리를 안쪽으로 부드럽게 두른다(시안).
function SpineSkin({
  id,
  w,
  h,
  s,
  face,
  side,
  grain,
  mirror = false,
  lying = false,
  chamfer,
  topH = 0,
}: {
  id: string;
  w: number;
  h: number;
  s: number;
  face: string;
  side: number;
  grain: SkImageType | null;
  mirror?: boolean;
  lying?: boolean;
  chamfer?: number;
  topH?: number;
}) {
  const mx = (p: Point) => (mirror ? { x: w - p.x, y: p.y } : p);
  const outline = useMemo(() => poly(bodyOutline(w, h, s, id, side, chamfer, topH).map(mx)), [w, h, s, id, side, mirror, chamfer, topH]);
  const outline2 = useMemo(() => poly(bodyOutline(w, h, s, `${id}~`, side, chamfer, topH).map(mx)), [w, h, s, id, side, mirror, chamfer, topH]);
  // 내려다볼 때 보이는 윗면(머리): 앞 모서리 FL-FR, 뒤 모서리 BL-BR. 가운데는 아이보리 종이, 양옆은 표지 판.
  const head = useMemo(() => {
    if (topH <= 0) return null;
    const sideX = w * side;
    const d = w - sideX;
    const P = (a: number, b: number) => mx({ x: a * sideX + b * d, y: topH * (1 - b) });
    return {
      face: poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]),
      pages: poly([P(0.1, 0.18), P(0.9, 0.18), P(0.9, 1), P(0.1, 1)]),
      ridge: line([P(0, 0), P(1, 0)]),
      a: P(0, 0),
      b: P(1, 0),
    };
  }, [w, s, side, mirror, topH]);
  const ch = chamfer ?? w * Math.max(0.03, Math.min(CHAMFER, 1 - side));
  const sideTop = useMemo(
    () => {
      const b = HEAD_BOW * s; // 앞면 모서리는 머리 곡선만큼 내려와 있다
      return poly([{ x: w * side, y: b }, { x: w, y: b + ch }, { x: w, y: b + ch + 1.6 * s }, { x: w * side, y: b + 1.6 * s }].map(mx));
    },
    [w, s, side, mirror, ch],
  );
  const prof =
    side >= 0.999 ? frontProfile(face, lying) : lying ? lyingProfile(side, face) : shadeProfile(spineProfile(side), side, face, mirror);
  return (
    <Group>
      <Group clip={outline}>
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient
            start={vec(mirror ? w : 0, 0)}
            end={vec(mirror ? 0 : w, 0)}
            colors={prof.map(([, k]) => scaleColor(face, k))}
            positions={prof.map(([p]) => p)}
          />
        </Rect>
        <Grain w={w} h={h} s={s} image={grain} />
        {head ? (
          <>
            <Path path={head.face} color={scaleColor(face, 1.05)} />
            <Path path={head.pages}>
              <LinearGradient start={vec(0, topH)} end={vec(0, 0)} colors={[mix(scaleColor(PAGE, 0.9), face, 0.15), mix(scaleColor(PAGE, 0.82), face, 0.2)]} />
            </Path>
            <Path path={head.ridge} style="stroke" strokeWidth={0.9 * s} strokeCap="round">
              <LinearGradient start={vec(head.a.x, head.a.y)} end={vec(head.b.x, head.b.y)} colors={['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.3)']} />
              <BlurMask blur={0.3 * s} style="normal" />
            </Path>
          </>
        ) : (
          <Path path={sideTop} color="rgba(255,255,255,0.16)" />
        )}
        {/* 면이 꺾이는 모서리의 빛 반사(앞면과 옆면 사이, 누운 책은 앞면과 윗면 사이).
            빛이 오는 머리 쪽(누운 책은 왼쪽)이 가장 밝고 멀어질수록 사라진다 */}
        <Rect x={mirror ? w * (1 - side) - 0.9 * s : Math.min(w * side, w - 0.9 * s)} y={0} width={0.9 * s} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={GLINT} positions={GLINT_AT} />
          <BlurMask blur={0.45 * s} style="normal" />
        </Rect>
        {lying ? (
          // 누운 책: 앞면 아랫부분(몸체 왼쪽)이 바닥·아래 책에 가려 어둡다
          <Rect x={0} y={0} width={3 * s} height={h}>
            <LinearGradient start={vec(0, 0)} end={vec(3 * s, 0)} colors={['rgba(60,40,30,0.16)', 'rgba(60,40,30,0)']} />
          </Rect>
        ) : null}
        {/* 바닥 쪽 살짝 어둡게 */}
        <Rect x={0} y={h - 3 * s} width={w} height={3 * s}>
          <LinearGradient start={vec(0, h - 3 * s)} end={vec(0, h)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.1)']} />
        </Rect>
        {/* 가장자리 안쪽 살짝 어둡게(둥글게 넘어가는 모서리) */}
        <Path path={outline} style="stroke" strokeWidth={3.5 * s} color={scaleColor(face, 0.85)} opacity={0.1 + 0.45 * (1 - luminance(face))}>
          <BlurMask blur={1.4 * s} style="normal" />
        </Path>
        <RimLight outline={outline} w={w} h={h} s={s} lying={lying} />
        {/* 또렷한 같은 색 가장자리 선(안쪽 절반만 보인다: 약 1.1DU) */}
        <EdgeLine outline={outline} outline2={outline2} s={s} face={face} />
      </Group>
      {/* 클립 경계는 계단처럼 깨지므로 실루엣 바깥을 부드러운 선으로 한 번 더 덮는다 */}
      <Path path={outline} style="stroke" strokeWidth={0.9 * s} color={scaleColor(face, edgeFactor(face))} antiAlias />
    </Group>
  );
}

// 책등 그림: 작은 모티프는 앞면 가운데에 원래 비율로, 장면(scene)은 앞면 폭을 채우고 윗경계를 책 색으로 녹인다.
function SpineArt({ h, art, motif, faceW, x0 = 0 }: { h: number; art: BodyArt; motif: SkImageType; faceW: number; x0?: number }) {
  const top = art.motifTop * h;
  const mh = Math.max(4, (Math.max(art.motifBottom, art.motifTop + 0.1) - art.motifTop) * h);
  if (art.scene) {
    const bh = h - top;
    const fade = bh * 0.34;
    return (
      <Group clip={Skia.XYWHRect(x0, 0, faceW + 1, h)}>
        {/* 그림 윗부분을 투명하게 녹여 아래 책등(명암·결)이 비치게 한다 */}
        <Mask
          mode="alpha"
          mask={
            <Rect x={x0} y={top} width={faceW + 1} height={bh}>
              <LinearGradient start={vec(0, top)} end={vec(0, top + fade)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']} />
            </Rect>
          }>
          <SkImage image={motif} x={x0} y={top} width={faceW + 1} height={bh} fit="cover" />
        </Mask>
      </Group>
    );
  }
  let mw = (mh * motif.width()) / motif.height();
  let mH = mh;
  if (mw > faceW * 0.9) {
    mH = (mH * faceW * 0.9) / mw;
    mw = faceW * 0.9;
  }
  const cx = Math.min(Math.max(art.motifCx * faceW, mw / 2 + 1), faceW - mw / 2 - 1);
  return <SkImage image={motif} x={x0 + cx - mw / 2} y={top + (mh - mH)} width={mw} height={mH} fit="contain" />;
}

type BodyProps = { id: string; width: number; height: number; scale: number; face: string; art?: BodyArt };

export const faceWidth = (w: number, side = SPINE_SIDE) => w * (side - GROOVE);

// 세운 책. view: 가운데 시점(-1~1)
export const SpineBody = memo(function SpineBody({
  id,
  width: w,
  height: h,
  scale: s,
  face,
  art,
  view = 0,
  viewY = 0,
  frontOnly = false,
}: BodyProps & { view?: number; viewY?: number; frontOnly?: boolean }) {
  const grain = useImage(BRUSH_DETAIL);
  const motif = useImage(art?.motif ?? null);
  const { side, mirror } = frontOnly ? { side: 1, mirror: false } : spineView(view);
  const fw = faceWidth(w, side);
  const x0 = mirror ? w - fw : 0;
  // 세로 시점: 올려다보면 옆면 윗부분이 깎여 보이고(깎임은 옆면 폭에 비례), 눈높이면 평평, 내려다보면 윗면이 보인다
  const topH = !frontOnly && viewY > 0 ? TOP_VIEW * viewY * s : 0;
  const chamfer = frontOnly ? 0 : viewY < 0 ? w * (1 - side) * 1.3 * -viewY : 0.4 * s; // 시안 1줄: 옆면 폭보다 조금 더 깎인다
  const clip = useMemo(
    () => poly(bodyOutline(w, h, s, id, side, chamfer, topH).map((p) => (mirror ? { x: w - p.x, y: p.y } : p))),
    [w, h, s, id, side, mirror, chamfer, topH],
  );
  return (
    <Canvas style={{ width: w, height: h }}>
      <SpineSkin id={id} w={w} h={h} s={s} face={face} side={side} grain={grain} mirror={mirror} chamfer={chamfer} topH={topH} />
      {art && motif ? (
        <Group clip={clip}>
          <SpineArt h={h} art={art} motif={motif} faceW={fw} x0={x0} />
        </Group>
      ) : null}
    </Canvas>
  );
});

// 누운 책: 사선 투영 상자(시안 좋은 문장·찰나의 마음). 세운 몸체를 반시계로 90도 눕혀 앞면(책등)과 윗면을 만들고
// (책 머리가 왼쪽, 옆면이 위를 향한 윗면, 왼쪽 끝은 45도로 깎임), 오른쪽에 뒤로 물러나는 끝면(책 배 쪽 종이)을 붙인다.
// 윗면 뒤쪽 모서리는 끝면 폭 e만큼 오른쪽으로 밀린 평행사변형이 된다. topFace = 위에서 보이는 윗면 두께(px).
// 모티프는 눕히지 않고 앞면 오른쪽 끝에 바로 세워 그린다.
export const LyingBody = memo(function LyingBody({ id, width: len, height: H, scale: s, face, art, topFace }: BodyProps & { topFace: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const motif = useImage(art?.motif ?? null);
  const e = topFace; // 끝면 폭 = 윗면 깊이(45도)
  const L = len - e; // 앞면 길이
  const side = 1 - topFace / H;
  const fw = faceWidth(H, side); // 앞면 두께(px)
  let mh = fw * 0.6;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > len * 0.22) {
    mh = (mh * len * 0.22) / mw;
    mw = len * 0.22;
  }
  const prof = lyingProfile(side, face);
  const kAt = (p: number) => prof.find(([q]) => q >= p)?.[1] ?? 1;
  const at = (u: number, v: number) => ({ x: L + u * e, y: topFace * (1 - u) + v * (H - topFace) }); // 끝면 위 점(u: 앞→뒤, v: 위→아래)
  const shapes = useMemo(() => {
    const T = H - topFace;
    const b = Math.min(1.3 * s, T * 0.12); // 표지 판 두께
    const pages = [at(0.06, b / T), at(1, b / T), at(1, 1 - b / T), at(0.06, 1 - b / T)];
    const lines = [0.3, 0.5, 0.7].map((v) => [at(0.06, v), at(1, v)]);
    const m = 6;
    return {
      // 상자 실루엣: 끝면 아래(비스듬한 바닥 모서리) 바깥으로 몸체가 비어져 나오지 않게 자른다
      box: poly([{ x: -m, y: -m }, { x: len + m, y: -m }, { x: len + m, y: T - m }, { x: L - m, y: H + m }, { x: -m, y: H + m }]),
      end: poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)]),
      pages: poly(pages),
      lines: lines.map(([p, q]) => poly([p, q, { x: q.x, y: q.y + 0.6 }, { x: p.x, y: p.y + 0.6 }])),
      // 끝면 바깥 가장자리(오른쪽 끝과 비스듬한 바닥 모서리). 나머지 실루엣은 몸체가 그린다
      rim: line([at(1, 0), at(1, 1), at(0, 1)]),
      ridgeFront: line([at(0, 0.02), at(0, 1)]),
      ridgeTop: line([at(0, 0), at(1, 0)]),
    };
  }, [L, e, H, topFace, s, len]);
  const edge = scaleColor(face, edgeFactor(face));
  // 모서리 빛 반사: from(빛이 오는 끝) → to 로 옅어진다
  const ridge = (path: SkPath, from: Point, to: Point, a: number) => (
    <Path path={path} style="stroke" strokeWidth={0.9 * s} strokeCap="round">
      <LinearGradient start={vec(from.x, from.y)} end={vec(to.x, to.y)} colors={[`rgba(255,255,255,${a})`, `rgba(255,255,255,${a * 0.5})`]} />
      <BlurMask blur={0.3 * s} style="normal" />
    </Path>
  );
  if (topFace <= 0) {
    // 상자 모델: 앞면(누운 책등)만. 윗면·끝면은 상자 투영으로 따로 그린다
    return (
      <Canvas style={{ width: len, height: H }}>
        <Group transform={[{ translateY: H }, { rotate: -Math.PI / 2 }]}>
          <SpineSkin id={id} w={H} h={len} s={s} face={face} side={1} grain={grain} lying chamfer={0} />
        </Group>
        {motif ? <SkImage image={motif} x={len - mw - len * 0.06} y={H / 2 - mh / 2} width={mw} height={mh} fit="contain" /> : null}
      </Canvas>
    );
  }
  return (
    <Canvas style={{ width: len, height: H }}>
      {/* 앞면·윗면은 끝까지 한 장으로(윗면 뒤쪽 모서리가 오른쪽 끝까지 이어진다). 끝면이 앞면 끝을 덮는다 */}
      <Group clip={shapes.box}>
        <Group transform={[{ translateY: H }, { rotate: -Math.PI / 2 }]}>
          <SpineSkin id={id} w={H} h={len} s={s} face={face} side={side} grain={grain} lying chamfer={topFace} />
        </Group>
      </Group>
      {/* 끝면: 위아래 얇은 표지 판(책 색) 사이로 아이보리 종이 단면. 빛 반대쪽이라 뒤로 갈수록 조금 어둡다 */}
      <Group clip={shapes.end}>
        <Rect x={L} y={0} width={e} height={H}>
          <LinearGradient start={vec(L, 0)} end={vec(L + e, 0)} colors={[scaleColor(face, 0.86), scaleColor(face, 0.76)]} />
        </Rect>
        <Path path={shapes.pages}>
          <LinearGradient start={vec(L, 0)} end={vec(L + e, 0)} colors={[scaleColor(PAGE, 0.97), scaleColor(PAGE, 0.88)]} />
        </Path>
        {shapes.lines.map((l, i) => (
          <Path key={i} path={l} color={PAGE_LINE} opacity={0.45} />
        ))}
        <Grain w={len} h={H} s={s} image={grain} />
      </Group>
      {/* 면이 꺾이는 모서리의 빛 반사: 앞면과 끝면, 윗면과 끝면 사이 */}
      {/* 앞면 윗모서리의 또렷한 빛 선(시안 좋은 문장: 앞면이 윗면으로 꺾이는 곳) */}
      <Path path={line([{ x: topFace + 1.5 * s, y: topFace + 0.7 * s }, { x: L - 1 * s, y: topFace + 0.7 * s }])} style="stroke" strokeWidth={0.9 * s} strokeCap="round">
        <LinearGradient start={vec(0, 0)} end={vec(L, 0)} colors={['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.3)']} />
        <BlurMask blur={0.3 * s} style="normal" />
      </Path>
      {ridge(shapes.ridgeFront, at(0, 0), at(0, 1), 0.45)}
      {ridge(shapes.ridgeTop, at(0, 0), at(1, 0), 0.5)}
      <Path path={shapes.rim} style="stroke" strokeWidth={1.6 * s} color={edge} strokeJoin="round" antiAlias />
      {motif ? <SkImage image={motif} x={L - mw - len * 0.05} y={H - fw / 2 - mh / 2} width={mw} height={mh} fit="contain" /> : null}
    </Canvas>
  );
});

// 표지 전시: 앞표지(그림 또는 책 색) + 오른쪽 얇은 속지 단면
// 표지 전시 책의 윗면 높이(px): 내려다보는 줄에서만 보인다(세운 책과 같은 규칙)
export const coverTopH = (viewY: number, s: number) => (viewY > 0 ? TOP_VIEW * 0.6 * viewY * s : 0); // 표지 책은 얇게(두께가 작다)

// 표지 전시: 앞표지 + 뒤로 물러나는 옆면(평행사변형) + 내려다볼 때 윗면. 책은 오른쪽으로 열리므로
// 왼쪽 옆면 = 책등(책 색), 오른쪽 옆면 = 여는 쪽 종이 단면(앞뒤 표지 판 사이 아이보리).
// 가운데보다 오른쪽 책(mirror)은 왼쪽 옆면(책등)이, 왼쪽 책은 오른쪽 옆면(종이)이 보인다.
export const CoverBody = memo(function CoverBody({
  id,
  width: fw,
  height: h,
  scale: s,
  face,
  side: d,
  cover,
  art,
  mirror = false,
  edge,
  viewY = 0,
}: BodyProps & { side: number; cover?: ImageSource; mirror?: boolean; edge?: string; viewY?: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const tone = edge ?? face; // 표지 그림이 있으면 그림 가장자리 색으로 테두리·옆면을 칠한다
  const image = useImage((cover as number) ?? null);
  const motif = useImage(art?.motif ?? null);
  const topH = coverTopH(viewY, s);
  const ch = h - topH; // 앞표지 높이
  const cx = mirror ? d : 0; // 앞표지 왼쪽
  const outline = useMemo(() => poly(coverOutline(fw, ch, s, id)), [fw, ch, s, id]);
  const outline2 = useMemo(() => poly(coverOutline(fw, ch, s, `${id}~`)), [fw, ch, s, id]);
  // 옆면: 앞 모서리(표지 가장자리)와 뒤 모서리(d만큼 바깥). 뒤 모서리 위아래는 세로 시점에 따라 움직인다.
  const faces = useMemo(() => {
    const fx = mirror ? d : fw; // 앞 모서리 x
    const bx = mirror ? 0 : fw + d; // 뒤 모서리 x
    const bt = viewY > 0 ? 0 : topH + (viewY < 0 ? d * 1.3 * -viewY : 0.4 * s); // 뒤 모서리 위
    const bb = viewY > 0 ? h - topH : h; // 뒤 모서리 아래
    const P = (u: number, v: number) => {
      // u: 앞(0)→뒤(1), v: 위(0)→아래(1)
      const top = topH + (bt - topH) * u;
      const bot = h + (bb - h) * u;
      return { x: fx + (bx - fx) * u, y: top + (bot - top) * v };
    };
    const inset = 1.2 * s / ch;
    const sideFace = poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]);
    const pages = poly([P(0.16, inset), P(0.86, inset), P(0.86, 1 - inset), P(0.16, 1 - inset)]);
    const lines = [0.4, 0.62].map((u) => line([P(u, inset + 0.01), P(u, 1 - inset - 0.01)]));
    // 윗면(내려다볼 때): 앞표지 윗변에서 옆면 쪽으로 d, 위로 topH 물러난 평행사변형
    const sx = mirror ? -d : d;
    const top = topH > 0 ? poly([{ x: cx, y: topH }, { x: cx + fw, y: topH }, { x: cx + fw + sx, y: 0 }, { x: cx + sx, y: 0 }]) : null;
    const topPages =
      topH > 0
        ? poly([
            { x: cx + fw * 0.03 + sx * 0.15, y: topH * 0.85 },
            { x: cx + fw * 0.97 + sx * 0.15, y: topH * 0.85 },
            { x: cx + fw * 0.97 + sx * 0.85, y: topH * 0.15 },
            { x: cx + fw * 0.03 + sx * 0.85, y: topH * 0.15 },
          ])
        : null;
    return { sideFace, pages, lines, top, topPages, front: line([P(0, 0), P(0, 1)]), a: P(0, 0), b: P(1, 0) };
  }, [fw, h, d, s, mirror, viewY, topH, ch, cx]);
  let mh = ch * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  const edgeC = scaleColor(tone, edgeFactor(tone));
  return (
    <Canvas style={{ width: fw + d, height: h }}>
      {/* 옆면(채움은 Path로 해야 비스듬한 가장자리가 매끈하다). 상자 모델(d = 0)에서는 따로 그린다 */}
      {d > 0 ? (
      <>
      <Path path={faces.sideFace}>
        {mirror ? (
          // 책등: 빛(왼쪽 위)을 향해 밝고, 둥근 등이라 가운데가 조금 더 밝다
          <LinearGradient start={vec(0, 0)} end={vec(d, 0)} colors={[scaleColor(tone, 0.9), scaleColor(tone, 0.97), scaleColor(tone, 0.93)]} />
        ) : (
          // 여는 쪽: 앞뒤 표지 판(책 색). 빛 반대쪽이라 조금 어둡다
          <LinearGradient start={vec(fw, 0)} end={vec(fw + d, 0)} colors={[scaleColor(tone, 0.88), scaleColor(tone, 0.8)]} />
        )}
      </Path>
      {mirror ? null : (
        <>
          {/* 판 사이로 보이는 아이보리 종이 단면 */}
          <Path path={faces.pages}>
            <LinearGradient start={vec(fw, 0)} end={vec(fw + d, 0)} colors={[scaleColor(PAGE, 0.94), scaleColor(PAGE, 0.86)]} />
          </Path>
          {faces.lines.map((l, i) => (
            <Path key={i} path={l} style="stroke" strokeWidth={0.5} color={PAGE_LINE} opacity={0.6} />
          ))}
        </>
      )}
      <Group clip={faces.sideFace}>
        <Grain w={fw + d} h={h} s={s} image={grain} />
      </Group>
      </>
      ) : null}
      {/* 윗면(내려다볼 때): 앞뒤 표지 판 사이 종이 */}
      {faces.top ? (
        <>
          <Path path={faces.top} color={mix(scaleColor(tone, 1.02), PAGE, 0.35)} />
          {faces.topPages ? (
            <Path path={faces.topPages}>
              <LinearGradient start={vec(0, topH)} end={vec(0, 0)} colors={[mix(scaleColor(PAGE, 0.92), tone, 0.1), mix(scaleColor(PAGE, 0.84), tone, 0.15)]} />
            </Path>
          ) : null}
        </>
      ) : null}
      {/* 앞표지 */}
      <Group transform={[{ translateX: cx }, { translateY: topH }]}>
        <Group clip={outline}>
          <Rect x={0} y={0} width={fw} height={ch} color={face} />
          {image ? <SkImage image={image} x={0} y={0} width={fw} height={ch} fit="cover" /> : null}
          {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={ch * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
          <Grain w={fw} h={ch} s={s} image={grain} />
          {/* 제본선(시안: 왼쪽에서 조금 안쪽의 가는 홈 하나) */}
          <Rect x={0} y={0} width={fw * 0.05} height={ch}>
            <LinearGradient start={vec(0, 0)} end={vec(fw * 0.05, 0)} colors={['rgba(0,0,0,0.07)', 'rgba(0,0,0,0)']} />
          </Rect>
          <Rect x={fw * 0.04} y={0} width={0.7 * s} height={ch} color="rgba(40,30,20,0.16)">
            <BlurMask blur={0.35 * s} style="normal" />
          </Rect>
          <Rect x={fw * 0.04 + 0.9 * s} y={0} width={0.6 * s} height={ch} color="rgba(255,255,255,0.14)" />
          <Rect x={0} y={0} width={fw} height={ch}>
            <LinearGradient start={vec(0, 0)} end={vec(fw, ch)} colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.08)']} positions={[0, 0.45, 1]} />
          </Rect>
          <RimLight outline={outline} w={fw} h={ch} s={s} />
          {/* 표지 그림은 그 자체로 경계가 보이므로 선은 반만(진하면 액자처럼 보인다) */}
          <EdgeLine outline={outline} outline2={outline2} s={s} face={tone} opacity={image ? 0.5 : 1} />
        </Group>
        <Path path={outline} style="stroke" strokeWidth={0.6 * s} color={edgeC} opacity={0.8} antiAlias />
      </Group>
      {/* 앞표지와 옆면이 꺾이는 모서리의 빛 반사(위가 밝고 아래로 사라진다) */}
      <Path path={faces.front} style="stroke" strokeWidth={0.9 * s}>
        <LinearGradient start={vec(0, topH)} end={vec(0, h)} colors={GLINT} positions={GLINT_AT} />
        <BlurMask blur={0.3 * s} style="normal" />
      </Path>
    </Canvas>
  );
});
