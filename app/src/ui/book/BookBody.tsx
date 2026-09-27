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
  const side = 1 - (0.035 + 0.12 * Math.abs(view));
  return { side, mirror: view > 0.02 };
}
export const CHAMFER = 0.14; // 옆면 윗부분이 깎여 내려가는 정도(책 폭 비율)
const PAGE = '#F4ECDD';
const PAGE_LINE = '#DDCFB8';

function scaleColor(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// 앞면·홈·옆면의 가로 명암(위치: 책 폭 비율, 값: 밝기 배율). side = 옆면 시작 비율.
export function spineProfile(side: number): [number, number][] {
  const f = side - 0.095; // 앞면 끝
  // 홈·옆면은 형태가 읽힐 만큼만 어둡게(너무 진하면 책마다 검은 띠처럼 보인다)
  return [
    [0, 0.9],
    [0.035, 1.0],
    [0.08, 1.04],
    [0.3 * f, 1.03],
    [0.6 * f, 0.99],
    [f, 0.97],
    [f + 0.02, 0.86],
    [side - 0.01, 0.85],
    [side + 0.01, 0.93],
    [0.975, 0.91],
    [1, 0.84],
  ];
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

// 세운 책 몸체 윤곽(px): 둥근 왼쪽 위, 비스듬히 깎인 오른쪽 위, 평평한 바닥, 가장자리의 아주 작은 불규칙.
export function bodyOutline(w: number, h: number, s: number, seed: string, side = SPINE_SIDE): Point[] {
  const r = 4.6 * s;
  const rb = 2 * s;
  const sideX = w * side;
  const ch = w * Math.max(0.03, Math.min(CHAMFER, 1 - side)); // 옆면이 좁을수록 윗부분 깎임도 작다
  const rnd = jitter(seed);
  const pts: Point[] = [];
  const arc = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  arc(r, r, r, Math.PI, Math.PI * 1.5);
  const topN = Math.max(2, Math.round(sideX / (5 * s)));
  for (let i = 1; i < topN; i++) pts.push({ x: r + ((sideX - r) * i) / topN, y: 0.35 * s * rnd(i) });
  pts.push({ x: sideX, y: 0 });
  pts.push({ x: w - 0.6 * s, y: ch - 0.4 * s });
  pts.push({ x: w, y: ch + 0.6 * s });
  const sideN = Math.max(3, Math.round(h / (12 * s)));
  for (let i = 1; i < sideN; i++) pts.push({ x: w + 0.3 * s * rnd(100 + i), y: ch + ((h - rb - ch) * i) / sideN });
  arc(w - rb, h - rb, rb, 0, Math.PI / 2);
  arc(rb, h - rb, rb, Math.PI / 2, Math.PI);
  for (let i = sideN - 1; i >= 1; i--) pts.push({ x: 0.3 * s * rnd(200 + i), y: r + ((h - rb - r) * i) / sideN });
  return pts;
}

// 표지 윤곽: 둥근 네 모서리 + 아주 작은 불규칙
function coverOutline(w: number, h: number, s: number, seed: string): Point[] {
  const r = 3 * s;
  const rnd = jitter(seed);
  const pts: Point[] = [];
  const corners: [number, number, number][] = [
    [w - r, r, -Math.PI / 2],
    [w - r, h - r, 0],
    [r, h - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  corners.forEach(([cx, cy, a0], k) => {
    for (let i = 0; i <= 5; i++) {
      const a = a0 + (Math.PI / 2) * (i / 5);
      pts.push({ x: cx + r * Math.cos(a) + (i === 5 ? 0.25 * s * rnd(k) : 0), y: cy + r * Math.sin(a) });
    }
  });
  return pts;
}

const poly = (pts: Point[]) => Skia.Path.Polygon(pts.map((q) => ({ x: q.x, y: q.y })), true);

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
}: {
  id: string;
  w: number;
  h: number;
  s: number;
  face: string;
  side: number;
  grain: SkImageType | null;
  mirror?: boolean;
}) {
  const mx = (p: Point) => (mirror ? { x: w - p.x, y: p.y } : p);
  const outline = useMemo(() => poly(bodyOutline(w, h, s, id, side).map(mx)), [w, h, s, id, side, mirror]);
  const sideTop = useMemo(
    () => poly([{ x: w * side, y: 0 }, { x: w, y: w * (1 - side) }, { x: w, y: w * (1 - side) + 1.6 * s }, { x: w * side, y: 1.6 * s }].map(mx)),
    [w, s, side, mirror],
  );
  const prof = spineProfile(side);
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
        {/* 윗모서리를 따라 밝은 빛 띠(왼쪽 위 빛) */}
        <Rect x={0} y={0} width={w} height={3 * s}>
          <LinearGradient start={vec(0, 0)} end={vec(0, 3 * s)} colors={['rgba(255,255,255,0.26)', 'rgba(255,255,255,0)']} />
        </Rect>
        <Path path={sideTop} color="rgba(255,255,255,0.16)" />
        {/* 바닥 쪽 살짝 어둡게 */}
        <Rect x={0} y={h - 3 * s} width={w} height={3 * s}>
          <LinearGradient start={vec(0, h - 3 * s)} end={vec(0, h)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.1)']} />
        </Rect>
        {/* 같은 색 테두리(안쪽으로 번지게) */}
        <Path path={outline} style="stroke" strokeWidth={2.4 * s} color={scaleColor(face, 0.84)} opacity={0.7}>
          <BlurMask blur={0.8 * s} style="normal" />
        </Path>
      </Group>
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

export const faceWidth = (w: number, side = SPINE_SIDE) => w * (side - 0.095);

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

// 누운 책: 세운 몸체를 반시계로 90도 눕힌다(책 머리가 왼쪽, 옆면이 위쪽 윗면). topFace = 위에서 보이는 윗면 두께(px).
// 모티프는 눕히지 않고 오른쪽 끝에 바로 세워 그린다.
export const LyingBody = memo(function LyingBody({ id, width: len, height: H, scale: s, face, art, topFace }: BodyProps & { topFace: number }) {
  const grain = useImage(BRUSH_DETAIL);
  const motif = useImage(art?.motif ?? null);
  const side = 1 - topFace / H;
  const fw = faceWidth(H, side); // 앞면 두께(px)
  let mh = fw * 0.6;
  let mw = motif ? (mh * motif.width()) / motif.height() : 0;
  if (mw > len * 0.22) {
    mh = (mh * len * 0.22) / mw;
    mw = len * 0.22;
  }
  return (
    <Canvas style={{ width: len, height: H }}>
      <Group transform={[{ translateY: H }, { rotate: -Math.PI / 2 }]}>
        <SpineSkin id={id} w={H} h={len} s={s} face={face} side={side} grain={grain} />
      </Group>
      {motif ? <SkImage image={motif} x={len - mw - len * 0.06} y={H - fw / 2 - mh / 2} width={mw} height={mh} fit="contain" /> : null}
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
        <Rect x={0} y={0} width={fw} height={3 * s}>
          <LinearGradient start={vec(0, 0)} end={vec(0, 3 * s)} colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0)']} />
        </Rect>
        <Path path={outline} style="stroke" strokeWidth={2.4 * s} color={scaleColor(face, 0.8)} opacity={0.55}>
          <BlurMask blur={0.8 * s} style="normal" />
        </Path>
      </Group>
      </Group>
    </Canvas>
  );
});
