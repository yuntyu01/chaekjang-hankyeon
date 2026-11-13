// 화소마다의 빛(셰이더 소스 ui/scene-light-sksl, 식은 domain/light-model과 같다). 책 면·선반 판·벽이 모두 이것 하나로 밝기를 얻는다.
// 그림(재질 색 = 그 재질의 대표 자리 빛 EREF에서 보이는 색) 위에 다시 칠하는 방식은 둘:
//   곱하기(받는 빛 비 ≤ 1) · 컬러 닷지(> 1인 밝아짐 + 반사광). 감마(2.2)를 고려해 선형 빛 공간의 곱·합과 같게 하고,
//   채널마다 다르다(되비친 빛이 둘레 면 색을 띤다). 단색 재질(벽)은 재질 색 × 빛을 한 번에 칠한다.
// 무거운 몫은 하늘 가림(둘레·책 상자가 가린 하늘, 시점과 상관없다)이다. 줄마다 그 줄의 모든 면(벽·판·책 면)을 그림 한 장(아틀라스)에
// 면 좌표로 굽고(bakeAtlas: 줄의 책이 멈췄을 때만, BAKE_TEXEL 간격) 그리는 프레임에는 그 그림을 읽은 뒤 나머지
// (하늘·창빛 직접 몫은 둥근 모서리 법선까지, 반사광)만 화소마다 계산한다. 책은 한 권에 한 번(BookLight: 셰이더가 화소마다 광선으로
// 보이는 면을 찾는다), 벽·판은 평면마다(BakedPlane).
// 구운 값이 없는 면(줄 밖에서 움직이는 책, 막 들어온 책)은 둘레가 가린 하늘만 그 자리에서 계산한다(다른 책은 뺀다).
import { AlphaType, BlurStyle, ColorType, FilterMode, ImageShader, MipmapMode, Path, processUniforms, Shader, Skia, TileMode, type SkCanvas, type SkImage, type SkPaint, type SkPath, type SkRuntimeEffect, type SkShader, type SkSurface, type Uniforms } from '@shopify/react-native-skia';
import { useRef } from 'react';
import { Platform } from 'react-native';
import { isSharedValue, makeMutable, useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { faceNormal, rot, toWorld, type Book3, type Cam, type FaceId, type Vec3 } from '@/domain/book3';
import { lightPanel, rigOf } from '@/domain/book-parts';
import { camAt, VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Affine } from '@/domain/camera';
import { bookEref, bookSref, ENV_NX, ENV_NY, GRID_N, GRID_PASSES, lightSet, NO_BOXES, SPEC_K, SREF, type BoxBuf, type C3, type Env } from '@/domain/light-model';
import type { Recv3 } from '@/domain/received3';
import { MAT_UNIFORMS, type MatUniforms } from '@/domain/surface-pattern';
import type { BookSurface } from '@/domain/types';
import { materials, type MaterialName, type SurfaceMaterial } from '@/ui/lighting';
import { faceVisible } from '@/ui/book3d/face-geometry';

import { PERF_ENABLED } from './perf';
import { bakeHash, cachedBake, isCurrentBake, pinBake, putBake, saveBake, unpinBakes } from './bake-cache';
import { lightAllSV, lightOpenSV, takeLightSlot } from './light-stage';
import { keepLatest } from './retained-images';
export { keepLatest } from './retained-images';
import { bakeSource, bookSource, gridSource, litSource, passOf, planeFrame, tabSource, type Plane } from './scene-light-sksl';

export type { Plane } from './scene-light-sksl';
type RO<T> = Readonly<SharedValue<T>>;

const make = (src: string) => {
  const e = Skia.RuntimeEffect.Make(src);
  if (!e) throw new Error('SceneLight shader failed to compile');
  return e;
};
const BAKE_SRC = bakeSource();
const GRID_SRC = gridSource();
const BAKE = make(BAKE_SRC);
const GRID = make(GRID_SRC);
// 측정 번들: 실기기에서 굽기 셰이더 변형을 빌드 없이 재려고 바꿔 끼운 셰이더(overrideBakeShaders). 배포본은 늘 BAKE·GRID
function gridEffect(): SkRuntimeEffect {
  'worklet';
  return (globalThis as { __lightGrid?: SkRuntimeEffect }).__lightGrid ?? GRID;
}
function bakeEffect(): SkRuntimeEffect {
  'worklet';
  return (globalThis as { __lightBake?: SkRuntimeEffect }).__lightBake ?? BAKE;
}
function overridden() {
  'worklet';
  return !!(globalThis as { __lightBake?: SkRuntimeEffect }).__lightBake;
}
// 측정 번들: 빛 격자·굽기 셰이더를 바꿔 끼운다(UI 스레드에 심는다). 첫 굽기보다 먼저 불러야 한다
export function overrideBakeShaders(grid: string, bake: string) {
  if (!PERF_ENABLED) return;
  const g = make(grid);
  const b = make(bake);
  scheduleOnUI(() => {
    'worklet';
    (globalThis as { __lightGrid?: SkRuntimeEffect }).__lightGrid = g;
    (globalThis as { __lightBake?: SkRuntimeEffect }).__lightBake = b;
  });
}
// 평면(벽·판)·책·갈피 탭: 프로그램은 하나씩이고 겹(곱하기·컬러 닷지·한 번에·반사광 더하기)은 uniform으로 고른다(passOf).
// 겹마다 셰이더를 따로 두면 첫 실행 GPU 컴파일이 그만큼 늘었다(2026-11-12 새로 설치한 S23에서 시작 화면 1분+)
const LIT = make(litSource());
const BOOK = make(bookSource());
const TAB = make(tabSource());
const BLEND = ['multiply', 'colorDodge', 'plus'] as const;
// 겹 uniform: plain 곱하기·닷지, art 그림 표지 책(곱하기·닷지는 확산 몫만, 반사광은 더하기 겹: 어두운 그림 위에도 반사광이 보이게),
// direct 단색 재질(벽)을 재질 색 × 빛으로 한 번에(대상 색을 읽는 겹치기가 없다)
type PassKind = 'plain' | 'art' | 'direct';
const PASSES: Record<PassKind, ReturnType<typeof passOf>[]> = {
  plain: [passOf(false), passOf(true)],
  art: [passOf(false, true), passOf(true, true), passOf('spec')],
  direct: [passOf('direct')],
};
const NO_PASS: Uniforms = {};
// 겹마다 uniform 객체(같은 값 + DODGE·SPLIT). 겹 수가 바뀌어도 훅 수는 같게 셋을 둔다. base는 겹 2만 읽지만 선언돼 있어 늘 넣는다
function usePasses(uniforms: RO<Uniforms>, kind: PassKind): RO<Uniforms>[] {
  const list = PASSES[kind];
  const a = useDerivedValue<Uniforms>(() => ({ base: ZERO3, ...uniforms.value, ...list[0] }), [list]);
  const b = useDerivedValue<Uniforms>(() => (list.length > 1 ? { base: ZERO3, ...uniforms.value, ...list[1] } : NO_PASS), [list]);
  const c = useDerivedValue<Uniforms>(() => (list.length > 2 ? { base: ZERO3, ...uniforms.value, ...list[2] } : NO_PASS), [list]);
  return [a, b, c].slice(0, list.length);
}
// 첫 화면 빛(ui/light-stage): 겹마다 처음 그려지는 차례 번호를 받고, 그 번호가 열리기 전에는 빈 경로(Skia가 그리기를 건너뛰어
// 그 셰이더·도형 방식을 아직 컴파일하지 않는다). 시작 화면이 걷힌 뒤에는 그대로 넘긴다. 겹 수(n, 많아야 셋)만큼 번호를 받는다
const NO_PATH = Skia.Path.Make();
// heavy: 아직 구운 값이 없어 그 자리에서 둘레 가림을 화소마다 계산해야 하는 면(무거운 실시간 계산). 시작 화면 동안에는 굽기가 끝날 때까지 기다린다:
// S23(Adreno)에서 줄 하나를 그렇게 한꺼번에 칠하면 GPU를 몇 초씩 붙잡아 드라이버가 앱을 죽였다(2026-11-13). 기다리는 겹은 시작 화면이 걷히지 않게 알린다(__lightGated)
// all·openTo: lightAllSV·lightOpenSV 값. 부르는 파생 값이 직접 읽어 넘긴다(Reanimated는 파생 값 워클릿이 직접 읽는 공유 값만 지켜본다:
// 이 함수 안에서 읽으면 번호가 열려도 다시 계산되지 않아, 구운 그림이 처음부터 있는 줄(담아 둔 그림)의 빛 겹이 끝내 그려지지 않았다)
function gatePath(slot: number, path: SkPath, heavy: boolean, all: boolean, openTo: number): SkPath {
  'worklet';
  if (all) return path;
  const open = openTo >= slot;
  const blocked = open && heavy;
  const g = globalThis as { __lightGated?: Record<number, boolean> };
  const m = g.__lightGated ?? (g.__lightGated = {});
  if (blocked) m[slot] = true;
  else delete m[slot];
  return open && !blocked ? path : NO_PATH;
}
function useStagedPaths(path: RO<SkPath> | SkPath, n: number, heavy?: RO<boolean>): RO<SkPath>[] {
  const slots = useRef<number[] | null>(null);
  if (!slots.current) slots.current = [0, 1, 2].map((i) => (i < n ? takeLightSlot() : 0));
  const [s0, s1, s2] = slots.current;
  const sv = isSharedValue(path) ? (path as RO<SkPath>) : null;
  const fixed = sv ? null : (path as SkPath);
  const a = useDerivedValue(() => gatePath(s0, sv ? sv.value : fixed!, !!heavy && heavy.value, lightAllSV.value, lightOpenSV.value), [sv, fixed, s0, heavy]);
  const b = useDerivedValue(() => gatePath(s1, sv ? sv.value : fixed!, !!heavy && heavy.value, lightAllSV.value, lightOpenSV.value), [sv, fixed, s1, heavy]);
  const c = useDerivedValue(() => gatePath(s2, sv ? sv.value : fixed!, !!heavy && heavy.value, lightAllSV.value, lightOpenSV.value), [sv, fixed, s2, heavy]);
  return [a, b, c];
}

const ZERO3 = [0, 0, 0];
const NO_EDGE = [0, 0, 0, 1e9];
const NO_RIM = [1, 0, 0, 0];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const BASE = {
  O: ZERO3,
  Ux: ZERO3,
  Vy: ZERO3,
  Hw: [0, 0, 1],
  tN: [0, 0, -1],
  bev0: NO_EDGE,
  bev1: NO_EDGE,
  endR: 0,
  rim: NO_RIM,
  rimCeil: 1e9,
  kS: 1,
  softBox: [0, 0, 0, 0],
  softR: [0, 0],
  cam4: [0, 0, 0, 0],
  env: ZERO3,
  keyOn: 1,
  albedo: [1, 1, 1],
  eref: [1, 1, 1],
  sref: [0, 0, 0],
  liveEnv: 1,
  mixT: 1,
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
  // x: 0 둘레 없음, 1 판만, 2 틀 옆판까지
  return env ? [env.side ? 2 : 1, env.floor, env.ceil] : ZERO3;
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
export type BakeItem = { key: string; O: Vec3; U: Vec3; V: Vec3; w: number; h: number; n: Vec3; env: Env | null; bx: BoxBuf; self: number };
// 구운 그림과 면마다 칸 (0, 0)의 자리·칸 수. 면 둘레에 한 칸씩 더 구워 둔다(겹선형 읽기가 옆 면으로 새지 않게, 값은 면 가장자리 칸 그대로)
// prev·mix: 책이 움직이는 동안 앞 굽기(움직이기 전 자리)와 새 굽기의 몫(mix, 0 → 1). 셰이더가 둘을 섞는다
// pending: 아직 굽는 중(bakeAtlas가 일감을 넣었다. 끝나면 bakeDoneSV가 오른다)
export type Atlas = { image: SkImage | null; at: Record<string, { x: number; y: number; w: number; h: number }>; prev?: Atlas | null; mix?: number; pending?: boolean };
export const NO_ATLAS: Atlas = { image: null, at: {} };
export const PENDING_ATLAS: Atlas = { image: null, at: {}, pending: true };
const GUTTER = 1;
const ATLAS_W = 512;

// 구운 그림의 칸 값이 화면에 그릴 때 색 변환되지 않게 화면 표면과 같은 색 공간에 굽는다
// (안드로이드 화면·화면 밖 표면은 둘 다 색 공간 없음, iOS 화면은 Display P3)
const BAKE_SURFACE = Platform.OS === 'ios' ? { colorSpace: 'display-p3' as const } : undefined;
// 측정 번들: 굽기마다 칸 수·걸린 시간(GPU가 끝날 때까지 1화소 읽어 기다린다)
const BAKE_STAT = PERF_ENABLED;

// 셰이더 자식 자리를 채우는 그림(구운 값이 없을 때. 그때 셰이더는 그림을 읽지 않는다)
const EMPTY = Skia.Image.MakeImage(
  { width: 1, height: 1, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
  Skia.Data.fromBytes(new Uint8Array([128, 128, 128, 255])),
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

// ---------- 나눠 굽기(2026-11-13) ----------
// 굽기(빛 격자 GRID_PASSES번 + 면마다 하늘 가림)는 줄 하나에 GPU를 길게 쓴다(S23: 몇 초). 한 번에 그리면 그동안 화면이 멈추고(굽기와 화면이 같은 GPU·UI 스레드)
// 여러 줄이 겹치면 앱이 죽었다. 그래서 굽기를 일감으로 줄 세우고, 프레임마다 FRAME_MS만큼만 조각(칸 몇 개~줄 몇 개)을 그린다. 조각을 그린 뒤 1화소를 읽어
// GPU가 끝나기를 기다리고 걸린 시간으로 다음 조각 크기를 정한다(기기 속도에 맞춘다). 조각은 정수 칸 사각형이라 한 번에 그린 것과 화소가 같다.
// 빠른 기기는 INLINE_MS 안에 끝날 것으로 보이면 부른 자리에서 다 굽는다(이전과 같은 프레임에 나온다).
// 끝나면 그림을 bake-cache 모음에 넣고 bakeDoneSV를 올린다: 기다리던 줄(useFadingAtlas)이 다시 물어 그림을 받는다
export const bakeDoneSV = makeMutable(0);
const FRAME_MS = 10;
const BATCH_MS = 8;
const INLINE_MS = 40;
// 묶음 크기의 아래 한계: 빛 격자·면 굽기를 각각 많아야 이만큼의 묶음으로 끝낸다(시간을 잘못 재도 굽기가 끝없이 늘어지지 않게)
const MAX_BATCHES = 300;
const PIXEL = { width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 };

type Cursor = { x: number; y: number };
type Piece = { x: number; y: number; w: number; h: number };
// W×H 칸 사각형에서 다음 조각(n칸쯤): 한 줄보다 작으면 줄의 일부, 아니면 줄 여러 개. 다 그렸으면 c.y >= H
function nextPiece(c: Cursor, W: number, H: number, n: number): Piece {
  'worklet';
  if (c.x > 0 || n < W) {
    const w = Math.min(W - c.x, Math.max(1, Math.floor(n)));
    const p = { x: c.x, y: c.y, w, h: 1 };
    c.x += w;
    if (c.x >= W) {
      c.x = 0;
      c.y += 1;
    }
    return p;
  }
  const h = Math.min(H - c.y, Math.max(1, Math.floor(n / W)));
  const p = { x: 0, y: c.y, w: W, h };
  c.y += h;
  return p;
}

// 기기 속도: 묶음 하나(GPU를 한 번 기다리는 단위, BATCH_MS쯤)에 그릴 양. 단위는 칸 수 × 무게(상자 수 + 2: 칸 하나의 계산은 상자 수와 함께 는다).
// 빛 격자와 굽기를 따로 잰다(0 = 아직 모름: START부터). 작은 면 여러 개는 한 묶음에 이어 그린다(면마다 GPU를 기다리면 기다리는 시간이 더 든다)
// over: GPU를 기다리는 것 자체에 드는 시간(그린 양과 상관없이 붙는 몫: 에뮬레이터 8ms쯤). 지금까지 가장 짧았던 묶음의 시간으로 어림한다
// (처음에는 작은 묶음부터 키우므로 그때 드러난다). 이 시간을 빼지 않으면 묶음이 작은 채로 머물러 기다리는 시간만 쌓인다
type Speed = { grid: number; bake: number; over: number };
const START = 128;
function speedOf(): Speed {
  'worklet';
  const g = globalThis as { __bakeSpeed?: Speed };
  return g.__bakeSpeed ?? (g.__bakeSpeed = { grid: 0, bake: 0, over: 1e9 });
}
// 묶음을 그린 뒤 다음 묶음 크기: 그리는 데 든 시간(work: 걸린 시간 − over)이 BATCH_MS가 되게 한 번에 1/4~2배.
// 묶음이 다 차지 않았으면(일이 먼저 끝났다) 느렸을 때만 줄인다
function tune(budget: number, drawn: number, work: number): number {
  'worklet';
  const k = Math.max(0.25, Math.min(2, BATCH_MS / Math.max(work, 0.25)));
  if (drawn >= budget * 0.9) return budget * k;
  return k < 1 ? Math.max(drawn * k, 1) : budget;
}

// 빛 격자(light-model solveGrid)를 GPU로: 줄 둘레·상자 목록 하나에 그림 한 장(scene-light-sksl GRID_SCALE 칸 배치).
// GRID_PASSES번 되풀이: 같은 표면에 다시 그리며 지난 그림(스냅숏)을 읽는다(첫 번은 가리개를 가림 없는 받는 빛으로)
type GridRun = { key: string; env: Env; bx: BoxBuf; W: number; H: number; surf: SkSurface; canvas: SkCanvas; paint: SkPaint; pass: number; cur: Cursor; armed: boolean; img: SkImage | null; prev: SkImage[] };
function gridKeyOf(env: Env, bx: BoxBuf): string {
  'worklet';
  return `${env.floor},${env.ceil}|${bx.v.slice(0, bx.list.length * 32).join(',')}`;
}
function gridSizeOf(bx: BoxBuf) {
  'worklet';
  return { W: 6 * GRID_N, H: bx.list.length * GRID_N + 3 * ENV_NY };
}
function startGrid(env: Env, bx: BoxBuf, W: number, H: number): GridRun | null {
  'worklet';
  const surf = Skia.Surface.MakeOffscreen(W, H, BAKE_SURFACE);
  if (!surf) return null;
  return { key: gridKeyOf(env, bx), env, bx, W, H, surf, canvas: surf.getCanvas(), paint: Skia.Paint(), pass: 0, cur: { x: 0, y: 0 }, armed: false, img: null, prev: [] };
}
// 표면과 지난 스냅숏을 놓아준다(keep: 마지막 그림은 남긴다)
function endGrid(run: GridRun, keep: boolean) {
  'worklet';
  for (const p of run.prev) if (!keep || p !== run.img) p.dispose();
  run.prev = [];
  if (!keep) run.img = null;
  run.surf.dispose();
}

// 조각 하나(n칸쯤)를 그린다(GPU는 기다리지 않는다). 그린 칸 수. 한 번을 다 그리면 스냅숏을 뜨고 다음 번으로(다 끝났으면 run.pass === GRID_PASSES, 결과는 run.img)
function drawGrid(run: GridRun, n: number): number {
  'worklet';
  if (!run.armed) {
    const nBox = run.bx.list.length;
    const u = { ...lightSet().u, env: envOf(run.env), box: run.bx.v, nBox, gridOn: run.img ? 1 : 0, gridNx: nBox || run.env.side ? ENV_NX : 1 };
    const gridFx = gridEffect();
    run.paint.setShader(gridFx.makeShaderWithChildren(processUniforms(gridFx, u), [linearShader(run.img ?? EMPTY)]));
    run.armed = true;
  }
  const p = nextPiece(run.cur, run.W, run.H, n);
  run.canvas.drawRect(Skia.XYWHRect(p.x, p.y, p.w, p.h), run.paint);
  if (run.cur.y >= run.H) {
    // 스냅숏은 표면을 다시 그리기 전에 떠 둔다(다음 번이 이 그림을 읽는다)
    const next = run.surf.makeImageSnapshot();
    run.prev.push(next);
    run.img = next;
    run.pass += 1;
    run.cur = { x: 0, y: 0 };
    run.armed = false;
  }
  return p.w * p.h;
}
// 그린 것을 GPU가 끝낼 때까지 기다린다(1화소 읽기)
function waitGpu(surf: SkSurface, canvas: SkCanvas) {
  'worklet';
  surf.flush();
  canvas.readPixels(0, 0, PIXEL);
}

// 푼 빛 격자 그림을 둘레·상자 값이 같으면 다시 쓴다(머리글 벽과 맨 윗줄은 같은 책 상자다). 최근 GRID_KEEP장만 두고 나머지는 놓아준다
// (그림은 굽는 동안에만 읽는다. 굽고 있는 일감이 쓰는 그림은 놓아주지 않는다)
const GRID_KEEP = 6;
type GridStore = { __grids?: { key: string; img: SkImage | null }[] };
function findGrid(key: string): { img: SkImage | null } | null {
  'worklet';
  const list = (globalThis as GridStore).__grids;
  if (!list) return null;
  const i = list.findIndex((e) => e.key === key);
  if (i < 0) return null;
  const e = list.splice(i, 1)[0];
  list.push(e);
  return e;
}
function storeGrid(key: string, img: SkImage | null, busy: (SkImage | null)[]) {
  'worklet';
  const g = globalThis as GridStore;
  const list = g.__grids ?? (g.__grids = []);
  list.push({ key, img });
  for (let i = 0; i < list.length && list.length > GRID_KEEP; ) {
    if (busy.indexOf(list[i].img) >= 0) i++;
    else list.splice(i, 1)[0].img?.dispose();
  }
}

// 미리 굽기(warmLight)의 그림 열쇠
const WARM_KEY = 'light-warm';

// 굽기 결과를 정하는 값 전부(bake-cache 열쇠): 셰이더 소스·되풀이 수·표면, 아틀라스 크기와 면마다 자리·칸·법선·둘레·제 책, 상자 목록, 맞추기 값
const LIGHT_REV = bakeHash(`${BAKE_SRC}|${GRID_SRC}|${GRID_PASSES}|${ENV_NX}|${Platform.OS}`);
function bakeKeyOf(items: BakeItem[], at: Atlas['at'], W: number, H: number, cal: Record<string, unknown>): string {
  'worklet';
  const v = (p: Vec3) => `${p.x},${p.y},${p.z}`;
  let s = `${LIGHT_REV}|${W}x${H}`;
  let lastBx: BoxBuf | null = null;
  for (const it of items) {
    const r = at[it.key];
    s += `|${r.x},${r.y}:${v(it.O)};${v(it.U)};${v(it.V)};${it.w}x${it.h};${v(it.n)};${it.self};`;
    s += it.env ? `${it.env.floor},${it.env.ceil},${it.env.side ? 1 : 0}` : '-';
    if (it.bx !== lastBx) {
      lastBx = it.bx;
      s += `;b${it.bx.list.length}:${it.bx.v.slice(0, it.bx.list.length * 32).join(',')}`;
    }
  }
  for (const k of Object.keys(cal).sort()) s += `|${k}=${String(cal[k])}`;
  return s;
}
// 새로 구운 그림을 담는다. 그림을 읽어 내는(CPU로) 일은 시작 화면이 걷히고 새 굽기가 2초 없을 때 한 프레임에 하나씩 해서 JS로 넘긴다.
// 그때 어느 줄도 쓰지 않는 그림(끄는 동안 지나간 배치)은 담지 않는다
type SaveJob = { name: string; image: SkImage };
type SaveQueue = { __bakeSaves?: SaveJob[]; __bakeAt?: number; __bakeLoop?: boolean };
function queueSave(name: string, image: SkImage) {
  'worklet';
  const g = globalThis as SaveQueue;
  (g.__bakeSaves ?? (g.__bakeSaves = [])).push({ name, image });
  g.__bakeAt = performance.now();
  if (g.__bakeLoop) return;
  g.__bakeLoop = true;
  const tick = () => {
    const list = g.__bakeSaves ?? [];
    if (!list.length) {
      g.__bakeLoop = false;
      return;
    }
    if (lightAllSV.value && performance.now() - (g.__bakeAt ?? 0) > 2000) {
      const job = list.shift()!;
      if (isCurrentBake(job.name, job.image)) {
        const cpu = job.image.makeNonTextureImage();
        if (cpu) scheduleOnRN(saveBake, job.name, cpu);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// 면 하나를 굽는 셰이더(빛 격자 그림 g를 읽는다)
function itemShader(it: BakeItem, g: SkImage | null, cal: Record<string, unknown>): SkShader {
  'worklet';
  const u = {
    ...cal,
    O: arr(it.O), Ux: arr(it.U), Vy: arr(it.V), tN: arr(it.n), cells: [it.w, it.h], env: envOf(it.env), box: it.bx.v, nBox: it.bx.list.length, selfIdx: it.self,
    gridOn: g ? 1 : 0, gridNx: it.bx.list.length || it.env?.side ? ENV_NX : 1,
  };
  const bakeFx = bakeEffect();
  return bakeFx.makeShaderWithChildren(processUniforms(bakeFx, u as Uniforms), [linearShader(g ?? EMPTY)]);
}

// 굽기 일감 하나(줄 아틀라스 한 장). keys: 이 그림을 기다리는 줄들(같은 값의 줄은 일감 하나를 같이 쓴다).
// needs: 줄 둘레·상자 목록마다 빛 격자 한 장(가리개 면 밝기), gi: 면마다 쓰는 빛 격자 번호(둘레 없는 면은 −1)
type Need = { env: Env; bx: BoxBuf; img: SkImage | null };
type BakeJob = {
  keys: string[]; name: string; save: boolean; items: BakeItem[]; at: Atlas['at']; W: number; H: number; cal: Record<string, unknown>;
  needs: Need[]; gi: number[]; ni: number; grid: GridRun | null;
  surf: SkSurface | null; canvas: SkCanvas | null; paint: SkPaint | null;
  ii: number; cur: Cursor; armed: boolean;
  // cells: 면 전체의 칸 수 × 무게(묶음 크기의 아래 한계를 정한다)
  failed: boolean; t0: number; work: number; gridWork: number; batches: number; cells: number;
};
type JobStore = { __bakeJobs?: BakeJob[]; __bakeRun?: boolean; __bakeFailed?: Record<string, string> };
function makeJob(key: string, name: string, save: boolean, items: BakeItem[], at: Atlas['at'], W: number, H: number, cal: Record<string, unknown>): BakeJob {
  'worklet';
  const needs: Need[] = [];
  const gi = items.map((it) => {
    const env = it.env;
    if (!env) return -1;
    const i = needs.findIndex((n) => n.bx === it.bx && n.env.floor === env.floor && n.env.ceil === env.ceil);
    if (i >= 0) return i;
    needs.push({ env, bx: it.bx, img: null });
    return needs.length - 1;
  });
  let cells = 0;
  for (const it of items) cells += (it.w + 2 * GUTTER) * (it.h + 2 * GUTTER) * (it.bx.list.length + 2);
  return { keys: [key], name, save, items, at, W, H, cal, needs, gi, ni: 0, grid: null, surf: null, canvas: null, paint: null, ii: 0, cur: { x: 0, y: 0 }, armed: false, failed: false, t0: performance.now(), work: 0, gridWork: 0, batches: 0, cells };
}
// 이 일감을 다 굽는 데 걸릴 시간 어림(ms, 지금까지 잰 속도로. 아직 모르는 몫은 0)
function estimateMs(job: BakeJob): number {
  'worklet';
  const sp = speedOf();
  let ms = 0;
  if (sp.grid > 0) {
    for (const n of job.needs) {
      if (findGrid(gridKeyOf(n.env, n.bx))) continue;
      const s = gridSizeOf(n.bx);
      ms += ((GRID_PASSES * s.W * s.H * (n.bx.list.length + 2)) / sp.grid) * BATCH_MS;
    }
  }
  if (sp.bake > 0) for (const it of job.items) ms += (((it.w + 2 * GUTTER) * (it.h + 2 * GUTTER) * (it.bx.list.length + 2)) / sp.bake) * BATCH_MS;
  return ms;
}
// until(시각)까지 묶음을 그린다. 다 구웠으면(또는 표면을 못 만들었으면) true. boost: 묶음을 이만큼 크게(부른 자리에서 다 구워 볼 때: 기다리는 횟수를 줄인다. 속도는 고치지 않는다)
function stepJob(job: BakeJob, until: number, boost: number): boolean {
  'worklet';
  if (!job.surf) {
    job.surf = Skia.Surface.MakeOffscreen(job.W, job.H, BAKE_SURFACE);
    if (!job.surf) {
      job.failed = true;
      return true;
    }
    job.canvas = job.surf.getCanvas();
    job.paint = Skia.Paint();
  }
  const sp = speedOf();
  for (;;) {
    const t0 = performance.now();
    let t = t0;
    if (job.ni < job.needs.length) {
      // 빛 격자
      const need = job.needs[job.ni];
      if (!job.grid) {
        const hit = findGrid(gridKeyOf(need.env, need.bx));
        const s = gridSizeOf(need.bx);
        const made = hit ? null : startGrid(need.env, need.bx, s.W, s.H);
        if (!made) {
          need.img = hit ? hit.img : null;
          job.ni += 1;
          continue;
        }
        job.grid = made;
      }
      const run = job.grid;
      const weight = need.bx.list.length + 2;
      // 먼저 밀린 GPU 일(화면 프레임)을 기다린다: 그래야 이 묶음에 든 시간만 잰다(같이 재면 묶음이 작은 채로 머문다)
      waitGpu(run.surf, run.canvas);
      t = performance.now();
      const budget = Math.max(sp.grid > 0 ? sp.grid : START, (GRID_PASSES * run.W * run.H * weight) / MAX_BATCHES) * boost;
      let drawn = 0;
      while (drawn < budget && run.pass < GRID_PASSES) drawn += drawGrid(run, (budget - drawn) / weight) * weight;
      waitGpu(run.surf, run.canvas);
      const ms = performance.now() - t;
      if (ms < sp.over) sp.over = ms;
      if (boost === 1) sp.grid = tune(budget, drawn, ms - sp.over);
      job.gridWork += ms;
      if (run.pass >= GRID_PASSES) {
        endGrid(run, true);
        need.img = run.img;
        storeGrid(run.key, run.img, job.needs.map((n) => n.img));
        job.grid = null;
        job.ni += 1;
      }
    } else if (job.ii < job.items.length) {
      // 면(작은 면은 한 묶음에 여러 개)
      const canvas = job.canvas!;
      const paint = job.paint!;
      waitGpu(job.surf, canvas);
      t = performance.now();
      const budget = Math.max(sp.bake > 0 ? sp.bake : START, job.cells / MAX_BATCHES) * boost;
      let drawn = 0;
      while (drawn < budget && job.ii < job.items.length) {
        const it = job.items[job.ii];
        const r = job.at[it.key];
        const PW = it.w + 2 * GUTTER;
        const PH = it.h + 2 * GUTTER;
        if (!job.armed) {
          const gi = job.gi[job.ii];
          paint.setShader(itemShader(it, gi >= 0 ? job.needs[gi].img : null, job.cal));
          job.cur = { x: 0, y: 0 };
          job.armed = true;
        }
        const weight = it.bx.list.length + 2;
        const p = nextPiece(job.cur, PW, PH, (budget - drawn) / weight);
        canvas.save();
        canvas.translate(r.x, r.y);
        canvas.drawRect(Skia.XYWHRect(p.x - GUTTER, p.y - GUTTER, p.w, p.h), paint);
        canvas.restore();
        drawn += p.w * p.h * weight;
        if (job.cur.y >= PH) {
          job.ii += 1;
          job.armed = false;
        }
      }
      waitGpu(job.surf, canvas);
      const ms = performance.now() - t;
      if (ms < sp.over) sp.over = ms;
      if (boost === 1) sp.bake = tune(budget, drawn, ms - sp.over);
    } else {
      return true;
    }
    job.work += performance.now() - t0;
    job.batches += 1;
    if (performance.now() >= until) return false;
  }
}
// 다 구운 일감: 그림을 떠서 모음에 넣는다(기다리던 줄은 bakeAtlas를 다시 불러 받는다). 못 구웠으면 null
function finishJob(job: BakeJob): SkImage | null {
  'worklet';
  const g = globalThis as JobStore;
  if (job.failed || !job.surf) {
    const failed = g.__bakeFailed ?? (g.__bakeFailed = {});
    for (const k of job.keys) failed[k] = job.name;
    return null;
  }
  job.surf.flush();
  const image = job.surf.makeImageSnapshot();
  job.surf.dispose();
  job.surf = null;
  putBake(job.name, image);
  for (const k of job.keys) pinBake(k, image);
  if (job.save) queueSave(job.name, image);
  if (BAKE_STAT) console.log('[bake]', job.items.length, 'items', `${job.W}x${job.H}`, 'ms', job.work.toFixed(1), 'grid', job.needs.length, job.gridWork.toFixed(1), 'batches', job.batches, 'over', speedOf().over.toFixed(1), 'wall', (performance.now() - job.t0).toFixed(0));
  return image;
}
// 굽다 만 일감(기다리는 줄이 없어졌다): 표면을 놓아준다
function cancelJob(job: BakeJob) {
  'worklet';
  if (job.grid) endGrid(job.grid, false);
  job.grid = null;
  job.surf?.dispose();
  job.surf = null;
}
// 줄(key)이 기다리던 일감에서 빠진다(name: 이 이름의 일감은 그대로 기다린다). 기다리는 줄이 없어진 일감은 버린다
function leaveJobs(key: string, name: string | null) {
  'worklet';
  const q = (globalThis as JobStore).__bakeJobs;
  if (!q) return;
  for (let i = q.length - 1; i >= 0; i--) {
    const j = q[i];
    if (j.name === name) continue;
    const k = j.keys.indexOf(key);
    if (k < 0) continue;
    j.keys.splice(k, 1);
    if (!j.keys.length) cancelJob(q.splice(i, 1)[0]);
  }
}
// 프레임마다 FRAME_MS만큼 일감을 굽는다(일감이 없으면 멈추고, 새 일감이 오면 다시 돈다)
function startBakeLoop() {
  'worklet';
  const g = globalThis as JobStore;
  if (g.__bakeRun) return;
  g.__bakeRun = true;
  const tick = () => {
    const q = g.__bakeJobs ?? [];
    if (!q.length) {
      g.__bakeRun = false;
      return;
    }
    const until = performance.now() + FRAME_MS;
    let done = false;
    while (q.length && performance.now() < until) {
      const job = q[0];
      if (!stepJob(job, until, 1)) break;
      // 그리는 사이 버려졌으면(q에서 빠졌다) 넘어간다
      if (q[0] === job) {
        q.shift();
        finishJob(job);
        done = true;
      }
    }
    if (done) bakeDoneSV.value = bakeDoneSV.value + 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// 줄이 사라졌다: 기다리던 일감에서 빠지고 그 줄이 쓰던 그림 표시를 지운다
export function releaseBake(key: string) {
  'worklet';
  leaveJobs(key, null);
  const failed = (globalThis as JobStore).__bakeFailed;
  if (failed) delete failed[key];
  unpinBakes(key);
}

// 줄 아틀라스: 구울 면들을 그림 한 장에 놓고 굽는다. 같은 값으로 구운 그림이 있으면(이번 실행에 구웠거나 지난 실행에 담아 둔 것, bake-cache) 그것을,
// 없으면 일감을 넣고 PENDING_ATLAS(굽는 중)를 돌려준다. key: 줄(부르는 곳)마다 하나(같은 줄을 다른 배치로 다시 부르면 앞 일감은 버린다)
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
  const cal = lightSet().u as Record<string, unknown>; // 맞추기 값(스킨마다)
  // 측정용으로 바꿔 끼운 셰이더로 구운 그림은 이름을 달리하고 담지 않는다
  const swapped = overridden();
  const name = (swapped ? 'x' : '') + bakeHash(bakeKeyOf(items, at, W, H, cal));
  const hit = cachedBake(name);
  if (hit) {
    pinBake(key, hit);
    if (BAKE_STAT) console.log('[bake]', items.length, 'items', `${W}x${H}`, 'cached', (performance.now() - t0).toFixed(1));
    return { image: hit, at };
  }
  const g = globalThis as JobStore;
  if (g.__bakeFailed?.[key] === name) return NO_ATLAS;
  const q = g.__bakeJobs ?? (g.__bakeJobs = []);
  // 이 줄이 앞서 맡긴 다른 배치는 이제 기다리지 않는다
  leaveJobs(key, name);
  const same = q.find((j) => j.name === name);
  if (same) {
    if (same.keys.indexOf(key) < 0) same.keys.push(key);
    return PENDING_ATLAS;
  }
  const job = makeJob(key, name, !swapped, items, at, W, H, cal);
  // 기다리는 일감이 없으면 여기서 INLINE_MS까지 구워 본다(빠른 기기는 그 안에 끝나 이전처럼 같은 프레임에 나온다).
  // 지금까지 잰 속도로 턱없이 모자라면 해 보지 않는다(느린 기기에서 부를 때마다 멈칫하지 않게)
  if (!q.length && estimateMs(job) <= 3 * INLINE_MS && stepJob(job, performance.now() + INLINE_MS, 8)) {
    const image = finishJob(job);
    return image ? { image, at } : NO_ATLAS;
  }
  q.push(job);
  startBakeLoop();
  return PENDING_ATLAS;
}

// 시작할 때 굽기 셰이더(빛 격자·굽기)를 미리 컴파일한다(2026-11-12). GPU 컴파일은 처음 그릴 때 UI 스레드를 막는데, 앱이 서재를 읽는 동안은
// JS 스레드만 바쁘고 UI 스레드는 시작 화면만 띄운다: 그 시간에 겹친다. 실제 굽기와 같은 셰이더·같은 화면 밖 표면·같은 자식 그림(첫 번은 빈 그림,
// 다음부터 스냅숏)이라 같은 GPU 프로그램을 다시 쓴다. 칸 몇 개만 그린다(컴파일만 일어나면 된다). 빛 격자와 굽기는 프레임을 나눈다(한 번에 오래 막지 않게)
const WARM_ENV: Env = { floor: -54321, ceil: -54121 };
const WARM_ITEM: BakeItem = { key: WARM_KEY, O: { x: 0, y: 0, z: 100 }, U: { x: 1, y: 0, z: 0 }, V: { x: 0, y: -1, z: 0 }, w: 2, h: 2, n: { x: 0, y: 0, z: -1 }, env: WARM_ENV, bx: NO_BOXES, self: -1 };
let warmed = false;
export function warmLight() {
  if (warmed) return;
  warmed = true;
  scheduleOnUI(() => {
    'worklet';
    const run = startGrid(WARM_ENV, NO_BOXES, 8, 2);
    if (!run) return;
    while (run.pass < GRID_PASSES) drawGrid(run, 16);
    waitGpu(run.surf, run.canvas);
    endGrid(run, true);
    requestAnimationFrame(() => {
      const surf = Skia.Surface.MakeOffscreen(ATLAS_W, 4, BAKE_SURFACE);
      if (surf) {
        const paint = Skia.Paint();
        paint.setShader(itemShader(WARM_ITEM, run.img, lightSet().u as Record<string, unknown>));
        surf.getCanvas().drawRect(Skia.XYWHRect(0, 0, 4, 4), paint);
        waitGpu(surf, surf.getCanvas());
        surf.dispose();
      }
      run.img?.dispose();
    });
  });
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

// 앞 굽기 자리(움직이는 동안만, 아니면 빈 자리). 새 굽기 몫 mix: 앞 굽기에 이 면이 없으면 1(새 굽기만)
function prevSampleOf(a: Atlas, key: string, M: (w: number, h: number) => number[]): { sample: Sample; mix: number } {
  'worklet';
  const p = a.prev;
  if (!p || !((a.mix ?? 1) < 1)) return { sample: NO_SAMPLE, mix: 1 };
  const s = sampleOf(p, key, M);
  return { sample: s, mix: s.live ? 1 : a.mix ?? 1 };
}

// 두 겹(곱하기·닷지)으로 영역(path)을 다시 칠한다. fx: 셰이더, passes: 겹마다 uniform(usePasses), sample: 셰이더 자식(구운 그림과 행렬), prev: 앞 굽기
function Relit({ path, fx, passes, sample, prev, keyImage, heavy }: { path: RO<SkPath> | SkPath; fx: SkRuntimeEffect; passes: RO<Uniforms>[]; sample: RO<Sample>; prev: RO<Sample>; keyImage: RO<SkImage>; heavy: RO<boolean> }) {
  const paths = useStagedPaths(path, passes.length, heavy);
  const image = useDerivedValue(() => sample.value.image);
  const matrix = useDerivedValue(() => sample.value.matrix);
  const image2 = useDerivedValue(() => prev.value.image);
  const matrix2 = useDerivedValue(() => prev.value.matrix);
  return (
    <>
      {passes.map((u, i) => (
        <Path key={i} path={paths[i]} blendMode={BLEND[i]}>
          <Shader source={fx} uniforms={u}>
            <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
            <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
            <ImageShader image={image2} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix2} />
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
    for (const band of fc.bands) for (const layer of band) {
      if (layer.poly.length < 3 || layer.w <= 0) continue;
      const pb = Skia.PathBuilder.Make();
      {
        const poly = layer.poly;
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
// keyShadow: 이 책 면이 받는 창빛 그림자(bookKeyImage), picture: 그림 표지 책(반사광을 더하기 겹으로 따로)
export function BookLight({ dims: d, state, cam, px, outline, albedo, material = 'fine', env, atlas, id, keyShadow, picture = false }: {
  dims: Book3['dims']; state: RO<Book3>; cam: RO<Cam>; px: Affine; outline: RO<SkPath>; albedo: C3; material?: BookSurface;
  env?: RO<Env | null>; atlas?: RO<Atlas>; id: string; keyShadow?: RO<BookKey>; picture?: boolean;
}) {
  const { bd, sp, sq } = rigOf(d);
  const pg = MAT_UNIFORMS.pages;
  const mat = { ...matOf(MAT_UNIFORMS[material], seedOf(id)), erefB: bookEref(material), srefB: bookSref(material), specK: SPEC_K[material], srefP: SREF.paper, pR: pg.mRough, pB: pg.mBump, pG: pg.mGrain, pS: pg.mGsize };
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
  // 앞 굽기(움직이는 동안): 그림·면 칸·새 굽기 몫
  const prev = useDerivedValue(() => {
    const a = atlas ? atlas.value : NO_ATLAS;
    const p = a.prev;
    if (!p || !p.image || !((a.mix ?? 1) < 1)) return { image: EMPTY, rects: NO_RECTS, mix: 1 };
    const out: number[] = [];
    for (const f of FACES) {
      const r = p.at[faceKey(id, f)];
      if (r) out.push(r.x, r.y, r.w, r.h);
      else out.push(0, 0, 0, 0);
    }
    return { image: p.image, rects: out, mix: a.mix ?? 1 };
  });
  const uniforms = useDerivedValue<Uniforms>(() => {
    const b = state.value;
    const c = cam.value;
    const turn = (v: Vec3) => rot(b.roll, b.yaw, v, b.spin ?? 0, b.pitch ?? 0);
    const e = c.eye;
    const ev = env ? env.value : null;
    return {
      ...lightSet().u,
      cam4: e ? [e.x, e.y, e.z, e.dist] : [c.kx, c.ky, 0, 0],
      pxa: [px.s, px.tx, px.ty],
      bO: arr(b.t),
      bX: arr(turn({ x: 1, y: 0, z: 0 })),
      bY: arr(turn({ x: 0, y: 1, z: 0 })),
      bZ: arr(turn({ x: 0, y: 0, z: 1 })),
      dims: [d.T, d.H, d.W],
      rig: [bd, sp, sq],
      rect: rects.value,
      rect2: prev.value.rects,
      mixT: prev.value.mix,
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
  const image2 = useDerivedValue(() => prev.value.image);
  const passes = usePasses(uniforms, picture ? 'art' : 'plain');
  // 구운 면이 하나도 없고 둘레가 있으면 화소마다 둘레 가림을 계산한다(무겁다)
  const heavy = useDerivedValue(() => {
    const r = rects.value;
    for (let i = 2; i < r.length; i += 4) if (r[i] > 0) return false;
    return !!(env && env.value);
  });
  const paths = useStagedPaths(outline, 3, heavy);
  return (
    <>
      {passes.map((u, i) => (
        <Path key={i} path={paths[i]} blendMode={BLEND[i]}>
          <Shader source={BOOK} uniforms={u}>
            <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
            <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
            <ImageShader image={image2} tx="clamp" ty="clamp" sampling={LINEAR} matrix={IDENTITY} />
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
export function areaItem(key: string, a: BakeArea, env: Env | null, bx: BoxBuf): BakeItem {
  'worklet';
  return { key, O: a.O, U: a.U, V: a.V, w: a.w, h: a.h, n: a.plane.n, env, bx, self: -1 };
}

// 평면 영역(path, 캔버스 px)을 구운 하늘 가림 + 그 자리의 직접 빛·반사광으로 칠한다(albedo: 재질 색, 선형 RGB,
// eref: 그 재질의 대표 자리 빛 light-model EREF, mat: 표면 재질(ui/lighting materials), seed: 무늬 자리 어긋남).
// color가 있으면(단색 재질) 재질 색 × 빛을 한 번에 칠하고, 없으면 아래 재질 그림 위에 곱하기·닷지 두 겹으로 다시 칠한다.
// atlas·key: 구운 그림과 이 영역의 자리, matrix: 영역 칸 → 캔버스 px(칸 수 w × h를 받아)
// keyShadow: 책이 이 면에서 창빛 원반을 가리는 몫(평면 좌표 그림, PlaneKey: 벽·판 윗면)
export function BakedPlane({ path, cam, px, plane, env, atlas, akey, matrix, albedo, eref, sref = ZERO3, mat, seed = [0, 0], color, keyShadow, rim = NO_RIM, rimCeil = 1e9, soft }: {
  path: RO<SkPath> | SkPath; cam: RO<Cam>; px: Affine; plane: Plane; env: Env | null; atlas?: RO<Atlas>; akey: string; matrix: (c: Cam, w: number, h: number) => number[]; albedo: C3; eref: C3; sref?: number[]; mat: MaterialName; seed?: number[]; color?: string;
  keyShadow?: RO<PlaneKey>;
  rim?: number[];
  rimCeil?: number;
  soft?: { box: number[]; r: number[] }; // 안쪽 모서리 번짐(color가 있을 때만, scene-light-sksl softEdge)
}) {
  const base = color ? rgbOf(color) : null;
  const m = matOf(MAT_UNIFORMS[mat], seed);
  const kS = (materials[mat] as SurfaceMaterial).specular ?? 1;
  const keyImage = useDerivedValue(() => (keyShadow ? keyShadow.value : NO_PLANE_KEY).image);
  const sample = useDerivedValue(() => (atlas ? sampleOf(atlas.value, akey, (w, h) => matrix(cam.value, w, h)) : NO_SAMPLE));
  const prevAt = useDerivedValue(() => (atlas ? prevSampleOf(atlas.value, akey, (w, h) => matrix(cam.value, w, h)) : { sample: NO_SAMPLE, mix: 1 }));
  const prev = useDerivedValue(() => prevAt.value.sample);
  const uniforms = useDerivedValue<Uniforms>(() => {
    const c = cam.value;
    return {
      ...BASE,
      ...lightSet().u,
      ...planeFrame(c, px, plane),
      tN: arr(plane.n),
      bev0: edgeOf(plane.edges?.[0]),
      bev1: edgeOf(plane.edges?.[1]),
      endR: plane.endR ?? 0,
      rim,
      rimCeil,
      kS,
      ...(soft ? { softBox: soft.box, softR: soft.r } : null),
      cam4: camOf(c, plane.O),
      env: envOf(env),
      albedo,
      eref,
      sref,
      liveEnv: sample.value.live,
      mixT: prevAt.value.mix,
      ...keyMapOf(keyShadow ? keyShadow.value : NO_PLANE_KEY),
      ...m,
      ...(base ? { base } : null),
    };
  });
  const passes = usePasses(uniforms, base ? 'direct' : 'plain');
  // 구운 값이 없고 둘레가 있으면 화소마다 둘레 가림을 계산한다(무겁다)
  const heavy = useDerivedValue(() => sample.value.live === 1 && env !== null, [env]);
  if (base) return <Direct path={path} uniforms={passes[0]} sample={sample} prev={prev} keyImage={keyImage} heavy={heavy} />;
  return <Relit path={path} fx={LIT} passes={passes} sample={sample} prev={prev} keyImage={keyImage} heavy={heavy} />;
}
function Direct({ path, uniforms, sample, prev, keyImage, heavy }: { path: RO<SkPath> | SkPath; uniforms: RO<Uniforms>; sample: RO<Sample>; prev: RO<Sample>; keyImage: RO<SkImage>; heavy: RO<boolean> }) {
  const image = useDerivedValue(() => sample.value.image);
  const matrix = useDerivedValue(() => sample.value.matrix);
  const image2 = useDerivedValue(() => prev.value.image);
  const matrix2 = useDerivedValue(() => prev.value.matrix);
  const paths = useStagedPaths(path, 1, heavy);
  return (
    <Path path={paths[0]}>
      <Shader source={LIT} uniforms={uniforms}>
        <ImageShader image={image} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix} />
        <ImageShader image={keyImage} tx="decal" ty="decal" sampling={LINEAR} />
        <ImageShader image={image2} tx="clamp" ty="clamp" sampling={LINEAR} matrix={matrix2} />
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
    return { ...lightSet().u, pxa: [s, 0, 0], root: arr(f.root), axR: arr(f.axR), axU: arr(f.axU), nrm: arr(f.n), loss: f.loss, cam4: f.cam4, keyOn: 1, albedo, eref: bookEref('paper'), sref: bookSref('paper'), env: envOf(f.env), ...mat };
  });
  const passes = usePasses(uniforms, 'plain');
  const paths = useStagedPaths(path, 2);
  return (
    <>
      {passes.map((u, i) => (
        <Path key={i} path={paths[i]} blendMode={BLEND[i]}>
          <Shader source={TAB} uniforms={u} />
        </Path>
      ))}
    </>
  );
}
