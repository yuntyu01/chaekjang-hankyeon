// 선반 판. 장면(ShelfScene)이 줄마다 그린다.
// 모양: 3D 판 꼭짓점을 책과 같은 카메라로 투영한 면(domain/shelf-geom). 화면에 보이는 선반 외곽 = 이 면들의 외곽.
// 그리는 순서는 장면 전체의 가림 순서(판도 책과 같은 3D 상자로 정렬): 아래 줄 책머리 위, 이 줄 책 아래.
// 재질: 받은 선반 PNG에서 잘라 낸 나무 질감(윗면·앞면 안쪽만, scripts/extract-shelf-texture.py)을 각 면에 affine으로 붙인다.
// PNG의 외곽·투명 여백·원근 끝·바깥 그림자는 쓰지 않는다. 판이 벽에 드리우는 그림자는 광원으로 계산한다(ShelfWallShadow).
import { BlurMask, Group, ImageShader, LinearGradient, Path, Skia, useImage, vec, type SkPath } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { toPx, type Affine } from '@/domain/camera';
import { shelfViewCam } from '@/domain/shelf-view';

import type { Camera } from '@/domain/box';
import { shadowOnPlane, travelOf } from '@/domain/cast-shadow';
import { SHELF_DEPTH } from '@/domain/geometry';
import { hull, rgba } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { faceTextureMatrix, shelfBoxCorners, shelfFaces, shelfVertices } from '@/domain/shelf-geom';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { light, shadow } from '@/ui/lighting';
import { shadeColor } from '@/ui/book3d/BookFaces';
import { litTone, withAlpha } from '@/ui/book/BookBody';
import { roundedPolygon } from '@/ui/book3d/face-geometry';

type RO<T> = Readonly<SharedValue<T>>;

const TOP_TEX = require('../../../assets/bookshelf/shelf-top.png');
const FRONT_TEX = require('../../../assets/bookshelf/shelf-front.png');
// 면 사이 이음새: 뒤에 그리는 면을 공유 변 너머로 이만큼(px) 덮어 투명 틈이 생기지 않게 한다(같은 꼭짓점, 그리기만 겹침)
const SEAM_PX = 0.6;

function pathOf(pts: Point[]) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  if (pts.length) {
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.close();
  }
  return p.detach();
}

function linePath(a: Point, b: Point) {
  'worklet';
  const p = Skia.PathBuilder.Make();
  p.moveTo(a.x, a.y);
  p.lineTo(b.x, b.y);
  return p.detach();
}

// 공유 변 a→b 쪽으로 면을 SEAM_PX만큼 넓힌 다각형(px). dir: 넓힐 방향(화면 px 단위 벡터)
function grow(poly: Point[], i: number, j: number, dir: Point): Point[] {
  'worklet';
  return poly.map((q, k) => (k === i || k === j ? { x: q.x + dir.x * SEAM_PX, y: q.y + dir.y * SEAM_PX } : q));
}

// ---------- 판 → 벽 실제 그림자 ----------
// 빛 길이로 판을 나눈 층: 벽에 가까운 층(짧은 빛 길이)만 또렷하고 진하며, 먼 층일수록 넓고 옅고 흐리다.
// 층마다 판의 그 부분이 벽에 떨어뜨린 모양이라, 오른쪽 끝 너머 벽에는 먼 층(옅은 것)만 닿는다.
// 벽 중 판 뒤에 가려지는 부분은 판을 나중에 그려 덮는다.
const LIGHT = travelOf(light.dir);
const SW = shadow.cast.plank;
// 그림자가 판 앞면 아래로 보이는 최대 길이(DU)
export const SHELF_CAST_EXTENT = SW.layers[SW.layers.length - 1] * Math.abs(LIGHT.y) + SW.blurPad;

// 판의 벽 그림자 3D 점(판이 움직이지 않으므로 한 번만): 층마다
const WALL_PTS = SW.layers.map((L) => shadowOnPlane(shelfBoxCorners(), { x: 0, y: 0, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, LIGHT, L).pts);

function WallLayer({ cam, px, k }: { cam: RO<Camera>; px: Affine; k: number }) {
  const pts = WALL_PTS[k];
  const path = useDerivedValue(() => {
    const c = cam.value;
    return pathOf(hull(pts.map((q) => toPx(c, px, q))));
  });
  return (
    <Path path={path} color={rgba(shadow.recv.wall, SW.opacity[k])}>
      {SHOW.shelfBlur ? <BlurMask blur={((SW.near + SW.perDU * SW.layers[k]) * px.s) / 2} style="normal" /> : null}
    </Path>
  );
}

// 개발용: 층마다 흐리기 전 그림자 외곽(가까운 층부터 빨강·주황·파랑)과, 판 꼭짓점에서 벽까지 가는 광선(초록)
const DEBUG_COLORS = ['rgba(220,30,30,0.9)', 'rgba(240,150,0,0.9)', 'rgba(30,90,220,0.9)'];
export function ShelfShadowDebug({ cam, px }: { cam: RO<Camera>; px: Affine }) {
  const s = px.s;
  const g = useDerivedValue(() => {
    const c = cam.value;
    const P = (q: { x: number; y: number; z: number }) => toPx(c, px, q);
    const vs = shelfVertices();
    const all = shelfBoxCorners();
    const layers = SW.layers.map((L) => pathOf(hull(shadowOnPlane(all, { x: 0, y: 0, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, LIGHT, L).pts.map(P))));
    // 광선: 오른쪽 아래 모서리들(앞·중간·뒤)에서 벽(z = SHELF_DEPTH)까지
    const rays = Skia.PathBuilder.Make();
    for (const v of [vs.RBB, { x: vs.RBB.x, y: vs.RBB.y, z: SHELF_DEPTH - 20 }, { x: vs.RBB.x, y: vs.RBB.y, z: SHELF_DEPTH - 40 }, { x: vs.LBB.x + 60, y: vs.LBB.y, z: SHELF_DEPTH - 30 }]) {
      const tt = (SHELF_DEPTH - v.z) / LIGHT.z;
      const hit = { x: v.x + LIGHT.x * tt, y: v.y + LIGHT.y * tt, z: SHELF_DEPTH };
      const a = P(v);
      const b = P(hit);
      rays.moveTo(a.x, a.y);
      rays.lineTo(b.x, b.y);
      rays.addCircle(b.x, b.y, 1.2 * s);
    }
    return { layers, rays: rays.detach() };
  });
  const l0 = useDerivedValue(() => g.value.layers[0]);
  const l1 = useDerivedValue(() => g.value.layers[1]);
  const l2 = useDerivedValue(() => g.value.layers[2]);
  const rays = useDerivedValue(() => g.value.rays);
  return (
    <Group zIndex={1e8}>
      {[l0, l1, l2].map((p, k) => (
        <Path key={k} path={p} style="stroke" strokeWidth={1.2} color={DEBUG_COLORS[k]} />
      ))}
      <Path path={rays} style="stroke" strokeWidth={1.2} color="rgba(20,150,60,0.95)" />
    </Group>
  );
}

// 판 → 벽 그림자 + 판이 벽에 닿는 선 바로 아래 좁은 어둠(벽 단계: 모든 판·책보다 먼저 그린다)
export function ShelfWallShadow({ cam, px, zIndex }: { cam: RO<Camera>; px: Affine; zIndex: number; row?: number }) {
  // 접촉선(판 뒤 아래 모서리, 벽 평면 위)에서 아래로 shelfLip.height까지의 벽 띠와 그 위·아래 끝(그라데이션 방향)
  const lip = useDerivedValue(() => {
    const c = cam.value;
    const v = shelfVertices();
    const down = (q: { x: number; y: number; z: number }) => ({ x: q.x, y: q.y - shadow.ao.shelfLip.height, z: q.z });
    const P = (q: { x: number; y: number; z: number }) => toPx(c, px, q);
    return { poly: pathOf([P(v.LBB), P(v.RBB), P(down(v.RBB)), P(down(v.LBB))]), a: P(v.LBB), b: P(down(v.LBB)) };
  });
  const lipPath = useDerivedValue(() => lip.value.poly);
  const lipA = useDerivedValue(() => vec(lip.value.a.x, lip.value.a.y));
  const lipB = useDerivedValue(() => vec(lip.value.b.x, lip.value.b.y));
  return (
    <Group zIndex={zIndex}>
      {SHOW.shelf ? SW.layers.map((_, k) => <WallLayer key={k} cam={cam} px={px} k={k} />) : null}
      {/* 주변광 차폐: 판이 벽에 닿는 선 바로 아래(벽 위 3D 띠). 아래 줄 책이 앞에 오면 가린다 */}
      {SHOW.shelfAO ? (
        <Path path={lipPath}>
          <LinearGradient start={lipA} end={lipB} colors={[rgba(shadow.recv.wall, shadow.ao.shelfLip.opacity), rgba(shadow.recv.wall, 0)]} />
        </Path>
      ) : null}
    </Group>
  );
}

function Face({ poly, matrix, image, tone, children }: { poly: RO<SkPath>; matrix: RO<number[]>; image: ReturnType<typeof useImage>; tone: string; children?: React.ReactNode }) {
  return (
    <Group clip={poly}>
      <Path path={poly} color={tone} />
      <Path path={poly} opacity={0.22} blendMode="softLight">
        {image ? <ImageShader image={image} tx="clamp" ty="clamp" matrix={matrix} /> : null}
      </Path>
      {children}
    </Group>
  );
}

// 판 면 밝기: 책 면과 같은 공통 광원 램버트(면 법선은 판이 돌지 않으니 고정)와 같은 덮기 색(BookFaces shadeColor).
// 모서리는 두 면 사이로 기운 법선(둥글게 깎인 모서리)의 밝기: 빛 쪽 윗면·앞면 모서리는 조금 밝고, 윗면·오른쪽 옆면 모서리는
// 두 면 사이 밝기로 이어진다(고정된 흰 선이 아니다).
const lambert = (n: { x: number; y: number; z: number }) => {
  const d = light.dir;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const nl = Math.hypot(n.x, n.y, n.z) || 1;
  const k = light.ambient + light.diffuse * ((n.x * d.x + n.y * d.y + n.z * d.z) / (l * nl));
  return Math.max(light.min, Math.min(light.max, k));
};
const K_TOP = lambert({ x: 0, y: 1, z: 0 });
const K_FRONT = lambert({ x: 0, y: 0, z: -1 });
const K_SIDE = lambert({ x: 1, y: 0, z: 0 });
const K_SIDE_EDGE = lambert({ x: 1, y: 1, z: 0 }); // 윗면·오른쪽 옆면 사이 모서리(두 면 사이 밝기로 이어진다)
// 윗면·앞면 사이 둥근 모서리: 책 모서리(BookNode bevelColor)와 같은 규칙. 모서리 법선이 앞면보다 빛을 더 받는 만큼 판 색을 밝힌 얇은 밝음
const PLANK_TONE = '#F2DABE';
const PLANK_TOP = '#FCECD5';
// 앞면·옆면 질감(평균 약 (229,196,165))을 시안 앞면 (242,220,194) 쪽으로 밝히는 크림빛 덮기. 옆면 끝은 어둡게 하지 않는다(시안에 어두운 끝면이 없다)
const PLANK_CREAM = 'rgba(255,246,232,0.035)';
const EDGE_LIT = (() => {
  const d = light.dir;
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const bevel = (0 * d.x + Math.SQRT1_2 * d.y - Math.SQRT1_2 * d.z) / l;
  const front = -d.z / l;
  return withAlpha(litTone(PLANK_TONE), Math.min(0.3, Math.max(0, bevel - front) * 2));
})();

// 판(윗면·앞면·옆면). 판 → 벽 그림자는 ShelfWallShadow로 따로(벽 단계)
export function ShelfBoard({ px, cam, zIndex }: { px: Affine; cam: RO<Camera>; zIndex: Readonly<SharedValue<number>> | number }) {
  const s = px.s;
  const top = useImage(TOP_TEX);
  const front = useImage(FRONT_TEX);
  const tw = top?.width() ?? 1;
  const th = top?.height() ?? 1;
  const fw = front?.width() ?? 1;
  const fh = front?.height() ?? 1;
  // 지금 카메라로 판 면을 투영(시점을 끄는 동안에도 매 프레임)
  const g = useDerivedValue(() => {
    const f = shelfFaces(shelfViewCam(cam.value));
    const t = px;
    const P = (q: Point) => ({ x: q.x * s + t.tx, y: q.y * s + t.ty });
    const topPoly = f.top.poly.map(P);
    // 앞면은 위 변(윗면과 공유)을 위로, 옆면은 왼쪽 변(윗면·앞면과 공유)을 왼쪽으로 조금 덮는다
    const frontPoly = grow(f.front.poly.map(P), 0, 1, { x: 0, y: -1 });
    const sidePoly: Point[] = [];
    const lfb = P(f.corners.LFB);
    const fTop = P(f.corners.LFT).y;
    return {
      outline: pathOf(roundedPolygon(hull([...topPoly, ...frontPoly, ...sidePoly]), 3.8 * s)),
      top: pathOf(topPoly),
      front: pathOf(frontPoly),
      side: pathOf(sidePoly),
      topM: faceTextureMatrix(f.top, tw, th, s, t.tx, t.ty),
      frontM: faceTextureMatrix(f.front, fw, fh, s, t.tx, t.ty),
      sideM: f.side ? faceTextureMatrix(f.side, fw, fh, s, t.tx, t.ty) : [1, 0, 0, 0, 1, 0, 0, 0, 1],
      edge: linePath(P(f.corners.LFT), P(f.corners.RFT)),
      bottomEdge: linePath(P(f.corners.LFB), P(f.corners.RFB)),
      sideEdge: linePath(P(f.corners.RFT), P(f.corners.RBT)),
      g0: vec(0, fTop),
      g1: vec(0, lfb.y),
    };
  });
  const topP = useDerivedValue(() => g.value.top);
  const outline = useDerivedValue(() => g.value.outline);
  const frontP = useDerivedValue(() => g.value.front);
  const sideP = useDerivedValue(() => g.value.side);
  const topM = useDerivedValue(() => g.value.topM);
  const frontM = useDerivedValue(() => g.value.frontM);
  const sideM = useDerivedValue(() => g.value.sideM);
  const edge = useDerivedValue(() => g.value.edge);
  const bottomEdge = useDerivedValue(() => g.value.bottomEdge);
  const sideEdge = useDerivedValue(() => g.value.sideEdge);
  const g0 = useDerivedValue(() => g.value.g0);
  const g1 = useDerivedValue(() => g.value.g1);
  return (
      <Group zIndex={zIndex} clip={outline}>
        {/* 윗면: 나무 질감 + 공통 광원 밝기 */}
        <Face poly={topP} matrix={topM} image={top} tone={PLANK_TOP}>
          {SHOW.shelfShade ? <Path path={topP} color={shadeColor(K_TOP)} /> : null}
        </Face>
        {/* 앞면: 질감 + 공통 광원 밝기, 아래 가장자리로 둥글게 말려 들어가는 곳만 살짝 어둡게 */}
        <Face poly={frontP} matrix={frontM} image={front} tone={PLANK_TONE}>
          {SHOW.shelfShade ? (
            <>
              <Path path={frontP} color={PLANK_CREAM} />
              <Path path={frontP} color={shadeColor(K_FRONT)} />
              <Path path={frontP}>
                <LinearGradient start={g0} end={g1}
                  colors={['rgba(255,248,229,0.18)', 'rgba(255,248,229,0)', 'rgba(168,119,77,0.035)', 'rgba(168,119,77,0.15)']}
                  positions={[0,0.24,0.78,1]} />
              </Path>
            </>
          ) : null}
        </Face>
        {/* 오른쪽 옆면: 공통 광원(빛 반대쪽) */}
        <Face poly={sideP} matrix={sideM} image={front} tone={PLANK_TONE}>
          {SHOW.shelfSide && SHOW.shelfShade ? (
            <>
              <Path path={sideP} color={PLANK_CREAM} />
              <Path path={sideP} color={shadeColor(Math.max(K_SIDE, 0.95))} />
            </>
          ) : null}
        </Face>
        {/* 둥글게 깎인 모서리: 두 면 사이 법선의 밝기(빛 쪽이면 조금 밝게) */}
        <Path path={edge} style="stroke" strokeWidth={1.1 * s} strokeCap="round" color={EDGE_LIT}>
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
        <Path path={sideEdge} style="stroke" strokeWidth={0.6 * s} strokeCap="round" color={shadeColor(K_SIDE_EDGE)}>
          <BlurMask blur={0.35 * s} style="normal" />
        </Path>
        <Path path={bottomEdge} style="stroke" strokeWidth={1.1 * s} strokeCap="round" color="rgba(179,131,90,0.24)" />
        <Path path={outline} style="stroke" strokeWidth={0.8 * s} color="rgba(192,144,99,0.22)" />
      </Group>
  );
}
