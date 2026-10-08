// 선반 판과 벽. 장면(ShelfScene)이 줄마다 그린다.
// 모양: 3D 판 꼭짓점을 책과 같은 카메라로 투영한 면(domain/shelf-geom). 화면에 보이는 선반 외곽 = 이 면들의 외곽(모서리 반지름 EDGE_R).
// 그리는 순서는 장면 전체의 가림 순서(판도 책과 같은 3D 상자로 정렬): 아래 줄 책머리 위, 이 줄 책 아래.
// 재질: 판 색 하나(ui/lighting surfaces.plank). 나무 결(반사율·미세 높이)과 벽 칠(무광 페인트)은 빛 셰이더가 재질(ui/lighting materials)로 계산한다.
// 밝기: 빛 모델 하나(SceneLight). 판 윗면은 그 위 책·벽·위 판이 가린 하늘, 둥근 앞 모서리는 원호 법선의 빛이다.
// 벽: 벽 색 위에 같은 셰이더로 다시 칠한다(판·책이 가린 하늘, 위 판이 가린 창빛). 맨 아랫줄은 판 밑 벽도.
// 벽·판의 하늘 가림은 줄의 모든 책이 가려 무거워서 줄 아틀라스에 굽는다(줄이 멈췄을 때만, ShelfScene useRowAtlas).
import { Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useCallback, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { toPx, VIEW_CX, VIEW_DIST, type Affine, type Cam, type Vec3 } from '@/domain/camera';
import type { Camera } from '@/domain/box';
import { EDGE_R } from '@/domain/book-parts';
import { DESIGN_WIDTH, SHELF, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { darkening, DESIGN, EREF, FAR, NEGLIGIBLE, shadowAlpha, SREF, type Env } from '@/domain/light-model';
import { hull } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { faceTextureMatrix, shelfFaces } from '@/domain/shelf-geom';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { clipConvexBy, roundedPolygon } from '@/ui/book3d/face-geometry';
import { surfaces } from '@/ui/lighting';
import { BAKE_TEXEL, BakedPlane, seedOf, type Atlas, type BakeArea, type Plane, type PlaneKey } from '@/ui/SceneLight';
import { LIGHT_ON } from '@/ui/perf';

type RO<T> = Readonly<SharedValue<T>>;

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

// 공유 변 a→b 쪽으로 면을 SEAM_PX만큼 넓힌 다각형(px). dir: 넓힐 방향(화면 px 단위 벡터)
function grow(poly: Point[], i: number, j: number, dir: Point): Point[] {
  'worklet';
  return poly.map((q, k) => (k === i || k === j ? { x: q.x + dir.x * SEAM_PX, y: q.y + dir.y * SEAM_PX } : q));
}

// ---------- 평면들(줄 공간) ----------
// 판 윗면(y = 0): 앞 모서리 둥글기. 판 앞면(z = −SHELF_FRONT): 위·아래 모서리 둥글기. 벽(z = SHELF_DEPTH): 판과 만나는 안쪽 모서리라 둥글기 없음
const TOP: Plane = { O: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 1, z: 0 }, edges: [{ T: { x: 0, y: 0, z: -1 }, at: SHELF_FRONT }] };
const FRONT: Plane = {
  O: { x: 0, y: 0, z: -SHELF_FRONT },
  n: { x: 0, y: 0, z: -1 },
  edges: [
    { T: { x: 0, y: 1, z: 0 }, at: 0 },
    { T: { x: 0, y: -1, z: 0 }, at: SHELF_THICK },
  ],
};
const WALL: Plane = { O: { x: 0, y: 0, z: SHELF_DEPTH }, n: { x: 0, y: 0, z: -1 } };

// 줄의 둘레: 판 윗면 y = 0, 위 판 아랫면 y = space(맨 윗줄은 없음)
export function rowEnv(space: number, top: boolean): Env {
  return { floor: 0, ceil: top ? FAR : space };
}
// 맨 아랫줄 판 밑 벽의 둘레: 위로 판 아랫면만
export const UNDER_ENV: Env = { floor: -FAR, ceil: -SHELF_THICK };

// 맨 아랫줄 판 밑 벽이 판 때문에 어두워지는 깊이: 어둠이 화면 한 단계의 절반보다 작아지는 곳까지(판 가운데 아래에서)
const MID_X = (SHELF_X0 + SHELF_X1) / 2;
export const SHELF_CAST_EXTENT = (() => {
  const n: Vec3 = { x: 0, y: 0, z: -1 };
  let d = 1;
  while (d < 1000 && shadowAlpha(darkening({ x: MID_X, y: -SHELF_THICK - d, z: SHELF_DEPTH }, n, UNDER_ENV, [])) >= NEGLIGIBLE) d *= 1.1;
  return d;
})();

// 평면 사각형 영역을 칸 간격 BAKE_TEXEL 안팎으로 나눈 굽기 영역(가로·세로 칸 크기는 영역에 꼭 맞게)
function bakeArea(O: Vec3, along: Vec3, across: Vec3, len: number, wid: number, plane: Plane): BakeArea {
  const w = Math.max(1, Math.ceil(len / BAKE_TEXEL));
  const h = Math.max(1, Math.ceil(wid / BAKE_TEXEL));
  const su = len / w;
  const sv = wid / h;
  return { O, U: { x: along.x * su, y: along.y * su, z: along.z * su }, V: { x: across.x * sv, y: across.y * sv, z: across.z * sv }, w, h, plane };
}

// 벽 평면(z = SHELF_DEPTH)에서 화면에 보이는 가로 범위: 원근으로 벽은 화면보다 조금 넓게 보인다(줄 공간 x, 기준선에서 화면 양 끝)
const WALL_D = 1 + SHELF_DEPTH / VIEW_DIST;
export const WALL_X0 = VIEW_CX + (-SHELF.sideMargin - VIEW_CX) * WALL_D;
export const WALL_X1 = VIEW_CX + (DESIGN_WIDTH - SHELF.sideMargin - VIEW_CX) * WALL_D;

// 굽기 영역: 벽 한 띠(높이 y0 ~ y1, 그림 (0, 0) = 위 왼쪽), 판 윗면(그림 (0, 0) = 뒤 왼쪽, 가로 → 오른쪽, 세로 → 앞: 윗면 질감과 같은 방향),
// 판 앞면(그림 (0, 0) = 위 왼쪽, 세로 → 아래)
export function wallArea(y0: number, y1: number) {
  return bakeArea({ x: WALL_X0, y: y1, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, WALL_X1 - WALL_X0, y1 - y0, WALL);
}
export const TOP_AREA = bakeArea({ x: SHELF_X0, y: 0, z: SHELF_DEPTH }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, SHELF_X1 - SHELF_X0, SHELF_DEPTH + SHELF_FRONT, TOP);
export const FRONT_AREA = bakeArea({ x: SHELF_X0, y: 0, z: -SHELF_FRONT }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, SHELF_X1 - SHELF_X0, SHELF_THICK, FRONT);

// 벽 그림 칸 → 캔버스 px(벽 평면은 화면에 평행해 확대·이동뿐)
function wallMatrix(c: Cam, px: Affine, a: BakeArea) {
  'worklet';
  const o = toPx(c, px, a.O);
  const e = toPx(c, px, { x: a.O.x + a.U.x, y: a.O.y + a.V.y, z: a.O.z });
  return [e.x - o.x, 0, o.x, 0, e.y - o.y, o.y, 0, 0, 1];
}

// 벽 한 띠(높이 y0 ~ y1, 줄 공간: 구운 영역): 벽 색 × (받는 빛 + 반사광)을 한 번에 칠한다(불투명). akey: 줄 아틀라스에서 이 띠의 자리,
// top·bottom: 칠하는 위·아래 끝(없으면 y1·y0, 구운 영역 밖은 가장자리 값), keyShadow: 이 줄 책이 벽에서 창빛을 가리는 몫(ShelfMotion useWallKey)
export function ShelfWall({ cam, px, y0, y1, top = y1, bottom = y0, env, atlas, akey, zIndex, keyShadow }: { cam: RO<Camera>; px: Affine; y0: number; y1: number; top?: number; bottom?: number; env: Env; atlas?: RO<Atlas>; akey: string; zIndex: number; keyShadow?: RO<PlaneKey> }) {
  const area = useMemo(() => wallArea(y0, y1), [y0, y1]);
  const matrix = useCallback((c: Cam) => {
    'worklet';
    return wallMatrix(c, px, area);
  }, [px, area]);
  const path = useDerivedValue(() => {
    const c = cam.value;
    const a = toPx(c, px, { x: 0, y: top, z: SHELF_DEPTH }).y;
    const b = toPx(c, px, { x: 0, y: bottom, z: SHELF_DEPTH }).y;
    const p = Skia.PathBuilder.Make();
    p.addRect(Skia.XYWHRect(-FAR, a, 2 * FAR, b - a));
    return p.detach();
  });
  return (
    <Group zIndex={zIndex}>
      {LIGHT_ON.wall ? (
        <BakedPlane path={path} cam={cam} px={px} plane={WALL} env={env} atlas={atlas} akey={akey} matrix={matrix} albedo={DESIGN.wall} eref={EREF.wall} sref={SREF.wall} mat="paint" color={surfaces.wall} keyShadow={keyShadow} />
      ) : (
        <Path path={path} color={surfaces.wall} />
      )}
    </Group>
  );
}

function Face({ poly, children }: { poly: RO<SkPath>; children?: React.ReactNode }) {
  return (
    <>
      <Path path={poly} color={surfaces.plank} />
      {children}
    </>
  );
}

// 판의 화면 모양(px 변환 px로): 윗면·앞면 다각형과 두 면의 투영 껍질을 모서리 반지름(EDGE_R)으로 둥글린 윤곽.
// 판 그리기(ShelfBoard)와 아래 줄 캔버스가 이 판 자리를 비우는 윤곽이 같은 모양을 쓴다(판 끝 둥근 모서리로 깎인 곳은 아래 줄이 판 밑 벽을 칠한다)
export function plankShape(c: Camera, px: Affine) {
  'worklet';
  const f = shelfFaces(c);
  const s = px.s;
  const P = (q: Point) => ({ x: q.x * s + px.tx, y: q.y * s + px.ty });
  const top = f.top.poly.map(P);
  // 앞면은 위 변(윗면과 공유)을 위로 조금 덮는다
  const front = grow(f.front.poly.map(P), 0, 1, { x: 0, y: -1 });
  return { top, front, outline: roundedPolygon(hull([...top, ...front]), EDGE_R * s) };
}
export function plankOutlinePath(c: Camera, px: Affine) {
  'worklet';
  return pathOf(plankShape(c, px).outline);
}

// 판(윗면·앞면). env: 이 판 위 줄의 둘레, atlas: 그 줄의 구운 하늘 가림(TOP_KEY·FRONT_KEY 자리), keyShadow: 그 줄 책이 판 윗면에서 창빛을 가리는 몫
export const TOP_KEY = 'plank:top';
export const FRONT_KEY = 'plank:front';
export function ShelfBoard({ px, cam, zIndex, env, atlas, keyShadow }: { px: Affine; cam: RO<Camera>; zIndex: Readonly<SharedValue<number>> | number; env: Env; atlas?: RO<Atlas>; keyShadow?: RO<PlaneKey> }) {
  const s = px.s;
  // 판마다 나무 무늬 자리를 다르게(판 높이로)
  const seed = useMemo(() => seedOf(`plank:${env.floor.toFixed(2)}`), [env.floor]);
  // 지금 카메라로 판 면을 투영(시점을 끄는 동안에도 매 프레임)
  // 판 면을 둥근 윤곽 안쪽으로 잘라 안티에일리어싱되는 경로로 칠한다(경로 자르기는 안티에일리어싱이 없어 계단이 되고,
  // 레이어에 그려 윤곽으로 남기는 방식은 판에서 먹히지 않았다)
  const g = useDerivedValue(() => {
    const sh = plankShape(cam.value, px);
    return { top: pathOf(clipConvexBy(sh.top, sh.outline)), front: pathOf(clipConvexBy(sh.front, sh.outline)) };
  });
  const topP = useDerivedValue(() => g.value.top);
  const frontP = useDerivedValue(() => g.value.front);
  const topL = useCallback((c: Cam, w: number, h: number) => {
    'worklet';
    return faceTextureMatrix(shelfFaces(c).top, w, h, s, px.tx, px.ty);
  }, [s, px]);
  const frontL = useCallback((c: Cam, w: number, h: number) => {
    'worklet';
    return faceTextureMatrix(shelfFaces(c).front, w, h, s, px.tx, px.ty);
  }, [s, px]);
  const on = LIGHT_ON.plank && SHOW.shelfShade;
  return (
    <Group zIndex={zIndex}>
      <Face poly={topP}>
        {on ? <BakedPlane path={topP} cam={cam} px={px} plane={TOP} env={env} atlas={atlas} akey={TOP_KEY} matrix={topL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat="wood" seed={seed} keyShadow={keyShadow} /> : null}
      </Face>
      <Face poly={frontP}>
        {on ? <BakedPlane path={frontP} cam={cam} px={px} plane={FRONT} env={env} atlas={atlas} akey={FRONT_KEY} matrix={frontL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat="wood" seed={seed} /> : null}
      </Face>
    </Group>
  );
}
