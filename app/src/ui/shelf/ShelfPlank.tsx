// 선반 판, 틀, 벽(세 부품, 스킨 scene-config/skin). 장면(ShelfScene)이 줄마다 그린다.
// 모양: 3D 판 꼭짓점을 책과 같은 카메라로 투영한 면(domain/shelf-geom). 화면에 보이는 선반 외곽 = 이 면들의 외곽(모서리 반지름 PLANK_END_R).
// 그리는 순서는 장면 전체의 가림 순서(판도 책과 같은 3D 상자로 정렬): 아래 줄 책머리 위, 이 줄 책 아래.
// 재질: 판 색 하나(ui/lighting surfaces.plank). 나무 결(반사율·미세 높이)과 벽 칠(무광 페인트)은 빛 셰이더가 재질(ui/lighting materials)로 계산한다.
// 밝기: 빛 모델 하나(SceneLight). 판 윗면은 그 위 책·벽·위 판이 가린 하늘, 둥근 앞 모서리는 원호 법선의 빛이다.
// 벽: 벽 색 위에 같은 셰이더로 다시 칠한다(판·책이 가린 하늘, 위 판이 가린 창빛). 맨 아랫줄은 판 밑 벽도.
// 벽·판의 하늘 가림은 줄의 모든 책이 가려 무거워서 줄 아틀라스에 굽는다(줄이 멈췄을 때만, ShelfScene useRowAtlas).
import { Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useCallback, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { toPx, VIEW_CX, VIEW_DIST, type Affine, type Cam, type Vec3 } from '@/domain/camera';
import { project, type Camera } from '@/domain/box';
import { BACK_CORNER_R, PLANK_END_R, RIM_CORNER, SOFT_W } from '@/domain/book-parts';
import { DESIGN_WIDTH, FRAME_FRONT, FRAME_X0, FRAME_X1, RIM_R, SHELF, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '@/domain/geometry';
import { darkening, DESIGN, EREF, FAR, NEGLIGIBLE, shadowAlpha, SOFT_DEPTH, SREF, type Env } from '@/domain/light-model';
import { hull } from '@/domain/shadow-shape';
import type { Point } from '@/domain/shelf-scene';
import { faceTextureMatrix, quadFace, shelfFaces } from '@/domain/shelf-geom';
import { FRAME_ON } from '@/scene-config/skin';
import { SCENE_PAD } from '@/ui/shelf/metrics';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { clipConvexBy, roundedPolygon } from '@/ui/book3d/face-geometry';
import { surfaceMats, surfaces } from '@/ui/lighting';
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
// 판 앞면 양 끝의 둥근 법선 폭: 사진에서 끝 2~3px가 곡면으로 어두워진다(윤곽 반지름 2mm보다 좁다. 윤곽과 같은 폭이면 앞 모서리 빛줄이 끝에서 일찍 끊긴다)
const PLANK_END_NORMAL_R = 1;
// 판 윗면(y = 0): 앞 모서리 둥글기. 판 앞면(z = −SHELF_FRONT): 위·아래 모서리 둥글기. 벽(z = SHELF_DEPTH): 판과 만나는 안쪽 모서리라 둥글기 없음
const TOP: Plane = { O: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 1, z: 0 }, edges: [{ T: { x: 0, y: 0, z: -1 }, at: SHELF_FRONT }] };
const FRONT: Plane = {
  O: { x: 0, y: 0, z: -SHELF_FRONT },
  n: { x: 0, y: 0, z: -1 },
  edges: [
    { T: { x: 0, y: 1, z: 0 }, at: 0 },
    { T: { x: 0, y: -1, z: 0 }, at: SHELF_THICK },
  ],
  endR: PLANK_END_NORMAL_R,
};
// 벽 평면: 뒷벽(z = SHELF_DEPTH), 움푹 파인 책장의 구멍 밖 평평한 벽(z = −FRAME_FRONT)
function wallPlane(z: number): Plane {
  return { O: { x: 0, y: 0, z }, n: { x: 0, y: 0, z: -1 } };
}

// 줄의 둘레: 판 윗면 y = 0, 위 판 아랫면 y = space. 움푹 파인 책장이면 맨 윗줄도 구멍 위쪽 면 아래이고 양옆이 안쪽 면으로 막힌다(틀이 없으면 맨 윗줄 위는 열려 있다)
export function rowEnv(space: number, top: boolean): Env {
  return FRAME_ON ? { floor: 0, ceil: space, side: true } : { floor: 0, ceil: top ? FAR : space };
}
// 맨 아랫줄 판 밑 벽의 둘레: 위로 판 아랫면만(틀이 없을 때. 움푹 파인 책장은 판이 벽보다 뒤라 판 밑 평평한 벽을 가리지 않는다)
export const FLAT_Z = FRAME_ON ? -FRAME_FRONT : SHELF_DEPTH;
export const UNDER_ENV: Env = { floor: -FAR, ceil: -SHELF_THICK };

// 맨 아랫줄 판 밑 벽이 판 때문에 어두워지는 깊이: 어둠이 화면 한 단계의 절반보다 작아지는 곳까지(판 가운데 아래에서)
const MID_X = (SHELF_X0 + SHELF_X1) / 2;
export const SHELF_CAST_EXTENT = FRAME_ON ? RIM_R + 8 : (() => {
  const n: Vec3 = { x: 0, y: 0, z: -1 };
  let d = 1;
  while (d < 1000 && shadowAlpha(darkening({ x: MID_X, y: -SHELF_THICK - d, z: FLAT_Z }, n, UNDER_ENV, [])) >= NEGLIGIBLE) d *= 1.1;
  return d;
})();
// 맨 아랫줄 구멍 아래 끝: 판 아랫면보다 이만큼 위다. 벽이 판보다 앞이라 화면에서 구멍 끝이 판 아랫면보다 조금 낮게 나와, 그 틈이 비지 않게 판이 구멍 끝을 덮는다
export const HOLE_BOTTOM_OVER = 0.6;

// 평면 사각형 영역을 칸 간격 BAKE_TEXEL 안팎으로 나눈 굽기 영역(가로·세로 칸 크기는 영역에 꼭 맞게)
function bakeArea(O: Vec3, along: Vec3, across: Vec3, len: number, wid: number, plane: Plane, texU = BAKE_TEXEL, texV = BAKE_TEXEL): BakeArea {
  const w = Math.max(1, Math.ceil(len / texU));
  const h = Math.max(1, Math.ceil(wid / texV));
  const su = len / w;
  const sv = wid / h;
  return { O, U: { x: along.x * su, y: along.y * su, z: along.z * su }, V: { x: across.x * sv, y: across.y * sv, z: across.z * sv }, w, h, plane };
}

// 벽 평면(z = SHELF_DEPTH)에서 화면에 보이는 가로 범위: 원근으로 벽은 화면보다 조금 넓게 보인다(줄 공간 x, 기준선에서 화면 양 끝)
const WALL_D = 1 + SHELF_DEPTH / VIEW_DIST;
export const WALL_X0 = VIEW_CX + (-SHELF.sideMargin - SCENE_PAD - VIEW_CX) * WALL_D;
export const WALL_X1 = VIEW_CX + (DESIGN_WIDTH - SHELF.sideMargin + SCENE_PAD - VIEW_CX) * WALL_D;

// 굽기 영역: 벽 한 띠(높이 y0 ~ y1, 그림 (0, 0) = 위 왼쪽), 판 윗면(그림 (0, 0) = 뒤 왼쪽, 가로 → 오른쪽, 세로 → 앞: 윗면 질감과 같은 방향),
// 판 앞면(그림 (0, 0) = 위 왼쪽, 세로 → 아래)
export function wallArea(y0: number, y1: number, z = SHELF_DEPTH) {
  return bakeArea({ x: WALL_X0, y: y1, z }, { x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, WALL_X1 - WALL_X0, y1 - y0, wallPlane(z));
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
export function ShelfWall({ cam, px, y0, y1, z = SHELF_DEPTH, top = y1, bottom = y0, roofY, env, atlas, akey, zIndex, keyShadow }: { cam: RO<Camera>; px: Affine; y0: number; y1: number; z?: number; roofY?: number; top?: number; bottom?: number; env: Env | null; atlas?: RO<Atlas>; akey: string; zIndex: number; keyShadow?: RO<PlaneKey> }) {
  const area = useMemo(() => wallArea(y0, y1, z), [y0, y1, z]);
  const matrix = useCallback((c: Cam) => {
    'worklet';
    return wallMatrix(c, px, area);
  }, [px, area]);
  const inNiche = FRAME_ON && z === SHELF_DEPTH;
  // 뒷벽 번짐: 양옆과 맨 윗줄 천장 쪽(다른 줄 위쪽과 아래쪽은 판에 가려 번질 곳이 없다)
  const soft = useMemo(() => (inNiche ? { box: [FRAME_X0, FRAME_X1, -FAR, roofY ?? FAR], r: [BACK_CORNER_R, SOFT_W] } : undefined), [inNiche, roofY]);
  const path = useDerivedValue(() => {
    const c = cam.value;
    const a = toPx(c, px, { x: 0, y: top, z }).y;
    const b = toPx(c, px, { x: 0, y: bottom, z }).y;
    // 움푹 파인 책장의 뒷벽: 안쪽 면 사이(틀 면 위에 그린다). 꼭지점 둥글기와 안쪽 면·천장으로 넘어가는 번짐은 셰이더가 투명도로 그린다(soft)
    if (inNiche) {
      const xl = toPx(c, px, { x: FRAME_X0, y: 0, z }).x;
      const xr = toPx(c, px, { x: FRAME_X1, y: 0, z }).x;
      return pathOf([{ x: xl, y: a }, { x: xr, y: a }, { x: xr, y: b }, { x: xl, y: b }]);
    }
    const p = Skia.PathBuilder.Make();
    p.addRect(Skia.XYWHRect(-FAR, a, 2 * FAR, b - a));
    return p.detach();
  });
  return (
    <Group zIndex={zIndex}>
      {LIGHT_ON.wall ? (
        <BakedPlane path={path} cam={cam} px={px} plane={area.plane} env={env} atlas={atlas} akey={akey} matrix={matrix} albedo={DESIGN.wall} eref={EREF.wall} sref={SREF.wall} mat={surfaceMats.wall} color={surfaces.wall} keyShadow={keyShadow} soft={soft} />
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

// 둔각 꼭짓점(판 윗면 빗변과 앞면 세로 변이 만나는 어깨)은 같은 반지름으로 둥글려도 곡선이 아주 짧아 뾰족해 보인다(2026-11-05 사용자 '선반 끝 곡선').
// 양쪽 변으로 d만큼 물러난 두 점으로 바꿔 직각 모서리와 비슷한 길이의 곡선이 되게 한다
function softShoulders(pts: Point[], d: number): Point[] {
  'worklet';
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a.x - v.x, a.y - v.y);
    const lb = Math.hypot(b.x - v.x, b.y - v.y);
    const cos = la > 0 && lb > 0 ? ((a.x - v.x) * (b.x - v.x) + (a.y - v.y) * (b.y - v.y)) / (la * lb) : 0;
    // 안쪽 각이 110°보다 크고 양쪽 변이 충분히 길 때만(cos 110° ≈ −0.34)
    if (cos < -0.34 && la > 4 * d && lb > 4 * d) {
      out.push({ x: v.x + ((a.x - v.x) / la) * d, y: v.y + ((a.y - v.y) / la) * d }, { x: v.x + ((b.x - v.x) / lb) * d, y: v.y + ((b.y - v.y) / lb) * d });
    } else out.push(v);
  }
  return out;
}

// 판의 화면 모양(px 변환 px로): 윗면·앞면 다각형과 두 면의 투영 껍질을 모서리 반지름(PLANK_END_R)으로 둥글린 윤곽.
// 판 그리기(ShelfBoard)와 아래 줄 캔버스가 이 판 자리를 비우는 윤곽이 같은 모양을 쓴다(판 끝 둥근 모서리로 깎인 곳은 아래 줄이 판 밑 벽을 칠한다)
export function plankShape(c: Camera, px: Affine) {
  'worklet';
  const f = shelfFaces(c);
  const s = px.s;
  const P = (q: Point) => ({ x: q.x * s + px.tx, y: q.y * s + px.ty });
  const top = f.top.poly.map(P);
  // 앞면은 위 변(윗면과 공유)을 위로 조금 덮는다
  const front = grow(f.front.poly.map(P), 0, 1, { x: 0, y: -1 });
  return { top, front, outline: roundedPolygon(softShoulders(hull([...top, ...front]), PLANK_END_R * s), PLANK_END_R * s) };
}
// 아래 줄 캔버스가 비우는 자리. 경로 자르기는 안티에일리어싱이 없어 둥근 모서리 쪽에서만 판의 마지막 어두운 화소 줄이 드러났다(1줄, 약 5px): 아래 끝을 1px 올려 그 줄은 어디서나 아래 줄이 덮는다
export function plankOutlinePath(c: Camera, px: Affine) {
  'worklet';
  const o = plankShape(c, px).outline;
  let y1 = -Infinity;
  for (const q of o) y1 = Math.max(y1, q.y);
  return pathOf(o.map((q) => ({ x: q.x, y: Math.min(q.y, y1 - 1) })));
}

// 판(윗면·앞면). env: 이 판 위 줄의 둘레, atlas: 그 줄의 구운 하늘 가림(TOP_KEY·FRONT_KEY 자리), keyShadow·frontShadow: 그 줄 책이 판 윗면·앞면에서 창빛을 가리는 몫
// 판 윗면 번짐: 뒷벽·안쪽 면으로(나무와 벽이라 재질이 달라 벽끼리 번짐의 절반 폭). 뒤 꼭지점은 둥글리지 않는다: 깊이가 눌려 보여 곧은 대각선 끝에 혹처럼 보인다(2026-11-04 사용자 '쭈글쭈글', 시안은 끝까지 곧다)
const PLANK_CORNER = 1;
const PLANK_SOFT = { box: [FRAME_X0, FRAME_X1, -FAR, SHELF_DEPTH * SOFT_DEPTH], r: [PLANK_CORNER, SOFT_W / 2] };
// 천장 번짐: 양옆 안쪽 면으로
const ROOF_SOFT = { box: [FRAME_X0, FRAME_X1, -FAR, FAR], r: [0, SOFT_W] };
export const TOP_KEY = 'plank:top';
export const FRONT_KEY = 'plank:front';
export function ShelfBoard({ px, cam, zIndex, env, atlas, keyShadow, frontShadow }: { px: Affine; cam: RO<Camera>; zIndex: Readonly<SharedValue<number>> | number; env: Env; atlas?: RO<Atlas>; keyShadow?: RO<PlaneKey>; frontShadow?: RO<PlaneKey> }) {
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
      {on && FRAME_ON ? (
        <>
          <BakedPlane path={topP} cam={cam} px={px} plane={TOP} env={env} atlas={atlas} akey={TOP_KEY} matrix={topL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat={surfaceMats.plank} seed={seed} keyShadow={keyShadow} color={surfaces.plank} soft={PLANK_SOFT} />
          <BakedPlane path={frontP} cam={cam} px={px} plane={FRONT} env={env} atlas={atlas} akey={FRONT_KEY} matrix={frontL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat={surfaceMats.plank} seed={seed} keyShadow={frontShadow} color={surfaces.plank} />
        </>
      ) : (
        <>
          <Face poly={topP}>
            {on ? <BakedPlane path={topP} cam={cam} px={px} plane={TOP} env={env} atlas={atlas} akey={TOP_KEY} matrix={topL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat={surfaceMats.plank} seed={seed} keyShadow={keyShadow} /> : null}
          </Face>
          <Face poly={frontP}>
            {on ? <BakedPlane path={frontP} cam={cam} px={px} plane={FRONT} env={env} atlas={atlas} akey={FRONT_KEY} matrix={frontL} albedo={DESIGN.plank} eref={EREF.plank} sref={SREF.plank} mat={surfaceMats.plank} seed={seed} keyShadow={frontShadow} /> : null}
          </Face>
        </>
      )}
    </Group>
  );
}

// ---------- 움푹 파인 책장: 틀(구멍 안쪽 면)과 구멍 밖 평평한 벽 ----------
// 틀도 판·벽과 같은 빛 계산이다(같은 둘레 env의 구운 하늘 가림 + 그 자리의 창빛). 재질·색만 스킨(surfaces.frame, surfaceMats.frame)에서 온다.
// 옆을 향하고 가려진 면이라 물리대로 어둡게 보이고, 폭은 카메라 원근으로 정해진다(따로 그린 띠가 아니다).
// 면 하나 = 3D 사각형(O에서 along 방향으로 len, across 방향으로 wid) + 평면 + 아틀라스 자리(key)
const X_AXIS = { x: 1, y: 0, z: 0 };
const Y_DOWN = { x: 0, y: -1, z: 0 };
const Z_BACK = { x: 0, y: 0, z: 1 };
const LEFT_IN: Plane = { O: { x: FRAME_X0, y: 0, z: 0 }, n: { x: 1, y: 0, z: 0 } };
const RIGHT_IN: Plane = { O: { x: FRAME_X1, y: 0, z: 0 }, n: { x: -1, y: 0, z: 0 } };
// 깊이 방향 칸 간격: 안쪽 면은 원근으로 화면에서 약 6DU로 눌려 보여 칸을 벽만큼 촘촘히 구울 필요가 없다(깊이 약 170DU를 15칸)
const DEEP_TEXEL = 12;
// 틀 면을 늘려 그리는 깊이. 뒤로: 뒷벽이 위에 그려져 덮고 뒷벽 둥근 꼭지점으로 깎인 자리에만 보인다(천장은 화면에서 덜 움직여 더 늘린다).
// 앞으로: 평평한 벽 밑으로 들어가 구멍 가장자리 화소 뒤가 비지 않는다(뒤가 비면 흰 줄이 보인다)
const SIDE_BEHIND = 120;
const SIDE_AHEAD = 20;
const ROOF_BEHIND = 200;
const ROOF_AHEAD = 60;
// 맨 윗줄 안쪽 면을 천장 위로 늘려 그리는 높이: 안쪽 면과 천장이 같은 대각선에서 끝나면 두 가장자리 화소 사이로 뒤가 비쳐 흰 점선이 보인다(천장이 나중에 그려져 덮는다)
const SIDE_ABOVE = 8;
export type FramePart = { key: string; area: BakeArea; O: Vec3; U: Vec3; V: Vec3; drawO: Vec3; drawU: Vec3; drawV: Vec3 };
function framePart(key: string, O: Vec3, along: Vec3, across: Vec3, len: number, wid: number, plane: Plane, texU: number, texV: number, above = 0): FramePart {
  const scaled = (d: Vec3, l: number) => ({ x: d.x * l, y: d.y * l, z: d.z * l });
  const roof = across.z > 0;
  const ahead = roof ? ROOF_AHEAD : SIDE_AHEAD;
  const drawO = { x: O.x, y: O.y + above, z: O.z - ahead };
  return { key, area: bakeArea(O, along, across, len, wid, plane, texU, texV), O, U: scaled(along, len), V: scaled(across, wid), drawO, drawU: roof ? scaled(along, len) : scaled(along, len + ahead + SIDE_BEHIND), drawV: roof ? scaled(across, wid + ahead + ROOF_BEHIND) : scaled(across, wid + above) };
}
// 이 줄의 틀 면들: 높이 y0(아래) ~ y1(위). roofY: 맨 윗줄이면 구멍 위쪽 면 높이
export function frameParts(y0: number, y1: number, roofY: number | null): FramePart[] {
  const h = y1 - y0;
  const d = SHELF_DEPTH + FRAME_FRONT;
  const parts = [
    framePart('frame:left', { x: FRAME_X0, y: y1, z: -FRAME_FRONT }, Z_BACK, Y_DOWN, d, h, LEFT_IN, DEEP_TEXEL, BAKE_TEXEL, roofY !== null ? SIDE_ABOVE : 0),
    framePart('frame:right', { x: FRAME_X1, y: y1, z: -FRAME_FRONT }, Z_BACK, Y_DOWN, d, h, RIGHT_IN, DEEP_TEXEL, BAKE_TEXEL, roofY !== null ? SIDE_ABOVE : 0),
  ];
  if (roofY !== null) parts.push(framePart('frame:roof', { x: FRAME_X0, y: roofY, z: -FRAME_FRONT }, X_AXIS, Z_BACK, FRAME_X1 - FRAME_X0, d, { O: { x: 0, y: roofY, z: 0 }, n: { x: 0, y: -1, z: 0 } }, BAKE_TEXEL, DEEP_TEXEL));
  return parts;
}

function FramePartView({ part, cam, px, env, atlas }: { part: FramePart; cam: RO<Camera>; px: Affine; env: Env; atlas?: RO<Atlas> }) {
  const { O, U, V, drawO, drawU, drawV, area } = part;
  const s = px.s;
  const path = useDerivedValue(() => pathOf(quadFace(cam.value, drawO, drawU, drawV).poly.map((q) => ({ x: q.x * s + px.tx, y: q.y * s + px.ty }))));
  const matrix = useCallback((c: Cam, w: number, h: number) => {
    'worklet';
    return faceTextureMatrix(quadFace(c, O, U, V), w, h, s, px.tx, px.ty);
  }, [O, U, V, s, px]);
  return <BakedPlane path={path} cam={cam} px={px} plane={area.plane} env={env} atlas={atlas} akey={part.key} matrix={matrix} albedo={DESIGN.frame} eref={EREF.frame} sref={SREF.frame} mat={surfaceMats.frame} color={surfaces.frame} soft={area.plane.n.y < -0.5 ? ROOF_SOFT : undefined} />;
}

// 틀 한 줄 그리기: 뒷벽 아래(뒷벽이 둥근 사각형으로 덮는다), 평평한 벽·판·책 아래
export function ShelfFrame({ parts, cam, px, env, atlas, zIndex }: { parts: FramePart[]; cam: RO<Camera>; px: Affine; env: Env; atlas?: RO<Atlas>; zIndex: number }) {
  if (!LIGHT_ON.wall) return null;
  return (
    <Group zIndex={zIndex}>
      {parts.map((part) => <FramePartView key={part.key} part={part} cam={cam} px={px} env={env} atlas={atlas} />)}
    </Group>
  );
}

// 구멍 밖 평평한 벽(벽지): 줄 높이 bottomY ~ topY에서 구멍만 뺀 면. 가리는 것이 없어 벽지 색 그대로다(대표 자리, 맞추기).
// 구멍 가장자리 RIM_R 안은 둥근 테다(셰이더가 법선을 안쪽 면 쪽으로 돌린다): 시안처럼 벽에서 안쪽 면으로 부드럽게 이어진다.
// openTop·openBottom: 구멍의 위·아래 끝 높이(이 줄 밖까지 이어지면 null)
const FLAT_PLANE = wallPlane(-FRAME_FRONT);
const NO_MATRIX = () => {
  'worklet';
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
};
export function ShelfFlatWall({ cam, px, topY, bottomY, openTop, openBottom, ceilY, zIndex }: { cam: RO<Camera>; px: Affine; topY: number; bottomY: number; openTop: number | null; openBottom: number | null; ceilY: number; zIndex: number }) {
  const path = useDerivedValue(() => {
    const c = cam.value;
    const Y = (y: number) => toPx(c, px, { x: 0, y, z: -FRAME_FRONT }).y;
    // 뒷벽 위 끝은 카메라 기울기로 이 면 위 끝보다 화면에서 더 위에 온다. 이 면이 함께 올라가 덮지 않으면 구멍 밖으로 회색 띠가 삐져나온다.
    // 끝이 같은 줄에 겹치면 두 가장자리의 흐림 사이로 뒷벽이 비쳐 옅은 선이 남아 1px 더 올린다
    // 틀 면을 앞으로 늘려 그린 몫(SIDE_AHEAD)도 눈보다 높은 줄에서는 화면에서 더 위로 올라온다: 함께 덮지 않으면 판 옆 테에 작은 눈금이 보인다
    const ya = Math.min(Y(topY), toPx(c, px, { x: 0, y: topY, z: SHELF_DEPTH }).y - 1, toPx(c, px, { x: 0, y: topY, z: -FRAME_FRONT - SIDE_AHEAD }).y - 1);
    const yb = Y(bottomY);
    const xl = toPx(c, px, { x: FRAME_X0, y: 0, z: -FRAME_FRONT }).x;
    const xr = toPx(c, px, { x: FRAME_X1, y: 0, z: -FRAME_FRONT }).x;
    const r = RIM_CORNER * px.s;
    // 구멍(줄 밖으로 이어지는 쪽은 둥글기가 보이지 않게 더 늘렸다가 이 면 끝으로 자른다), 바깥 사각형과 반대 방향으로 감아 빈 곳이 된다
    const oa = openTop === null ? ya - 4 * r : Y(openTop);
    const ob = openBottom === null ? yb + 4 * r : Y(openBottom);
    const hole = roundedPolygon([{ x: xl, y: oa }, { x: xr, y: oa }, { x: xr, y: ob }, { x: xl, y: ob }], r).map((q) => ({ x: q.x, y: Math.max(ya, Math.min(yb, q.y)) })).reverse();
    const p = Skia.PathBuilder.Make();
    p.moveTo(-FAR, ya);
    p.lineTo(2 * FAR, ya);
    p.lineTo(2 * FAR, yb);
    p.lineTo(-FAR, yb);
    p.close();
    p.moveTo(hole[0].x, hole[0].y);
    for (let i = 1; i < hole.length; i++) p.lineTo(hole[i].x, hole[i].y);
    p.close();
    return p.detach();
  });
  const rim = useMemo(() => [FRAME_X0, FRAME_X1, openBottom ?? -FAR, openTop ?? FAR], [openBottom, openTop]);
  return (
    <Group zIndex={zIndex}>
      <BakedPlane path={path} cam={cam} px={px} plane={FLAT_PLANE} env={null} akey="wall:flat" matrix={NO_MATRIX} albedo={DESIGN.wall} eref={EREF.wall} sref={SREF.wall} mat={surfaceMats.wall} color={surfaces.wall} rim={rim} rimCeil={ceilY} />
    </Group>
  );
}
