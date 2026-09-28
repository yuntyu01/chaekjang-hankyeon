// 책 면 그림(캔버스 없이, 면 그림 좌표 0..w, 0..h). 상자 렌더러(ui/book3d)가 Skia Picture로 기록해 면 변환에 태워 그린다.
// 책등 면: 둥근 책등 명암 + 붓결 + 가장자리(손으로 그은 선, 빛 받는 테). 옆면·윗면과 이어지는 변(오른쪽·위)은 선 없이.
// 표지 면: 표지 그림(없으면 책 색 + 모티프) + 제본선 + 가장자리. 제목·작은 모티프는 따로 그린다(누울 때 바로 세우려고).
import {
  BlurMask,
  Group,
  Image as SkImage,
  ImageShader,
  LinearGradient,
  Mask,
  Path,
  Rect,
  Skia,
  vec,
  type SkImage as SkImageType,
  type SkPath,
} from '@shopify/react-native-skia';
import type { ReactNode } from 'react';

import type { Point } from '@/domain/shelf-scene';
import type { BodyArt } from '@/domain/types';

const SRC_DU = 390 / 941; // 시안 원본 1px = DU(붓결 크기를 시안과 맞춘다)
// 붓결 세기(시안: 은은함). 질감 이미지는 명암 차를 5배로 담아 두었으므로 여기서 줄인다.
export const GRAIN_STRENGTH = 0.22;
export const PAGE = '#F4ECDD';
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

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// 실루엣 가장자리 선: 책 색을 어둡게 한 같은 색. 선은 구분만 될 만큼(진하면 틀처럼 보인다)
export const edgeFactor = (face: string) => 0.74 + 0.2 * luminance(face);

// 책등 앞면의 가로 명암: 옆면으로 꺾이는 오른쪽 끝이 조금 어둡다(밝은 책일수록 명암 폭이 작다)
function spineProfile(face: string): [number, number][] {
  const lum = luminance(face);
  const w = 0.35 + 0.75 * (1 - lum);
  // 둥근 책등(베개처럼): 왼쪽 가장자리 바로 안쪽이 가장 밝은 띠, 가운데 평평, 오른쪽으로 둥글게 넘어가며 어두워진다
  const raw: [number, number][] = [[0, 0.9], [0.04, 1.02], [0.1, 1.07], [0.2, 1.03], [0.45, 1.0], [0.75, 0.97], [0.9, 0.92], [1, 0.86]];
  return raw.map(([p, k]) => [p, 1 - (1 - k) * w] as [number, number]);
}

// 결정적 잡음(책마다 같은 모양)
function jitter(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (i: number) => {
    const x = Math.sin((h % 1000) * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x) - 0.5;
  };
}

// 손으로 그은 선의 흔들림: 파장이 다른 사인 둘을 더한 부드러운 잡음(0~1). t는 선을 따라간 거리(DU). 늘 안쪽으로만 민다.
export const WOBBLE = 0.32; // 최대 흔들림(DU)
function wobble(seed: string, edge: number) {
  const r = jitter(seed);
  const waves = [24, 10].map((len, i) => ({ len, amp: [0.65, 0.35][i], ph: (r(edge * 7 + i) + 0.5) * Math.PI * 2 }));
  return (t: number) => 0.5 + 0.5 * waves.reduce((sum, w) => sum + w.amp * Math.sin((t / w.len) * Math.PI * 2 + w.ph), 0);
}

// 책등 머리가 볼록한 정도(DU): 윗면이 같은 곡선을 따라가므로 아주 살짝
export const BOX_HEAD_BOW = 0.3;

// 책등 면 윤곽(px): 둥근 왼쪽 위, 살짝 볼록한 머리. 옆면·윗면과 이어지는 오른쪽·위·아래 변은 곧게, 왼쪽 바깥 변만 손그림 흔들림.
function spineOutline(w: number, h: number, s: number, seed: string): Point[] {
  const r = 3.4 * s;
  const rb = 2.2 * s;
  const rs = 2.4 * s;
  const bow = BOX_HEAD_BOW * s;
  const amp = WOBBLE * s;
  const step = 1.5 * s;
  const wLeft = wobble(seed, 3);
  const headY = (x: number) => bow * (1 - Math.sin((Math.PI * Math.min(x, w)) / w));
  const pts: Point[] = [];
  const y0 = headY(r);
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / 6);
    pts.push({ x: r + r * Math.cos(a), y: y0 + r + r * Math.sin(a) });
  }
  for (let x = r + step; x < w - rs; x += step) pts.push({ x, y: headY(x) });
  const sy = headY(w);
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 5);
    pts.push({ x: w - rs + rs * Math.cos(a), y: sy + rs + rs * Math.sin(a) });
  }
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI / 2) * (i / 4);
    pts.push({ x: w - rb + rb * Math.cos(a), y: h - rb + rb * Math.sin(a) });
  }
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / 4);
    pts.push({ x: rb + rb * Math.cos(a), y: h - rb + rb * Math.sin(a) });
  }
  for (let y = h - rb - step; y > y0 + r; y -= step) pts.push({ x: amp * wLeft(y / s), y });
  return pts;
}

// 표지 윤곽: 둥근 네 모서리 + 손으로 그은 듯한 흔들림
function coverOutline(w: number, h: number, s: number, seed: string): Point[] {
  const r = 3.4 * s;
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

// 빛 받는 가장자리: 왼쪽 위 빛에 둥근 모서리(머리·왼쪽 가장자리)가 밝게 빛난다(시안 모순·데미안).
function RimLight({ outline, w, h, s }: { outline: SkPath; w: number; h: number; s: number }) {
  const t = 6 * s;
  const l = 4 * s;
  const fade = (x0: number, y0: number, x1: number, y1: number) => (
    <LinearGradient start={vec(x0, y0)} end={vec(x1, y1)} colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0)']} />
  );
  return (
    <Mask
      mode="alpha"
      mask={
        <Group>
          <Rect x={0} y={0} width={w} height={t}>{fade(0, 0, 0, t)}</Rect>
          <Rect x={0} y={0} width={l} height={h}>{fade(0, 0, l, 0)}</Rect>
        </Group>
      }>
      <Path path={outline} style="stroke" strokeWidth={7 * s} color="rgba(255,255,255,0.18)">
        <BlurMask blur={1.1 * s} style="normal" />
      </Path>
      <Path path={outline} style="stroke" strokeWidth={4.2 * s} color="rgba(255,255,255,0.22)">
        <BlurMask blur={0.9 * s} style="normal" />
      </Path>
    </Mask>
  );
}

// 가장자리 선: 책 색을 어둡게 한 또렷한 선 + 조금 어긋난 두 번째 선(굵기가 고르지 않은 손그림 선)
function EdgeLine({ outline, outline2, s, face, opacity = 1 }: { outline: SkPath; outline2: SkPath; s: number; face: string; opacity?: number }) {
  const edge = scaleColor(face, edgeFactor(face));
  return (
    <Group opacity={opacity}>
      {/* 선이 아니라 가장자리가 둥글게 넘어가며 살짝 어두워지는 정도(목업: 또렷한 윤곽선 없음) */}
      <Path path={outline} style="stroke" strokeWidth={3.2 * s} color={edge} opacity={0.35}>
        <BlurMask blur={1.1 * s} style="normal" />
      </Path>
      <Path path={outline2} style="stroke" strokeWidth={1.6 * s} color={edge} opacity={0.12}>
        <BlurMask blur={0.6 * s} style="normal" />
      </Path>
    </Group>
  );
}

// 다른 면과 이어지는 변(오른쪽·위)에서는 가장자리 선을 지운다: 그 변은 선이 아니라 빛·그늘로 구분한다.
function Joined({ w, h, s, children }: { w: number; h: number; s: number; children: ReactNode }) {
  const m = 10 * s;
  const cut = 2 * s;
  return <Group clip={Skia.XYWHRect(-m, cut, w - cut + m, h + m - cut)}>{children}</Group>;
}

export function Grain({ w, h, s, image }: { w: number; h: number; s: number; image: SkImageType | null }) {
  if (!image) return null;
  return (
    <Rect x={0} y={0} width={w} height={h} blendMode="softLight" opacity={GRAIN_STRENGTH}>
      <ImageShader image={image} tx="repeat" ty="repeat" transform={[{ scale: SRC_DU * s }]} />
    </Rect>
  );
}

// 책등 면(제목·작은 모티프 제외). 장면(scene) 그림은 면에 그대로 붙인다.
export function SpineFaceArt({ id, w, h, s, face, art, grain, motif }: { id: string; w: number; h: number; s: number; face: string; art?: BodyArt; grain: SkImageType | null; motif: SkImageType | null }) {
  const outline = poly(spineOutline(w, h, s, id));
  const outline2 = poly(spineOutline(w, h, s, `${id}~`));
  const prof = spineProfile(face);
  return (
    <Group>
      <Group clip={outline}>
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={prof.map(([, k]) => scaleColor(face, k))} positions={prof.map(([p]) => p)} />
        </Rect>
        <Grain w={w} h={h} s={s} image={grain} />
        {art?.scene && motif ? <SceneArt h={h} art={art} motif={motif} faceW={w * 0.94} /> : null}
        {/* 머리 쪽 윗가장자리가 둥글게 빛을 받는다 */}
        <Rect x={0} y={0} width={w} height={4 * s}>
          <LinearGradient start={vec(0, 0)} end={vec(0, 4 * s)} colors={['rgba(255,252,244,0.22)', 'rgba(255,252,244,0)']} />
        </Rect>
        {/* 바닥 쪽 어둡게(선반에 닿는 곳) */}
        <Rect x={0} y={h - 5 * s} width={w} height={5 * s}>
          <LinearGradient start={vec(0, h - 5 * s)} end={vec(0, h)} colors={['rgba(60,40,28,0)', 'rgba(60,40,28,0.16)']} />
        </Rect>
        {/* 가장자리 안쪽 살짝 어둡게(둥글게 넘어가는 모서리) */}
        <Path path={outline} style="stroke" strokeWidth={3.5 * s} color={scaleColor(face, 0.85)} opacity={0.1 + 0.45 * (1 - luminance(face))}>
          <BlurMask blur={1.4 * s} style="normal" />
        </Path>
        <RimLight outline={outline} w={w} h={h} s={s} />
        <Joined w={w} h={h} s={s}>
          <EdgeLine outline={outline} outline2={outline2} s={s} face={face} />
        </Joined>
      </Group>
      {/* 클립 경계는 계단처럼 깨지므로 실루엣 바깥을 부드러운 선으로 한 번 더 덮는다 */}
      <Joined w={w} h={h} s={s}>
        <Path path={outline} style="stroke" strokeWidth={0.7 * s} color={scaleColor(face, edgeFactor(face))} opacity={0.55} antiAlias />
      </Joined>
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
  let mw = (mh * motif.width()) / motif.height();
  let mH = mh;
  if (mw > faceW * 0.9) {
    mH = (mH * faceW * 0.9) / mw;
    mw = faceW * 0.9;
  }
  const cx = Math.min(Math.max(art.motifCx * faceW, mw / 2 + 1), faceW - mw / 2 - 1);
  return { x: cx - mw / 2, y: top + (mh - mH), w: mw, h: mH };
}

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
  const outline = poly(coverOutline(fw, h, s, id));
  const outline2 = poly(coverOutline(fw, h, s, `${id}~`));
  let mh = h * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  const edgeC = scaleColor(tone, edgeFactor(tone));
  return (
    <Group>
      <Group clip={outline}>
        <Rect x={0} y={0} width={fw} height={h} color={face} />
        {image ? <SkImage image={image} x={0} y={0} width={fw} height={h} fit="cover" /> : null}
        {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
        <Grain w={fw} h={h} s={s} image={grain} />
        {/* 제본선(시안: 왼쪽에서 조금 안쪽의 가는 홈 하나) */}
        <Rect x={0} y={0} width={fw * 0.05} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(fw * 0.05, 0)} colors={['rgba(0,0,0,0.07)', 'rgba(0,0,0,0)']} />
        </Rect>
        <Rect x={fw * 0.04} y={0} width={0.7 * s} height={h} color="rgba(40,30,20,0.16)">
          <BlurMask blur={0.35 * s} style="normal" />
        </Rect>
        <Rect x={fw * 0.04 + 0.9 * s} y={0} width={0.6 * s} height={h} color="rgba(255,255,255,0.14)" />
        <Rect x={0} y={0} width={fw} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(fw, h)} colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.08)']} positions={[0, 0.45, 1]} />
        </Rect>
        {/* 오른쪽 끝이 옆면으로 둥글게 넘어가며 어두워진다 */}
        <Rect x={fw - 5 * s} y={0} width={5 * s} height={h}>
          <LinearGradient start={vec(fw - 5 * s, 0)} end={vec(fw, 0)} colors={['rgba(60,40,28,0)', 'rgba(60,40,28,0.16)']} />
        </Rect>
        <Rect x={0} y={h - 5 * s} width={fw} height={5 * s}>
          <LinearGradient start={vec(0, h - 5 * s)} end={vec(0, h)} colors={['rgba(60,40,28,0)', 'rgba(60,40,28,0.14)']} />
        </Rect>
        <RimLight outline={outline} w={fw} h={h} s={s} />
        {/* 표지 그림은 그 자체로 경계가 보이므로 선은 반만(진하면 액자처럼 보인다) */}
        <Joined w={fw} h={h} s={s}>
          <EdgeLine outline={outline} outline2={outline2} s={s} face={tone} opacity={image ? 0.5 : 1} />
        </Joined>
      </Group>
      <Joined w={fw} h={h} s={s}>
        <Path path={outline} style="stroke" strokeWidth={0.6 * s} color={edgeC} opacity={0.5} antiAlias />
      </Joined>
    </Group>
  );
}
