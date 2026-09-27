// 코드로 그리는 책 몸체(책등 자세). 형태는 코드, 재료(색·붓결·모티프)는 그림 자산.
// 시안 '데미안'에서 잰 구조(책 폭 대비):
//  - 앞면 0~78%: 왼쪽 끝 어두운 테두리, 5~30%가 가장 밝고(둥근 책등의 반사광) 오른쪽으로 조금 어두워진다.
//  - 78~88%: 앞면과 옆면 사이의 짙은 홈, 88~100%: 옆면(윗부분이 비스듬히 깎여 윗면이 보이는 3/4 시점).
//  - 가장자리는 살짝 불규칙(손으로 그린 느낌), 윗면 테두리는 얇게 밝다.
// 어떤 크기·각도에서도 같은 모양이며, 제목은 BookRenderer가 위에 조판한다.
import { BlurMask, Canvas, Group, Image as SkImage, ImageShader, LinearGradient, Path, Rect, Skia, useImage, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';

import type { BodyArt } from '@/domain/body-art.generated';
import { BRUSH_DETAIL, BRUSH_TILE_PX } from '@/domain/body-art.generated';
import type { Point } from '@/domain/shelf-scene';

const SRC_DU = 390 / 941; // 시안 원본 1px = DU
// 붓결 세기(시안: 은은함). 질감 이미지는 명암 차를 5배로 담아 두었으므로 여기서 줄인다.
export const GRAIN_STRENGTH = 0.28;

// 앞면·홈·옆면의 가로 명암(위치: 책 폭 비율, 값: 밝기 배율). 시안 측정값을 따른다.
export const SPINE_PROFILE: [number, number][] = [
  [0, 0.8],
  [0.035, 1.0],
  [0.08, 1.05],
  [0.3, 1.03],
  [0.6, 0.98],
  [0.775, 0.95],
  [0.795, 0.66],
  [0.86, 0.64],
  [0.88, 0.82],
  [0.975, 0.78],
  [1, 0.64],
];
export const SIDE_START = 0.87; // 옆면 시작(윗부분 깎임)
export const CHAMFER = 0.14; // 옆면 윗부분이 내려가는 정도(책 폭 비율)

function scaleColor(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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

// 몸체 윤곽(px): 둥근 왼쪽 위, 비스듬히 깎인 오른쪽 위, 평평한 바닥. 가장자리에 아주 작은 불규칙.
export function bodyOutline(w: number, h: number, s: number, seed: string): Point[] {
  const r = 3.6 * s;
  const rb = 1.6 * s;
  const sideX = w * SIDE_START;
  const ch = w * CHAMFER;
  const rnd = jitter(seed);
  const pts: Point[] = [];
  const arc = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  arc(r, r, r, Math.PI, Math.PI * 1.5); // 왼쪽 위
  const topN = Math.max(2, Math.round(sideX / (5 * s)));
  for (let i = 1; i < topN; i++) pts.push({ x: r + ((sideX - r) * i) / topN, y: 0.35 * s * rnd(i) });
  pts.push({ x: sideX, y: 0 });
  pts.push({ x: w - 0.6 * s, y: ch - 0.4 * s }); // 깎인 옆면 위
  pts.push({ x: w, y: ch + 0.6 * s });
  const sideN = Math.max(3, Math.round(h / (12 * s)));
  for (let i = 1; i < sideN; i++) pts.push({ x: w + 0.3 * s * rnd(100 + i), y: ch + ((h - rb - ch) * i) / sideN });
  arc(w - rb, h - rb, rb, 0, Math.PI / 2); // 오른쪽 아래
  arc(rb, h - rb, rb, Math.PI / 2, Math.PI); // 왼쪽 아래
  for (let i = sideN - 1; i >= 1; i--) pts.push({ x: 0.3 * s * rnd(200 + i), y: r + ((h - rb - r) * i) / sideN });
  return pts;
}

type Props = { id: string; width: number; height: number; scale: number; art: BodyArt };

export const BookBody = memo(function BookBody({ id, width: w, height: h, scale: s, art }: Props) {
  const grain = useImage(BRUSH_DETAIL);
  const motif = useImage(art.motif);
  const outline = useMemo(() => Skia.Path.Polygon(bodyOutline(w, h, s, id), true), [w, h, s, id]);
  const side = useMemo(
    () =>
      Skia.Path.Polygon(
        [
          { x: w * SIDE_START, y: 0 },
          { x: w, y: w * CHAMFER },
          { x: w, y: h },
          { x: w * SIDE_START, y: h },
        ],
        true,
      ),
    [w, h],
  );
  const colors = SPINE_PROFILE.map(([, k]) => scaleColor(art.face, k));
  const positions = SPINE_PROFILE.map(([p]) => p);
  // 모티프: 앞면(0~78%) 가운데 기준, 원본 비율 유지
  const faceW = w * 0.765;
  const mTop = art.motifTop * h;
  const mH = (art.motifBottom - art.motifTop) * h;
  const mW = motif ? (mH * motif.width()) / motif.height() : 0;
  const tileScale = SRC_DU * s; // 질감: 시안과 같은 결 크기
  return (
    <Canvas style={{ width: w, height: h }}>
      <Group clip={outline}>
        {/* 가로 명암(반사광·홈·옆면) */}
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={colors} positions={positions} />
        </Rect>
        {/* 옆면 위쪽은 윗면 쪽이라 조금 밝게 */}
        <Path path={side} color="rgba(255,255,255,0.05)" />
        {/* 붓결·종이 결: 명암만 담긴 질감을 부드럽게 겹친다 */}
        {grain ? (
          <Rect x={0} y={0} width={w} height={h} blendMode="softLight" opacity={GRAIN_STRENGTH}>
            <ImageShader image={grain} tx="repeat" ty="repeat" transform={[{ scale: tileScale }]} />
          </Rect>
        ) : null}
        {/* 윗면 테두리: 윗모서리를 따라 밝게(앞면 + 깎인 옆면) */}
        <Rect x={0} y={0} width={w} height={2.4 * s}>
          <LinearGradient start={vec(0, 0)} end={vec(0, 2.4 * s)} colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} />
        </Rect>
        <Path path={Skia.Path.Polygon([{ x: w * SIDE_START, y: 0 }, { x: w, y: w * CHAMFER }, { x: w, y: w * CHAMFER + 1.6 * s }, { x: w * SIDE_START, y: 1.6 * s }], true)} color="rgba(255,255,255,0.16)" />
        {/* 바닥 쪽 살짝 어둡게(선반에 닿는 곳) */}
        <Rect x={0} y={h - 3 * s} width={w} height={3 * s}>
          <LinearGradient start={vec(0, h - 3 * s)} end={vec(0, h)} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.12)']} />
        </Rect>
        {motif ? <SkImage image={motif} x={art.motifCx * faceW - mW / 2} y={mTop} width={mW} height={mH} fit="contain" /> : null}
      </Group>
      {/* 손으로 그린 듯한 얇은 윤곽선 */}
      <Path path={outline} style="stroke" strokeWidth={0.9 * s} color="rgba(20, 26, 24, 0.42)">
        <BlurMask blur={0.3 * s} style="normal" />
      </Path>
    </Canvas>
  );
});
