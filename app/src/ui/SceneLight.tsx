// 화소마다의 빛(셰이더 소스 ui/scene-light-sksl, 식은 domain/light-model과 같다). 책 면·선반 판·벽이 모두 이것 하나로 밝기를 얻는다.
// 그림(재질 색 = 그 재질의 대표 자리 빛 EREF에서 보이는 색) 위에 다시 칠하는 방식은 둘:
//   곱하기(받는 빛 비 ≤ 1) · 컬러 닷지(> 1인 밝아짐 + 반사광). 감마(2.2)를 고려해 선형 빛 공간의 곱·합과 같게 하고,
//   채널마다 다르다(되비친 빛이 둘레 면 색을 띤다). 단색 재질(벽)은 재질 색 × 빛을 한 번에 칠한다.
// 무거운 몫은 하늘 가림(둘레·책 상자가 가린 하늘, 시점과 상관없다)이다. 줄마다 그 줄의 모든 면(벽·판·책 면)을 그림 한 장(아틀라스)에
// 면 좌표로 굽고(bakeAtlas: 줄의 책이 멈췄을 때만, BAKE_TEXEL 간격) 그리는 프레임에는 그 그림을 읽은 뒤 나머지
// (하늘·창빛 직접 몫은 둥근 모서리 법선까지, 반사광)만 화소마다 계산한다. 책은 한 권에 한 번(BookLight: 셰이더가 화소마다 광선으로
// 보이는 면을 찾는다), 벽·판은 평면마다(BakedPlane).
// 구운 값이 없는 면(줄 밖에서 움직이는 책, 막 들어온 책)은 둘레가 가린 하늘만 그 자리에서 계산한다(다른 책은 뺀다).
import { AlphaType, BlurStyle, ColorType, FilterMode, ImageShader, MipmapMode, Path, processUniforms, Shader, Skia, TileMode, type SkImage, type SkPath, type SkRuntimeEffect, type SkShader, type Uniforms } from '@shopify/react-native-skia';
import { Platform } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { faceNormal, rot, toWorld, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { lightPanel, rigOf } from '@/domain/book-parts';
import { camAt, VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Affine } from '@/domain/camera';
import { bookEref, ENV_NX, ENV_NY, FAR, GRID_N, GRID_PASSES, ROUGH, type Band, type BoxBuf, type C3, type Env } from '@/domain/light-model';
import type { Recv3 } from '@/domain/received3';
import { MAT_UNIFORMS, type MatUniforms } from '@/domain/surface-pattern';
import type { BindingMaterial } from '@/domain/types';
import type { MaterialName } from '@/ui/lighting';
import { faceVisible } from '@/ui/book3d/face-geometry';

import { PERF_ENABLED } from './perf';
import { bakeSource, bookSource, gridSource, litSource, LOSS_OFF, LOSS_SCALE, planeFrame, tabSource, type Plane } from './scene-light-sksl';

export type { Plane } from './scene-light-sksl';
type RO<T> = Readonly<SharedValue<T>>;

const make = (src: string) => {
  const e = Skia.RuntimeEffect.Make(src);
  if (!e) throw new Error('SceneLight shader failed to compile');
  return e;
};
const BAKE = make(bakeSource());
const GRID = make(gridSource());
// 곱하기 · 컬러 닷지: 평면, 책
const LIT = [make(litSource(false)), make(litSource(true))];
// 단색 재질(벽)은 재질 색 × 빛을 한 번에(대상 색을 읽는 겹치기가 없다)
const LIT_DIRECT = make(litSource('direct'));
const BOOK = [make(bookSource(false)), make(bookSource(true))];
const TAB = [make(tabSource(false)), make(tabSource(true))];
const BLEND = ['multiply', 'colorDodge'] as const;

const ZERO3 = [0, 0, 0];
const NO_EDGE = [0, 0, 0, 1e9];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const BASE = {
  O: ZERO3,
  Ux: ZERO3,
  Vy: ZERO3,
  Hw: [0, 0, 1],
  tN: [0, 0, -1],
  bev0: NO_EDGE,
  bev1: NO_EDGE,
  cam4: [0, 0, 0, 0],
  env: ZERO3,
  keyOn: 1,
  albedo: [1, 1, 1],
  eref: [1, 1, 1],
  liveEnv: 1,
};
// 재질 셰이더 입력(scene-light-sksl matSample): 거칠기·미세 높이·결·결 크기, 무늬 자리 어긋남(같은 재질 면이 똑같아 보이지 않게)
function matOf(m: MatUniforms, seed: number[]) {
  return { mR: m.mRough, mB: m.mBump, mG: m.mGrain, mS: m.mGsize, mSeed: seed };
}
// 문자열 → 무늬 자리 어긋남(DU, 0~1000)
export function seedOf(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return [(h % 1000) + 0.37, ((h >>> 10) % 1000) + 0.71];
}

function camOf(c: Cam, far: Vec3) {
  'worklet';
  const e = c.eye;
  return e ? [e.x, e.y, e.z, e.dist] : [far.x, far.y, far.z + 1e5, 1e5];
}
function envOf(env: Env | null) {
  'worklet';
  return env ? [1, env.floor, env.ceil] : ZERO3;
}
function arr(v: Vec3) {
  'worklet';
  return [v.x, v.y, v.z];
}

const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
// 하늘 가림 그림의 칸 간격(DU): 계산 해상도. 하늘 가림은 가리개 크기(책 두께·벽까지 거리) 정도로 천천히 바뀐다
export const BAKE_TEXEL = 2;

// ---------- 굽기(아틀라스) ----------
// 구울 면 하나: 칸 (0, 0) 모서리 O, 칸 한 개의 이동 U·V(줄 공간), 칸 수 w × h, 면 법선 n, 그 면이 받는 빛의 둘레·가리개(self: 상자 목록에서 그 면의 책),
// band: 벽의 판 두께 높이 띠(아래 판, 위 판, light-model bandOf, 없으면 null)
export type BakeItem = { key: string; O: Vec3; U: Vec3; V: Vec3; w: number; h: number; n: Vec3; env: Env | null; bx: BoxBuf; self: number; band?: [Band | null, Band | null] };
// 구운 그림과 면마다 칸 (0, 0)의 자리·칸 수. 면 둘레에 한 칸씩 더 구워 둔다(겹선형 읽기가 옆 면으로 새지 않게)
export type Atlas = { image: SkImage | null; at: Record<string, { x: number; y: number; w: number; h: number }> };
export const NO_ATLAS: Atlas = { image: null, at: {} };
const GUTTER = 1;
const ATLAS_W = 512;

// 구운 그림의 칸 값이 화면에 그릴 때 색 변환되지 않게 화면 표면과 같은 색 공간에 굽는다
// (안드로이드 화면·화면 밖 표면은 둘 다 색 공간 없음, iOS 화면은 Display P3)
const BAKE_SURFACE = Platform.OS === 'ios' ? { colorSpace: 'display-p3' as const } : undefined;
// 측정 번들: 굽기마다 칸 수·걸린 시간(GPU가 끝날 때까지 1화소 읽어 기다린다)
const BAKE_STAT = PERF_ENABLED;

// UI 스레드에서 만든 그림은 자바스크립트 GC가 돌 때까지 GPU 메모리를 잡고 있다(GC는 그 크기를 모른다).
// 같은 자리(key)의 새 그림이 나오면 두 세대 전 그림을 놓아준다(그 사이 캔버스가 새 그림으로 다시 그렸다)
export function keepLatest<T extends SkImage | null>(key: string, img: T): T {
  'worklet';
  const g = globalThis as unknown as { __kept?: Record<string, SkImage[]> };
  const kept = g.__kept ?? (g.__kept = {});
  const list = kept[key] ?? (kept[key] = []);
  if (img && list[list.length - 1] !== img) list.push(img);
  while (list.length > 3) list.shift()!.dispose();
  return img;
}

function bandMid(b: Band | null | undefined) {
  'worklet';
  return b ? [b.mid[0], b.mid[1], b.mid[2], 1] : [0, 0, 0, 0];
}
function bandFar(b: Band | null | undefined) {
  'worklet';
  return b ? [b.far[0], b.far[1], b.far[2]] : ZERO3;
}

// 셰이더 자식 자리를 채우는 그림(구운 값이 없을 때. 그때 셰이더는 그림을 읽지 않는다)
const EMPTY = Skia.Image.MakeImage(
  { width: 1, height: 1, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
  Skia.Data.fromBytes(new Uint8Array([...Array(3).fill(Math.round((LOSS_OFF / LOSS_SCALE) * 255)), 255])),
  4,
)!;

// 창빛 그림자가 없는 면(투명: 가리는 몫 0)
export const NO_IMAGE = Skia.Image.MakeImage({ width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 }, Skia.Data.fromBytes(new Uint8Array(4)), 4)!;
// 평면(벽·판 윗면)이 받는 창빛 그림자: 책이 창빛 원반을 가리는 몫(알파) 그림과 평면 점 P → 그림 px 사상((P·kU, P·kV) + kO)
export type PlaneKey = { image: SkImage; kU: number[]; kV: number[]; kO: number[] };
export const NO_PLANE_KEY: PlaneKey = { image: NO_IMAGE, kU: [0, 0, 0], kV: [0, 0, 0], kO: [-8, -8] };
function keyMapOf(k: PlaneKey) {
  'worklet';
  return { kU: k.kU, kV: k.kV, kO: k.kO };
}

// 셰이더 자식으로 읽는 그림(칸 사이 선형, 끝은 늘림)
function linearShader(img: SkImage): SkShader {
  'worklet';
  return img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
}

// 빛 격자(light-model solveGrid)를 GPU로: 줄 둘레·상자 목록 하나에 그림 한 장(scene-light-sksl GRID_SCALE 칸 배치).
// GRID_PASSES번 되풀이: 같은 표면에 다시 그리며 지난 그림(스냅숏)을 읽는다(첫 번은 가리개를 가림 없는 받는 빛으로)
function solveGridImage(env: Env, bx: BoxBuf): SkImage | null {
  'worklet';
  const nBox = bx.list.length;
  const W = 6 * GRID_N;
  const H = nBox * GRID_N + 3 * ENV_NY;
  const surf = Skia.Surface.MakeOffscreen(W, H, BAKE_SURFACE);
  if (!surf) return null;
  const canvas = surf.getCanvas();
  const paint = Skia.Paint();
  let img: SkImage | null = null;
  const prev: SkImage[] = [];
  for (let k = 0; k < GRID_PASSES; k++) {
    const u = { env: envOf(env), box: bx.v, nBox, gridOn: img ? 1 : 0, gridNx: nBox ? ENV_NX : 1 };
    paint.setShader(GRID.makeShaderWithChildren(processUniforms(GRID, u), [linearShader(img ?? EMPTY)]));
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), paint);
    // 스냅숏은 표면을 다시 그리기 전에 떠 둔다(GPU 순서는 Skia가 지킨다: 되풀이마다 기다리지 않는다)
    const next = surf.makeImageSnapshot();
    prev.push(next);
    img = next;
  }
  surf.flush();
  for (const p of prev) if (p !== img) p.dispose();
  surf.dispose();
  return img;
}

// 푼 빛 격자 그림을 둘레·상자 값이 같으면 다시 쓴다(머리글 벽과 맨 윗줄은 같은 책 상자다). 최근 GRID_KEEP장만 두고 나머지는 놓아준다
// (그림은 굽는 동안에만 읽는다)
const GRID_KEEP = 6;
function cachedGrid(env: Env, bx: BoxBuf): SkImage | null {
  'worklet';
  const g = globalThis as unknown as { __grids?: { key: string; img: SkImage | null }[] };
  const list = g.__grids ?? (g.__grids = []);
  const key = `${env.floor},${env.ceil}|${bx.v.slice(0, bx.list.length * 32).join(',')}`;
  const i = list.findIndex((e) => e.key === key);
  if (i >= 0) {
    const e = list.splice(i, 1)[0];
    list.push(e);
    return e.img;
  }
  const img = solveGridImage(env, bx);
  list.push({ key, img });
  while (list.length > GRID_KEEP) list.shift()!.img?.dispose();
  return img;
}

export function bakeAtlas(items: BakeItem[], key: string): Atlas {
  'worklet';
  // 굽기는 UI 스레드에서만(파생 값은 마운트 직후 UI에서 다시 돈다)
  if (!(globalThis as { _WORKLET?: boolean })._WORKLET || !items.length) return NO_ATLAS;
  const t0 = BAKE_STAT ? performance.now() : 0;
  // 선반 쌓기: 높이 순으로 왼쪽부터, 줄이 차면 아래로
  const order = items.map((_, i) => i).sort((a, b) => items[b].h - items[a].h);
  let W = ATLAS_W;
  for (const it of items) W = Math.max(W, it.w + 2 * GUTTER);
  const at: Atlas['at'] = {};
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const i of order) {
    const it = items[i];
    const fw = it.w + 2 * GUTTER;
    if (x + fw > W) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    at[it.key] = { x: x + GUTTER, y: y + GUTTER, w: it.w, h: it.h };
    x += fw;
    shelf = Math.max(shelf, it.h + 2 * GUTTER);
  }
  const H = y + shelf;
  const surf = Skia.Surface.MakeOffscreen(W, H, BAKE_SURFACE);
  if (!surf) return NO_ATLAS;
  const canvas = surf.getCanvas();
  const paint = Skia.Paint();
  // 줄 둘레·상자 목록마다 빛 격자 한 장(가리개 면 밝기)
  const grids: { env: Env; bx: BoxBuf; img: SkImage | null }[] = [];
  let gridMs = 0;
  const gridOf = (env: Env | null, bx: BoxBuf) => {
    if (!env) return null;
    for (const g of grids) if (g.bx === bx && g.env.floor === env.floor && g.env.ceil === env.ceil) return g.img;
    const t = BAKE_STAT ? performance.now() : 0;
    const img = cachedGrid(env, bx);
    if (BAKE_STAT && img) {
      img.readPixels(0, 0, { width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 });
      gridMs += performance.now() - t;
    }
    grids.push({ env, bx, img });
    return img;
  };
  for (const it of items) {
    const r = at[it.key];
    const g = gridOf(it.env, it.bx);
    const u = {
      O: arr(it.O), Ux: arr(it.U), Vy: arr(it.V), tN: arr(it.n), env: envOf(it.env), box: it.bx.v, nBox: it.bx.list.length, selfIdx: it.self,
      bandLo: bandMid(it.band?.[0]), bandLoFar: bandFar(it.band?.[0]), bandHi: bandMid(it.band?.[1]), bandHiFar: bandFar(it.band?.[1]),
      gridOn: g ? 1 : 0, gridNx: it.bx.list.length ? ENV_NX : 1,
    };
    paint.setShader(BAKE.makeShaderWithChildren(processUniforms(BAKE, u), [linearShader(g ?? EMPTY)]));
    canvas.save();
    canvas.translate(r.x, r.y);
    canvas.drawRect(Skia.XYWHRect(-GUTTER, -GUTTER, it.w + 2 * GUTTER, it.h + 2 * GUTTER), paint);
    canvas.restore();
  }
  surf.flush();
  const image = keepLatest(key, surf.makeImageSnapshot());
  surf.dispose();
  if (BAKE_STAT) {
    image.readPixels(0, 0, { width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 });
    console.log('[bake]', items.length, 'items', `${W}x${H}`, 'ms', (performance.now() - t0).toFixed(1), 'grid', grids.length, gridMs.toFixed(1));
  }
  return { image, at };
}

// 아틀라스에서 면 key의 그림 읽기: 그림 px → 그리는 좌표 행렬. M: 그 면의 칸 → 그리는 좌표(3×3 행 우선)
export type Sample = { image: SkImage; matrix: number[]; live: number };
const NO_SAMPLE: Sample = { image: EMPTY, matrix: IDENTITY, live: 1 };
function sampleOf(a: Atlas, key: string, M: (w: number, h: number) => number[]): Sample {
  'worklet';
  const r = a.at[key];
  if (!a.image || !r) return NO_SAMPLE;
  const m = M(r.w, r.h);
  return { image: a.image, matrix: [m[0], m[1], m[2] - m[0] * r.x - m[1] * r.y, m[3], m[4], m[5] - m[3] * r.x - m[4] * r.y, m[6], m[7], m[8] - m[6] * r.x - m[7] * r.y], live: 0 };
}

// 두 겹(곱하기·닷지)으로 영역(path)을 다시 칠한다. fx: [곱하기, 닷지] 셰이더, sample: 셰이더 자식(구운 그림과 행렬)
function Relit({ path, fx, uniforms, sample, keyImage }: { path: RO<SkPath> | SkPath; fx: SkRuntimeEffect[]; uniforms: RO<Uniforms>; sample: RO<Sample>; keyImage: RO<SkImage> }) {
  const image = useDerivedValue(() => sample.value.image);
  const matrix = useDerivedValue(() => sample.value.matrix);
  return (
    <>
      {fx.map((e, i) => (
        <Path key={i} path={path} blendMode={BLEND[i]}>
          <Shader source={e} uniforms={uniforms}>
            <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
            <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
          </Shader>
        </Path>
      ))}
    </>
  );
}

// ---------- 책 ----------
const FACES: FaceId[] = ['spine', 'cover', 'back', 'head', 'tail', 'fore'];

// 책 면이 받는 창빛 그림자(다른 책이 창빛 원반을 가리는 몫, 알파)를 면 좌표 그림으로: 받는 면(많아야 둘)을 가로로 나란히,
// 면 칸 안에서 (u, v)(DU, book-parts lightPanel 틀) × 배율 s. 그림자 구간(빛 길이)마다 가려지는 몫 w로 칠하고 반그림자만큼 흐린다.
// rects: 셰이더 kRect(면마다 칸 원점·배율·있음)
export type BookKey = { image: SkImage; rects: number[] };
const NO_RECTS = new Array(24).fill(0);
export const NO_BOOK_KEY: BookKey = { image: NO_IMAGE, rects: NO_RECTS };
export function bookKeyImage(key: string, r: Recv3, s: number): BookKey {
  'worklet';
  if (!r || !r.faces.length || !(globalThis as { _WORKLET?: boolean })._WORKLET) return NO_BOOK_KEY;
  const b = r.b;
  const X = rot(b.roll, b.yaw, { x: 1, y: 0, z: 0 }, b.spin ?? 0, b.pitch ?? 0);
  const Y = rot(b.roll, b.yaw, { x: 0, y: 1, z: 0 }, b.spin ?? 0, b.pitch ?? 0);
  const Z = rot(b.roll, b.yaw, { x: 0, y: 0, z: 1 }, b.spin ?? 0, b.pitch ?? 0);
  const cells: { f: number; x: number; w: number; h: number }[] = [];
  let W = 0;
  let H = 1;
  for (const fc of r.faces) {
    const pn = lightPanel(b.dims, fc.f);
    const w = Math.ceil(pn.w * s) + 2;
    const h = Math.ceil(pn.h * s) + 2;
    cells.push({ f: FACES.indexOf(fc.f), x: W + 1, w, h });
    W += w;
    H = Math.max(H, h);
  }
  const surf = Skia.Surface.MakeOffscreen(Math.max(1, W), H);
  if (!surf) return NO_BOOK_KEY;
  const canvas = surf.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color('black'));
  const rects = NO_RECTS.slice();
  r.faces.forEach((fc, i) => {
    const c = cells[i];
    const pn = lightPanel(b.dims, fc.f);
    const ul = Math.hypot(pn.U.x, pn.U.y, pn.U.z) || 1;
    const vl = Math.hypot(pn.V.x, pn.V.y, pn.V.z) || 1;
    // 줄 공간 점 → 책 좌표 → 면 좌표(u, v) → 그림 px
    const toPx = (q: Vec3) => {
      const d = { x: q.x - b.t.x, y: q.y - b.t.y, z: q.z - b.t.z };
      const l = { x: d.x * X.x + d.y * X.y + d.z * X.z, y: d.x * Y.x + d.y * Y.y + d.z * Y.z, z: d.x * Z.x + d.y * Z.y + d.z * Z.z };
      const o = { x: l.x - pn.O.x, y: l.y - pn.O.y, z: l.z - pn.O.z };
      return { x: c.x + ((o.x * pn.U.x + o.y * pn.U.y + o.z * pn.U.z) / ul) * s, y: 1 + ((o.x * pn.V.x + o.y * pn.V.y + o.z * pn.V.z) / vl) * s };
    };
    canvas.save();
    canvas.clipRect(Skia.XYWHRect(c.x - 1, 0, c.w, c.h), 1, true);
    for (const layer of fc.bands) {
      if (!layer.polys.length || layer.w <= 0) continue;
      const pb = Skia.PathBuilder.Make();
      for (const poly of layer.polys) {
        if (poly.length < 3) continue;
        const p0 = toPx(poly[0]);
        pb.moveTo(p0.x, p0.y);
        for (let k = 1; k < poly.length; k++) {
          const q = toPx(poly[k]);
          pb.lineTo(q.x, q.y);
        }
        pb.close();
      }
      paint.setAlphaf(Math.min(1, layer.w));
      paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(0.01, layer.sigma), true));
      canvas.drawPath(pb.detach(), paint);
    }
    canvas.restore();
    rects[c.f * 4] = c.x;
    rects[c.f * 4 + 1] = 1;
    rects[c.f * 4 + 2] = s;
    rects[c.f * 4 + 3] = 1;
  });
  surf.flush();
  const image = keepLatest(key, surf.makeImageSnapshot());
  surf.dispose();
  return { image, rects };
}
// 면이 보이는지는 보기 각 범위 양 끝에서(굽기가 시점을 따라 다시 돌지 않게)
const LOW = camAt(VIEW_PITCH_MIN);
const HIGH = camAt(VIEW_PITCH_MAX);
export function faceKey(id: string, f: FaceId) {
  'worklet';
  return `${id}:${f}`;
}

// 책 한 권의 구울 면들(보기 각 범위에서 보일 수 있는 면만)
export function bookItems(id: string, b: Book3, env: Env | null, bx: BoxBuf, self: number): BakeItem[] {
  'worklet';
  const out: BakeItem[] = [];
  for (const f of FACES) {
    if (!faceVisible(LOW, b, f) && !faceVisible(HIGH, b, f)) continue;
    const pn = lightPanel(b.dims, f);
    const w = Math.max(1, Math.ceil(pn.w / BAKE_TEXEL));
    const h = Math.max(1, Math.ceil(pn.h / BAKE_TEXEL));
    const turn = (v: Vec3) => rot(b.roll, b.yaw, v, b.spin ?? 0, b.pitch ?? 0);
    const U = turn(pn.U);
    const V = turn(pn.V);
    out.push({ key: faceKey(id, f), O: toWorld(b, pn.O), U: { x: U.x / w, y: U.y / w, z: U.z / w }, V: { x: V.x / h, y: V.y / h, z: V.z / h }, w, h, n: turn(faceNormal(f)), env, bx, self });
  }
  return out;
}

// 책 한 권의 빛: 책 윤곽(outline, 캔버스 px) 안을 화소마다 광선으로(셰이더 bookSource가 보이는 면·속지 구멍을 찾는다).
// albedo: 장정 색(선형 RGB, 속지는 셰이더 상수), material: 장정 재질(없으면 무광 종이), atlas·id: 이 책이 있는 줄의 구운 하늘 가림(면 key = faceKey(id, 면)), env: 둘레,
// keyShadow: 이 책 면이 받는 창빛 그림자(bookKeyImage)
export function BookLight({ dims: d, state, cam, px, outline, albedo, material = 'paper', env, atlas, id, keyShadow }: {
  dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; outline: RO<SkPath>; albedo: C3; material?: BindingMaterial;
  env?: RO<Env | null>; atlas?: RO<Atlas>; id: string; keyShadow?: RO<BookKey>;
}) {
  const { bd, sp, sq } = rigOf(d);
  const pg = MAT_UNIFORMS.pages;
  const mat = { ...matOf(MAT_UNIFORMS[material], seedOf(id)), erefB: bookEref(ROUGH[material]), pR: pg.mRough, pB: pg.mBump, pG: pg.mGrain, pS: pg.mGsize };
  // 면마다 아틀라스 칸(구운 값이 없으면 0): 굽기가 바뀔 때만
  const sample = useDerivedValue<Sample>(() => {
    const a = atlas ? atlas.value : NO_ATLAS;
    return a.image ? { image: a.image, matrix: IDENTITY, live: 0 } : NO_SAMPLE;
  });
  const rects = useDerivedValue(() => {
    const a = atlas ? atlas.value : NO_ATLAS;
    const out: number[] = [];
    for (const f of FACES) {
      const r = a.image ? a.at[faceKey(id, f)] : undefined;
      if (r) out.push(r.x, r.y, r.w, r.h);
      else out.push(0, 0, 0, 0);
    }
    return out;
  });
  const uniforms = useDerivedValue<Uniforms>(() => {
    const b = state.value;
    const c = cam.value;
    const turn = (v: Vec3) => rot(b.roll, b.yaw, v, b.spin ?? 0, b.pitch ?? 0);
    const e = c.eye;
    const ev = env ? env.value : null;
    return {
      cam4: e ? [e.x, e.y, e.z, e.dist] : [c.kx, c.ky, 0, 0],
      pxa: [px.s, px.tx, px.ty],
      bO: arr(b.t),
      bX: arr(turn({ x: 1, y: 0, z: 0 })),
      bY: arr(turn({ x: 0, y: 1, z: 0 })),
      bZ: arr(turn({ x: 0, y: 0, z: 1 })),
      dims: [d.T, d.H, d.W],
      rig: [bd, sp, sq],
      rect: rects.value,
      keyOn: 1,
      albedo,
      env: envOf(ev),
      kRect: keyShadow ? keyShadow.value.rects : NO_RECTS,
      ...mat,
    };
  });
  const image = useDerivedValue(() => sample.value.image);
  const matrix = useDerivedValue(() => sample.value.matrix);
  const keyImage = useDerivedValue(() => (keyShadow ? keyShadow.value : NO_BOOK_KEY).image);
  return (
    <>
      {BOOK.map((e, i) => (
        <Path key={i} path={outline} blendMode={BLEND[i]}>
          <Shader source={e} uniforms={uniforms}>
            <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
            <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
          </Shader>
        </Path>
      ))}
    </>
  );
}

// ---------- 평면(벽·판) ----------
function edgeOf(e?: { T: Vec3; at: number }) {
  'worklet';
  return e ? [e.T.x, e.T.y, e.T.z, e.at] : NO_EDGE;
}
// 평면 위 사각형 영역: 칸 (0, 0)의 점 O, 칸 한 개의 이동 U·V(줄 공간), 칸 수 w × h, 그 평면(법선·둥근 모서리)
export type BakeArea = { O: Vec3; U: Vec3; V: Vec3; w: number; h: number; plane: Plane };
export function areaItem(key: string, a: BakeArea, env: Env | null, bx: BoxBuf, band?: [Band | null, Band | null]): BakeItem {
  'worklet';
  return { key, O: a.O, U: a.U, V: a.V, w: a.w, h: a.h, n: a.plane.n, env, bx, self: -1, band };
}

// 평면 영역(path, 캔버스 px)을 구운 하늘 가림 + 그 자리의 직접 빛·반사광으로 칠한다(albedo: 재질 색, 선형 RGB,
// eref: 그 재질의 대표 자리 빛 light-model EREF, mat: 표면 재질(ui/lighting materials), seed: 무늬 자리 어긋남).
// color가 있으면(단색 재질) 재질 색 × 빛을 한 번에 칠하고, 없으면 아래 재질 그림 위에 곱하기·닷지 두 겹으로 다시 칠한다.
// atlas·key: 구운 그림과 이 영역의 자리, matrix: 영역 칸 → 캔버스 px(칸 수 w × h를 받아)
// keyShadow: 책이 이 면에서 창빛 원반을 가리는 몫(평면 좌표 그림, PlaneKey: 벽·판 윗면)
export function BakedPlane({ path, cam, px, plane, env, atlas, akey, matrix, albedo, eref, mat, seed = [0, 0], color, keyShadow }: {
  path: RO<SkPath> | SkPath; cam: RO<Cam>; px: Affine; plane: Plane; env: Env | null; atlas?: RO<Atlas>; akey: string; matrix: (c: Cam, w: number, h: number) => number[]; albedo: C3; eref: C3; mat: MaterialName; seed?: number[]; color?: string;
  keyShadow?: RO<PlaneKey>;
}) {
  const base = color ? rgbOf(color) : null;
  const m = matOf(MAT_UNIFORMS[mat], seed);
  const keyImage = useDerivedValue(() => (keyShadow ? keyShadow.value : NO_PLANE_KEY).image);
  const sample = useDerivedValue(() => (atlas ? sampleOf(atlas.value, akey, (w, h) => matrix(cam.value, w, h)) : NO_SAMPLE));
  const uniforms = useDerivedValue<Uniforms>(() => {
    const c = cam.value;
    return {
      ...BASE,
      ...planeFrame(c, px, plane),
      tN: arr(plane.n),
      bev0: edgeOf(plane.edges?.[0]),
      bev1: edgeOf(plane.edges?.[1]),
      cam4: camOf(c, plane.O),
      env: envOf(env),
      albedo,
      eref,
      liveEnv: sample.value.live,
      ...keyMapOf(keyShadow ? keyShadow.value : NO_PLANE_KEY),
      ...m,
      ...(base ? { base } : null),
    };
  });
  if (base) return <Direct path={path} uniforms={uniforms} sample={sample} keyImage={keyImage} />;
  return <Relit path={path} fx={LIT} uniforms={uniforms} sample={sample} keyImage={keyImage} />;
}
function Direct({ path, uniforms, sample, keyImage }: { path: RO<SkPath> | SkPath; uniforms: RO<Uniforms>; sample: RO<Sample>; keyImage: RO<SkImage> }) {
  const image = useDerivedValue(() => sample.value.image);
  const matrix = useDerivedValue(() => sample.value.matrix);
  return (
    <Path path={path}>
      <Shader source={LIT_DIRECT} uniforms={uniforms}>
        <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
        <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
      </Shader>
    </Path>
  );
}
// '#rrggbb' → 감마 sRGB 0~1
function rgbOf(hex: string) {
  const v = parseInt(hex.slice(1, 7), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ---------- 갈피(종이 탭) ----------
// 탭 모양(path, 탭 그림 좌표) 안을 화소마다 같은 빛 모델로(셰이더 tabSource). 탭 그림과 같은 Group(뿌리로 옮기고 책 기울기만큼 돌림) 안에 그린다.
// 하늘 가림은 탭 가운데 한 점의 값(loss), 재질은 무광 종이(무늬 자리는 책마다)
export type TabFrame = { root: Vec3; axR: Vec3; axU: Vec3; n: Vec3; loss: C3; cam4: number[]; env: Env | null };
export function TabLight({ path, frame, albedo, s, seed }: { path: SkPath; frame: RO<TabFrame>; albedo: C3; s: number; seed: number[] }) {
  const mat = matOf(MAT_UNIFORMS.paper, seed);
  const uniforms = useDerivedValue<Uniforms>(() => {
    const f = frame.value;
    return { pxa: [s, 0, 0], root: arr(f.root), axR: arr(f.axR), axU: arr(f.axU), nrm: arr(f.n), loss: f.loss, cam4: f.cam4, keyOn: 1, albedo, eref: bookEref(ROUGH.paper), env: envOf(f.env), ...mat };
  });
  return (
    <>
      {TAB.map((e, i) => (
        <Path key={i} path={path} blendMode={BLEND[i]}>
          <Shader source={e} uniforms={uniforms} />
        </Path>
      ))}
    </>
  );
}
