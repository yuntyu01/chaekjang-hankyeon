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
import type { Point } from '@/domain/shelf-scene';
import type { BodyArt, ImageSource } from '@/domain/types';

const SRC_DU = 390 / 941; // 시안 원본 1px = DU(붓결 크기를 시안과 맞춘다)
// 붓결 세기(시안: 은은함). 질감 이미지는 명암 차를 5배로 담아 두었으므로 여기서 줄인다.
export const GRAIN_STRENGTH = 0.22;
export const SPINE_SIDE = 0.87; // 세운 책(시점 기본값): 옆면 시작(책 폭 비율)

// 가운데 시점: view(-1~1)에 따라 옆면 폭과 어느 쪽 옆면이 보이는지 정한다.
export function spineView(view: number) {
  const side = 1 - (0.05 + 0.1 * Math.abs(view)); // 가운데 책도 옆면이 조금은 보인다(시안: 깎인 윗모서리)
  return { side, mirror: view > 0.02 };
}
export const CHAMFER = 0.14; // 옆면 윗부분이 깎여 내려가는 정도(책 폭 비율)
const PAGE = '#F4ECDD';
const PAGE_LINE = '#DDCFB8';

// 책 색을 k배로 어둡게. 시안의 그늘은 회색이 아니라 따뜻한 갈색 쪽으로 어두워진다
// (모순 옆면: 앞면 대비 R 0.88, G 0.82, B 0.77) → 채널마다 지수를 달리한다. 밝게(k>1)는 그대로 곱한다.
const WARM = [0.64, 1, 1.32];
function scaleColor(hex: string, k: number) {
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
  const wSide = (0.8 + 0.3 * (1 - lum)) * (mirror ? 0.55 : 1);
  // 홈은 어두운 책에서만 또렷하다(시안 모순은 앞면에서 옆면으로 바로 넘어간다)
  return prof.map(([p, k]) => {
    const groove = p > f + 1e-6 && p < side - 1e-6;
    const kk = groove ? k + (0.78 - k) * lum : k;
    return [p, 1 - (1 - kk) * (p <= f + 1e-6 ? wFront : wSide)];
  });
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
function mix(a: string, b: string, t: number) {
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
export const edgeFactor = (face: string) => 0.62 + 0.3 * luminance(face);

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
export function bodyOutline(w: number, h: number, s: number, seed: string, side = SPINE_SIDE, chamfer?: number): Point[] {
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
  for (let x = r + step; x < sideX; x += step) pts.push({ x, y: headY(x) + amp * wTop(x / s) });
  pts.push({ x: sideX, y: headY(sideX) });
  pts.push({ x: w - 0.6 * s, y: ch - 0.4 * s });
  pts.push({ x: w, y: ch + 0.6 * s });
  for (let y = ch + step; y < h - rb; y += step) pts.push({ x: w - amp * wRight(y / s), y });
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
      <Path path={outline} style="stroke" strokeWidth={7 * s} color="rgba(255,255,255,0.26)">
        <BlurMask blur={1.1 * s} style="normal" />
      </Path>
    </Mask>
  );
}

// 가장자리 선: 책 색을 어둡게 한 또렷한 선 + 조금 어긋난 두 번째 선(굵기가 고르지 않은 손그림 선)
function EdgeLine({ outline, outline2, s, face }: { outline: SkPath; outline2: SkPath; s: number; face: string }) {
  const edge = scaleColor(face, edgeFactor(face));
  return (
    <>
      <Path path={outline} style="stroke" strokeWidth={2.2 * s} color={edge}>
        <BlurMask blur={0.3 * s} style="normal" />
      </Path>
      <Path path={outline2} style="stroke" strokeWidth={2.6 * s} color={edge} opacity={0.45}>
        <BlurMask blur={0.35 * s} style="normal" />
      </Path>
    </>
  );
}

function Grain({ w, h, s, image }: { w: number; h: number; s: number; image: SkImageType | null }) {
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
}) {
  const mx = (p: Point) => (mirror ? { x: w - p.x, y: p.y } : p);
  const outline = useMemo(() => poly(bodyOutline(w, h, s, id, side, chamfer).map(mx)), [w, h, s, id, side, mirror, chamfer]);
  const outline2 = useMemo(() => poly(bodyOutline(w, h, s, `${id}~`, side, chamfer).map(mx)), [w, h, s, id, side, mirror, chamfer]);
  const sideTop = useMemo(
    () => poly([{ x: w * side, y: 0 }, { x: w, y: w * (1 - side) }, { x: w, y: w * (1 - side) + 1.6 * s }, { x: w * side, y: 1.6 * s }].map(mx)),
    [w, s, side, mirror],
  );
  const prof = lying ? lyingProfile(side, face) : shadeProfile(spineProfile(side), side, face, mirror);
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
        <Path path={sideTop} color="rgba(255,255,255,0.16)" />
        {/* 면이 꺾이는 모서리의 빛 반사(시안: 앞면과 옆면 사이, 누운 책은 앞면과 윗면 사이) */}
        <Rect x={mirror ? w * (1 - side) - 1.2 * s : w * side} y={0} width={1.2 * s} height={h} color="rgba(255,255,255,0.45)">
          <BlurMask blur={0.45 * s} style="normal" />
        </Rect>
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
      <Path path={outline} style="stroke" strokeWidth={1.3 * s} color={scaleColor(face, edgeFactor(face))} antiAlias />
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
export const SpineBody = memo(function SpineBody({ id, width: w, height: h, scale: s, face, art, view = 0 }: BodyProps & { view?: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const motif = useImage(art?.motif ?? null);
  const { side, mirror } = spineView(view);
  const fw = faceWidth(w, side);
  const x0 = mirror ? w - fw : 0;
  const clip = useMemo(() => poly(bodyOutline(w, h, s, id, side).map((p) => (mirror ? { x: w - p.x, y: p.y } : p))), [w, h, s, id, side, mirror]);
  return (
    <Canvas style={{ width: w, height: h }}>
      <SpineSkin id={id} w={w} h={h} s={s} face={face} side={side} grain={grain} mirror={mirror} />
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
  const ridge = (path: SkPath, a: number) => (
    <Path path={path} style="stroke" strokeWidth={1.2 * s} color={`rgba(255,255,255,${a})`}>
      <BlurMask blur={0.45 * s} style="normal" />
    </Path>
  );
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
      {ridge(shapes.ridgeFront, 0.42)}
      {ridge(shapes.ridgeTop, 0.5)}
      <Path path={shapes.rim} style="stroke" strokeWidth={1.6 * s} color={edge} strokeJoin="round" antiAlias />
      {motif ? <SkImage image={motif} x={L - mw - len * 0.05} y={H - fw / 2 - mh / 2} width={mw} height={mh} fit="contain" /> : null}
    </Canvas>
  );
});

// 표지 전시: 앞표지(그림 또는 책 색) + 오른쪽 얇은 속지 단면
export const CoverBody = memo(function CoverBody({
  id,
  width: fw,
  height: h,
  scale: s,
  face,
  side,
  cover,
  art,
  mirror = false,
}: BodyProps & { side: number; cover?: ImageSource; mirror?: boolean }) {
  const grain = useImage(BRUSH_DETAIL);
  const image = useImage((cover as number) ?? null);
  const motif = useImage(art?.motif ?? null);
  const outline = useMemo(() => poly(coverOutline(fw, h, s, id)), [fw, h, s, id]);
  const outline2 = useMemo(() => poly(coverOutline(fw, h, s, `${id}~`)), [fw, h, s, id]);
  const lines = 4;
  let mh = h * 0.38;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > fw * 0.5) {
    mh = (mh * fw * 0.5) / mw;
    mw = fw * 0.5;
  }
  return (
    <Canvas style={{ width: fw + side, height: h }}>
      {mirror ? (
        // 가운데보다 오른쪽 책: 왼쪽 옆면(책등 쪽)이 보인다
        <RoundedRect x={0} y={1.2 * s} width={side + 3 * s} height={h - 1.2 * s} r={2 * s} color={scaleColor(face, 0.86)} />
      ) : (
        <>
          {/* 속지 단면(뒤표지판 + 종이) */}
          <RoundedRect x={fw - 3 * s} y={1.2 * s} width={side + 3 * s} height={h - 1.2 * s} r={2 * s} color={scaleColor(face, 0.86)} />
          <Rect x={fw - 1 * s} y={2.4 * s} width={side - 0.4 * s} height={h - 4.8 * s} color={PAGE} />
          {Array.from({ length: lines }, (_, i) => (
            <Rect key={i} x={fw - 1 * s + ((i + 1) * (side - 0.4 * s)) / (lines + 1)} y={2.4 * s} width={0.5} height={h - 4.8 * s} color={PAGE_LINE} />
          ))}
        </>
      )}
      <Group transform={[{ translateX: mirror ? side : 0 }]}>
      <Group clip={outline}>
        <Rect x={0} y={0} width={fw} height={h} color={face} />
        {image ? <SkImage image={image} x={0} y={0} width={fw} height={h} fit="cover" /> : null}
        {!image && motif ? <SkImage image={motif} x={fw / 2 - mw / 2} y={h * 0.9 - mh} width={mw} height={mh} fit="contain" /> : null}
        <Grain w={fw} h={h} s={s} image={grain} />
        {/* 제본 쪽(왼쪽) 살짝 어둡게, 왼쪽 위에서 오는 빛 */}
        <Rect x={0} y={0} width={fw * 0.06} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(fw * 0.06, 0)} colors={['rgba(0,0,0,0.14)', 'rgba(0,0,0,0)']} />
        </Rect>
        <Rect x={fw * 0.055} y={0} width={0.8 * s} height={h} color="rgba(255,255,255,0.12)" />
        <Rect x={0} y={0} width={fw} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(fw, h)} colors={['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.08)']} positions={[0, 0.45, 1]} />
        </Rect>
        <RimLight outline={outline} w={fw} h={h} s={s} />
        <EdgeLine outline={outline} outline2={outline2} s={s} face={face} />
      </Group>
      <Path path={outline} style="stroke" strokeWidth={1.3 * s} color={scaleColor(face, edgeFactor(face))} antiAlias />
      </Group>
      {/* 앞표지와 옆면이 만나는 모서리의 빛 반사 */}
      <Rect x={mirror ? side - 0.2 * s : fw - 0.2 * s} y={2.4 * s} width={1.2 * s} height={h - 4.8 * s} color="rgba(255,255,255,0.4)">
        <BlurMask blur={0.45 * s} style="normal" />
      </Rect>
    </Canvas>
  );
});
