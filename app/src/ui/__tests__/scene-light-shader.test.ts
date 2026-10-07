/**
 * @jest-environment node
 */
// 빛 셰이더(SkSL)가 컴파일되고, 같은 점에서 JS 빛 모델(domain/light-model)과 같은 값을 내는지(CanvasKit으로 실제로 그려 읽는다).
import type { Book3, Vec3 } from '@/domain/book3';
import { bakeLoss, bandOf, boxOf, DESIGN, ENV_NX, ENV_NY, EREF, FAR, GRID_N, GRID_PASSES, lightWithLoss, ROUGH, TOUCH, linearOf, packBoxes, skyLossAt, solveGrid, toEye, toneDodge, toneMul, withCovers, type Band, type BoxBuf, type C3, type Env } from '@/domain/light-model';
import { MAT_UNIFORMS, matSample, type MatUniforms } from '@/domain/surface-pattern';
import { SHELF_DEPTH, SHELF_THICK } from '@/domain/geometry';
import { bakeSource, bookSource, GRID_SCALE, gridSource, litSource, LOSS_OFF, LOSS_SCALE, planeFrame } from '../scene-light-sksl';
import { EDGE_R, GROOVE, rigOf } from '@/domain/book-parts';
import { camAt, toPx } from '@/domain/camera';

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');
const dir = `${__dirname}/../../../node_modules/canvaskit-wasm/bin/full`;

type CK = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let CK: CK;
beforeAll(async () => {
  // jest-expo가 바꿔 둔 TextDecoder는 utf-16을 못 읽는다(CanvasKit이 쓴다)
  (globalThis as { TextDecoder: unknown }).TextDecoder = require('util').TextDecoder;
  CK = await CanvasKitInit({ locateFile: (f: string) => `${dir}/${f}` });
}, 60000);

function uniformArray(effect: CK, values: Record<string, number | number[]>) {
  const out: number[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const v = values[name];
    if (v === undefined) throw new Error(`missing uniform ${name}`);
    const slot = effect.getUniform(i).slot;
    const next = i + 1 < effect.getUniformCount() ? effect.getUniform(i + 1).slot : effect.getUniformFloatCount();
    const want = next - slot;
    const arr = typeof v === 'number' ? [v] : v;
    if (arr.length !== want) throw new Error(`uniform ${name}: ${arr.length} != ${want}`);
    out.push(...arr);
  }
  return out;
}

// 채널마다 차이의 최댓값
const maxDiff = (a: C3, b: C3) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));
const book = (x: number, T = 22, H = 150, W = 100, z = 0): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z } });

// 법선에 수직인 두 단위 축
function axes(n: Vec3) {
  const t = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = { x: t.y * n.z - t.z * n.y, y: t.z * n.x - t.x * n.z, z: t.x * n.y - t.y * n.x };
  const ul = Math.hypot(u.x, u.y, u.z);
  const U = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const V = { x: n.y * U.z - n.z * U.y, y: n.z * U.x - n.x * U.z, z: n.x * U.y - n.y * U.x };
  return { U, V };
}
// 1×1 그림에 셰이더를 그려 회색 값(0~1)을 읽는다. child: 셰이더 자식(구운 그림 자리. true면 검정, 그림 셰이더면 그것)
const black = () => CK.Shader.MakeColor(CK.Color4f(0, 0, 0, 1), CK.ColorSpace.SRGB);
const linear = (img: CK) => img.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Linear, CK.MipmapMode.None);
function draw(src: string, values: Record<string, number | number[]>, child: boolean | CK = false, more: CK[] = []): C3 {
  const err: string[] = [];
  const effect = CK.RuntimeEffect.Make(src, (e: string) => err.push(e));
  if (!effect) throw new Error(err.join('\n'));
  const uni = uniformArray(effect, values);
  const kids = child ? [child === true ? black() : child, ...more] : [];
  const shader = child ? effect.makeShaderWithChildren(uni, kids) : effect.makeShader(uni);
  const surf = CK.MakeSurface(1, 1);
  const paint = new CK.Paint();
  paint.setShader(shader);
  surf.getCanvas().drawRect(CK.XYWHRect(0, 0, 1, 1), paint);
  const px = surf.makeImageSnapshot().readPixels(0, 0, { width: 1, height: 1, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
  return [px[0] / 255, px[1] / 255, px[2] / 255];
}

// 굽기 셰이더로 점 P(법선 n)의 하늘 가림을 굽고 읽는다: 1×1 그림, 화소 가운데(0.5, 0.5)가 P
const NO_BAND = { bandLo: [0, 0, 0, 0], bandLoFar: [0, 0, 0], bandHi: [0, 0, 0, 0], bandHiFar: [0, 0, 0] };
// grid: 빛 격자 그림(CanvasKit, 없으면 가리개는 가림 없는 받는 빛), self: 받는 점의 책
function shaderLoss(P: Vec3, n: Vec3, env: Env | null, bx: BoxBuf, band: Record<string, number[]> = NO_BAND, grid: CK = null, self = -1) {
  const { U, V } = axes(n);
  const g = draw(bakeSource(), {
    O: [P.x - 0.5e-3 * (U.x + V.x), P.y - 0.5e-3 * (U.y + V.y), P.z - 0.5e-3 * (U.z + V.z)],
    Ux: [U.x * 1e-3, U.y * 1e-3, U.z * 1e-3],
    Vy: [V.x * 1e-3, V.y * 1e-3, V.z * 1e-3],
    tN: [n.x, n.y, n.z],
    env: env ? [1, env.floor, env.ceil] : [0, 0, 0],
    box: bx.v,
    nBox: bx.list.length,
    selfIdx: self,
    ...band,
    gridOn: grid ? 1 : 0,
    gridNx: bx.list.length ? ENV_NX : 1,
  }, grid ? linear(grid) : black());
  return g.map((v) => v * LOSS_SCALE - LOSS_OFF) as C3;
}

// 그리는 셰이더(둘레 하늘 가림을 그 자리에서, liveEnv)의 곱하기·닷지 값: 평평한 면 P(법선 n), 눈 cam4.
// 재질(mat): JS 빛과 견줄 때는 결·미세 높이가 없는 코팅지(PLAIN), k: 화소 한 칸이 덮는 면 길이(DU)
const CAM4 = [183, 300, 0, 4918];
const uniOf = (m: MatUniforms, seed = [0, 0]) => ({ mR: m.mRough, mB: m.mBump, mG: m.mGrain, mS: m.mGsize, mSeed: seed });
const PLAIN = uniOf(MAT_UNIFORMS.coated);
// kx: 책이 창빛을 가리는 몫(그림자 그림 자리를 고른 알파로)
function shaderLit(P: Vec3, n: Vec3, env: Env | null, dodge: boolean | 'direct', albedo: C3, base?: number[], mat = PLAIN, k = 1e-3, kx = 0) {
  const { U, V } = axes(n);
  return draw(
    litSource(dodge),
    {
      ...(base ? { base } : null),
      ...mat,
      kU: [0, 0, 0],
      kV: [0, 0, 0],
      kO: [0, 0],
      sref: [0, 0, 0],
      O: [P.x - 0.5 * k * (U.x + V.x), P.y - 0.5 * k * (U.y + V.y), P.z - 0.5 * k * (U.z + V.z)],
      Ux: [U.x * k, U.y * k, U.z * k],
      Vy: [V.x * k, V.y * k, V.z * k],
      Hw: [0, 0, 1],
      tN: [n.x, n.y, n.z],
      bev0: [0, 0, 0, 1e9],
      bev1: [0, 0, 0, 1e9],
      cam4: CAM4,
      keyOn: 1,
      albedo,
      eref: EREF.wall,
      liveEnv: 1,
      env: env ? [1, env.floor, env.ceil] : [0, 0, 0],
    },
    true,
    [CK.Shader.MakeColor(CK.Color4f(0, 0, 0, kx), CK.ColorSpace.SRGB)],
  );
}

const row: Env = { floor: 0, ceil: 200 };
const cases: [string, Vec3, Vec3, Env | null, Book3[]][] = [
  ['열린 방', { x: 111, y: 50, z: 0 }, { x: 0, y: 0, z: -1 }, null, []],
  ['판 윗면, 책 앞', { x: 111, y: 0, z: -4 }, { x: 0, y: 1, z: 0 }, row, [book(76), book(100), book(124)]],
  ['벽, 좁은 틈', { x: 123.5, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(100), book(125)]],
  ['책등 아래쪽(위 판 그늘·판 윗면)', { x: 111, y: 10, z: 0 }, { x: 0, y: 0, z: -1 }, row, [book(76), book(124)]],
  ['기운 법선', { x: 111, y: 140, z: 0 }, { x: 0.3, y: 0.4, z: -Math.sqrt(1 - 0.25) }, row, [book(76), book(124, 22, 180)]],
  ['판 밑 벽', { x: 180, y: -30, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, { floor: -FAR, ceil: -16 }, []],
  ['그린 판 끝 너머 벽(가림 계산에서는 판이 이어진다)', { x: -9, y: 30, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(16)]],
  ['그린 판 끝 너머 벽(오른쪽, 위 판 아래)', { x: 375, y: 190, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(340)]],
];

describe('빛 셰이더 = JS 빛 모델', () => {
  it('셰이더가 컴파일된다', () => {
    for (const src of [bakeSource(), gridSource(), litSource(false), litSource(true), litSource('direct'), bookSource(false), bookSource(true)]) {
      const err: string[] = [];
      const e = CK.RuntimeEffect.Make(src, (m: string) => err.push(m));
      expect(err.join('\n')).toBe('');
      expect(e).toBeTruthy();
    }
  });
  it.each(cases)('%s', (_, P, n0, env, books) => {
    const l = Math.hypot(n0.x, n0.y, n0.z);
    const n = { x: n0.x / l, y: n0.y / l, z: n0.z / l };
    // 색 있는 장정(채널마다 다른 되비침)
    const list = withCovers(books.map((b, i) => boxOf(b, i % 2 ? [0.5, 0.08, 0.05] : [0.05, 0.12, 0.42])));
    const bx = packBoxes(list, books.map((b) => b.id));
    const js = skyLossAt(P, n, env, list);
    const gpu = shaderLoss(P, n, env, bx);
    // 채널마다 8비트 한 단계(LOSS_SCALE / 255) 안
    expect(maxDiff(gpu, js)).toBeLessThan(LOSS_SCALE / 255);
  });
});

// 빛 격자(되비침): GPU로 푼 격자(gridSource를 GRID_PASSES번)와 JS solveGrid가 칸마다 같고, 그 격자를 읽는 굽기도 JS와 같다
describe('빛 격자 셰이더 = JS', () => {
  // 기댄 책(회전된 상자)도 하나
  const lean: Book3 = { id: 'lean', dims: { T: 22, H: 140, W: 100 }, roll: -8, yaw: 0, t: { x: 172, y: 0, z: 0 } };
  const list = withCovers([boxOf(book(76), [0.05, 0.12, 0.42]), boxOf(book(100), [0.8, 0.75, 0.65]), boxOf(book(123, 22, 120), [0.5, 0.08, 0.05]), boxOf(lean, [0.85, 0.5, 0.38])]);
  const bx = packBoxes(list, ['a', 'b', 'c', 'd']);
  const N = GRID_N;
  const W = 6 * N;
  const H = list.length * N + 3 * ENV_NY;
  function gpuGrid(env: Env, passes: number) {
    const err: string[] = [];
    const effect = CK.RuntimeEffect.Make(gridSource(), (e: string) => err.push(e));
    if (!effect) throw new Error(err.join('\n'));
    const surf = CK.MakeSurface(W, H);
    const paint = new CK.Paint();
    let img: CK = null;
    for (let k = 0; k < passes; k++) {
      const uni = uniformArray(effect, { env: [1, env.floor, env.ceil], box: bx.v, nBox: list.length, gridOn: img ? 1 : 0, gridNx: ENV_NX });
      paint.setShader(effect.makeShaderWithChildren(uni, [img ? linear(img) : black()]));
      surf.getCanvas().drawRect(CK.XYWHRect(0, 0, W, H), paint);
      img = surf.makeImageSnapshot();
    }
    const px = img.readPixels(0, 0, { width: W, height: H, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB });
    return { img, px };
  }
  // 칸 (x, y)의 GPU 값과 JS 격자 값(배치: scene-light-sksl GRID_SCALE 주석)
  function compare(env: Env, passes: number) {
    const G = solveGrid(env, list, passes);
    const { px } = gpuGrid(env, passes);
    let worst = 0;
    const at = (x: number, y: number, js: C3) => {
      for (let c = 0; c < 3; c++) {
        worst = Math.max(worst, Math.abs((px[(y * W + x) * 4 + c] / 255) * GRID_SCALE - js[c]));
      }
    };
    for (let i = 0; i < list.length; i++) for (let f = 0; f < 6; f++) for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) at(f * N + a, i * N + b, G.e[(i * 6 + f) * N * N + b * N + a]);
    for (let w = 0; w < 3; w++) for (let b = 0; b < ENV_NY; b++) for (let a = 0; a < G.nx; a++) at(a, list.length * N + w * ENV_NY + b, G.e[list.length * 6 * N * N + w * G.nx * ENV_NY + b * G.nx + a]);
    return worst;
  }
  it('격자 풀기 첫 번(가리개는 가림 없는 받는 빛): 칸마다 8비트 한 단계 남짓 안', () => {
    expect(compare(row, 1)).toBeLessThan((1.5 * GRID_SCALE) / 255);
  });
  it('되풀이(지난 격자를 읽는다): 8비트로 반올림한 격자를 다시 읽어도 몇 단계 안', () => {
    expect(compare(row, 2)).toBeLessThan((3 * GRID_SCALE) / 255);
  });
  it.each([
    ['책 사이 틈 뒤 벽', { x: 99, y: 60, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, -1],
    ['책 앞 판 윗면', { x: 111, y: 0, z: -10 }, { x: 0, y: 1, z: 0 }, -1],
    ['책등 아래쪽(받는 책 빼고)', { x: 111, y: 3, z: 0 }, { x: 0, y: 0, z: -1 }, 1],
    ['틈 안 표지', { x: 122, y: 60, z: 20 }, { x: 1, y: 0, z: 0 }, 1],
  ] as [string, Vec3, Vec3, number][])('격자를 읽는 굽기 = JS, %s', (_, P, n, self) => {
    const G = solveGrid(row, list);
    const { img } = gpuGrid(row, GRID_PASSES);
    const js = skyLossAt(P, n, row, list, G, self);
    expect(maxDiff(shaderLoss(P, n, row, bx, NO_BAND, img, self), js)).toBeLessThan((3 * LOSS_SCALE) / 255);
  });
});

describe('그린 판 끝 너머 판 두께 높이 벽 띠(bakeLoss)', () => {
  const n = { x: 0, y: 0, z: -1 };
  const lower: Env = { floor: -FAR, ceil: -SHELF_THICK };
  const upper: Env = { floor: 200 + SHELF_THICK, ceil: 200 + SHELF_THICK + 190 };
  const band: [Band, Band] = [bandOf(row, lower, false), bandOf(row, upper, true)];
  const list = withCovers([boxOf(book(16), [0.5, 0.08, 0.05]), boxOf(book(340), [0.05, 0.12, 0.42])]);
  const bx = packBoxes(list, ['a', 'b']);
  const draw = (b: Band | null) => ({ mid: b ? [...b.mid, 1] : [0, 0, 0, 0], far: b ? b.far : [0, 0, 0] });
  const shader = (P: Vec3) => shaderLoss(P, n, row, bx, { bandLo: draw(band[0]).mid, bandLoFar: draw(band[0]).far, bandHi: draw(band[1]).mid, bandHiFar: draw(band[1]).far });
  it.each([
    ['아래 판 띠(가까운 절반)', { x: -9, y: -6, z: SHELF_DEPTH }],
    ['아래 판 띠(먼 절반)', { x: -9, y: -12, z: SHELF_DEPTH }],
    ['위 판 띠', { x: 375, y: 200 + 5, z: SHELF_DEPTH }],
    ['띠 밖', { x: 375, y: 120, z: SHELF_DEPTH }],
  ] as [string, Vec3][])('%s: 셰이더 = JS', (_, P) => {
    expect(maxDiff(shader(P), bakeLoss(P, n, row, list, band))).toBeLessThan(LOSS_SCALE / 255);
  });
  it('띠는 이 줄 쪽 경계 → 가운데(두 줄이 같은 값) → 건너편 경계로 잇는다', () => {
    // 받는 빛(창빛 포함, 반사 몫 없이): 굽는 가림을 그 자리의 직접 빛에서 뺀 것
    const lit = (p: Vec3) => lightWithLoss(p, n, null, row, bakeLoss(p, n, row, list, band), true, [1, 1, 1]).r;
    const edge = { x: 375, y: 200 - TOUCH, z: SHELF_DEPTH };
    const near = lightWithLoss(edge, n, null, row, skyLossAt(edge, n, row, list), true, [1, 1, 1]).r;
    const bot = lit({ x: 375, y: 200 + 1e-6, z: SHELF_DEPTH });
    const mid = lit({ x: 375, y: 200 - TOUCH + SHELF_THICK / 2, z: SHELF_DEPTH });
    const top = lit({ x: 375, y: 200 + SHELF_THICK - 1e-6, z: SHELF_DEPTH });
    // 위 줄에서 본 같은 띠(위 줄 둘레, 아래 판 띠): 가운데 값이 같다
    const upBand = bandOf(upper, row, false);
    for (let c = 0; c < 3; c++) {
      expect(bot[c]).toBeCloseTo(near[c], 2);
      expect(mid[c]).toBeCloseTo(band[1].mid[c], 3);
      expect(top[c]).toBeCloseTo(band[1].far[c], 2);
      expect(upBand.mid[c]).toBeCloseTo(band[1].mid[c], 9);
      // 판 바로 밑 벽은 위가 판이라 판 바로 위 벽(건너편 경계)보다 어둡다
      expect(bot[c]).toBeLessThan(top[c]);
    }
  });
});

describe('그리는 셰이더 = JS 빛(lightWithLoss, 둘레 하늘 가림)', () => {
  const eye = { x: CAM4[0], y: CAM4[1], z: CAM4[2], dist: CAM4[3] };
  const cam = { kx: 0, ky: 0, eye } as Parameters<typeof toEye>[0];
  it.each([
    ['책등(앞), 판 위', { x: 111, y: 60, z: 0 }, { x: 0, y: 0, z: -1 }, row, linearOf('#466181')],
    ['벽', { x: 200, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, linearOf('#FCF8F1')],
    ['판 윗면', { x: 150, y: 0, z: -10 }, { x: 0, y: 1, z: 0 }, row, linearOf('#F2DCC1')],
    ['그린 판 끝 너머 벽', { x: -9, y: 30, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, linearOf('#FCF8F1')],
    ['판 윗면 높이 위, 기운 면', { x: -6, y: 3, z: 40 }, { x: 0.3, y: 0.5, z: -Math.sqrt(0.66) }, row, linearOf('#C9785F')],
    ['열린 방, 기운 면', { x: 50, y: 50, z: 0 }, { x: 0.4, y: 0.3, z: -Math.sqrt(0.75) }, null, linearOf('#8AA07E')],
  ] as [string, Vec3, Vec3, Env | null, C3][])('%s', (_, P, n0, env, albedo) => {
    const l = Math.hypot(n0.x, n0.y, n0.z);
    const n = { x: n0.x / l, y: n0.y / l, z: n0.z / l };
    const lt = lightWithLoss(P, n, toEye(cam, P), env, skyLossAt(P, n, env, []), true, EREF.wall, undefined, ROUGH.coated);
    const mul = lt.r.map((r, c) => toneMul(albedo[c], r, lt.spec[c])) as C3;
    const dodge = lt.r.map((r, c) => toneDodge(albedo[c], r, lt.spec[c])) as C3;
    expect(maxDiff(shaderLit(P, n, env, false, albedo), mul)).toBeLessThan(1.5 / 255);
    expect(maxDiff(shaderLit(P, n, env, true, albedo), dodge)).toBeLessThan(1.5 / 255);
    // 한 번에 칠하기(단색 재질 base): base × 곱하기 / (1 − 닷지), 채널마다 1에서 자름(두 겹을 칠한 결과와 같다)
    const base = [0.99, 0.97, 0.945];
    const direct = base.map((b, c) => Math.min(1, (b * mul[c]) / Math.max(1e-4, 1 - dodge[c]))) as C3;
    expect(maxDiff(shaderLit(P, n, env, 'direct', albedo, base), direct)).toBeLessThan(2 / 255);
  });

  it('책이 창빛을 가린 벽(그림자 그림 kx): 위 판이 가리고 남은 창빛에서 그만큼 빠진다(빛 계산 안, 톤 곡선 앞)', () => {
    const P = { x: 200, y: 120, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    const albedo = linearOf('#FCF8F1');
    const base = [0.99, 0.97, 0.945];
    for (const kx of [0.3, 1]) {
      const lt = lightWithLoss(P, n, toEye(cam, P), row, skyLossAt(P, n, row, []), true, EREF.wall, undefined, ROUGH.coated, kx);
      const mul = lt.r.map((r, c) => toneMul(albedo[c], r, lt.spec[c]));
      const dodge = lt.r.map((r, c) => toneDodge(albedo[c], r, lt.spec[c]));
      const direct = base.map((b, c) => Math.min(1, (b * mul[c]) / Math.max(1e-4, 1 - dodge[c]))) as C3;
      expect(maxDiff(shaderLit(P, n, row, 'direct', albedo, base, PLAIN, 1e-3, kx), direct)).toBeLessThan(2 / 255);
    }
  });
});

// 재질 무늬(결·미세 높이·거칠기)가 셰이더와 JS 쌍둥이(surface-pattern matSample)에서 같은지: 무늬가 보이는 크기(가까이)와
// 일부만 보이는 크기에서, 미세 높이로 기운 법선·거칠기·반사율 배수까지 넣은 빛으로 견준다
describe('재질 무늬: 셰이더 = JS(matSample)', () => {
  const eye = { x: CAM4[0], y: CAM4[1], z: CAM4[2], dist: CAM4[3] };
  const cam = { kx: 0, ky: 0, eye } as Parameters<typeof toEye>[0];
  it.each([
    ['종이(섬유·뭉침), 가까이', 'paper', { x: 131.3, y: 72.7, z: 0 }, { x: 0, y: 0, z: -1 }, 0.02],
    ['천(올), 가까이', 'cloth', { x: 131.3, y: 72.9, z: 0 }, { x: 0, y: 0, z: -1 }, 0.02],
    ['나무 윗면(나이테)', 'wood', { x: 150.2, y: 0, z: -10.7 }, { x: 0, y: 1, z: 0 }, 0.05],
    ['나무 앞면, 화소가 큰 곳', 'wood', { x: 151.9, y: -8.3, z: -53 }, { x: 0, y: 0, z: -1 }, 0.4],
    ['속지 단면(낱장·접장)', 'pages', { x: 100.37, y: 150, z: 40 }, { x: 0, y: 1, z: 0 }, 0.03],
    ['벽(칠)', 'paint', { x: 200, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, 0.3],
  ] as [string, keyof typeof MAT_UNIFORMS, Vec3, Vec3, number][])('%s', (_, name, P, n, k) => {
    const M = MAT_UNIFORMS[name];
    const seed = [3.7, 11.2];
    const { U, V } = axes(n);
    const Au = { x: 1, y: 0, z: 0 };
    const c = { x: n.y * Au.z - n.z * Au.y, y: n.z * Au.x - n.x * Au.z, z: n.x * Au.y - n.y * Au.x };
    const cl = Math.hypot(c.x, c.y, c.z);
    const Av = { x: c.x / cl, y: c.y / cl, z: c.z / cl };
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    const fu = Math.max(Math.abs(dot(U, Au)), Math.abs(dot(V, Au))) * k;
    const fv = Math.max(Math.abs(dot(U, Av)), Math.abs(dot(V, Av))) * k;
    const ms = matSample(dot(P, Au) + seed[0], dot(P, Av) + seed[1], fu, fv, M);
    const nb0 = { x: n.x - ms.su * Au.x - ms.sv * Av.x, y: n.y - ms.su * Au.y - ms.sv * Av.y, z: n.z - ms.su * Au.z - ms.sv * Av.z };
    const nl = Math.hypot(nb0.x, nb0.y, nb0.z);
    const nb = { x: nb0.x / nl, y: nb0.y / nl, z: nb0.z / nl };
    const albedo = linearOf('#C9A27A');
    const lt = lightWithLoss(P, nb, toEye(cam, P), row, skyLossAt(P, n, row, []), true, EREF.wall, n, ms.r);
    const mul = lt.r.map((r, ch) => toneMul(albedo[ch], r * ms.f, lt.spec[ch])) as C3;
    const dodge = lt.r.map((r, ch) => toneDodge(albedo[ch], r * ms.f, lt.spec[ch])) as C3;
    expect(maxDiff(shaderLit(P, n, row, false, albedo, undefined, uniOf(M, seed), k), mul)).toBeLessThan(1.5 / 255);
    expect(maxDiff(shaderLit(P, n, row, true, albedo, undefined, uniOf(M, seed), k), dodge)).toBeLessThan(1.5 / 255);
  });
});

// 책 한 권 광선 셰이더(bookSource): 캔버스 화소 하나로 가는 눈 광선이 처음 닿는 면·점·법선(둥근 모서리, 속지 구멍)을
// 같은 기하의 JS 계산과 비교한다(구운 값 없이 둘레만: 하늘 가림 = envLoss(면 평면 점, 면 법선))
describe('책 광선 셰이더 = 광선 기하 + JS 빛', () => {
  const eye = { x: CAM4[0], y: CAM4[1], z: CAM4[2], dist: CAM4[3] };
  const cam = { kx: 0, ky: 0, eye } as Parameters<typeof toEye>[0];
  const E = { x: eye.x, y: eye.y, z: eye.z - eye.dist };
  const d = { T: 22, H: 150, W: 100 };
  const bO = { x: 100, y: 0, z: 0 };
  const { bd, sp, sq } = rigOf(d);
  const tone: C3 = linearOf('#466181');
  const paper = DESIGN.paper;
  // 줄 공간 점 Q를 화소 가운데(0.5, 0.5)에 오게 하는 캔버스 사상(배율 1)
  function pxaOf(Q: Vec3) {
    const k = (eye.z - E.z) / (Q.z - E.z);
    const S = { x: E.x + (Q.x - E.x) * k, y: E.y + (Q.y - E.y) * k };
    return [1, 0.5 - S.x, 0.5 + S.y];
  }
  // kx: 책등 면이 받는 창빛 그림자(그림자 그림 자리를 고른 알파로)
  const shader = (Q: Vec3, dodge: boolean, kx = 0) =>
    draw(
      bookSource(dodge),
      {
        kRect: kx > 0 ? [0, 0, 1, 1, ...new Array(20).fill(0)] : new Array(24).fill(0),
        cam4: CAM4, pxa: pxaOf(Q), bO: [bO.x, bO.y, bO.z], bX: [1, 0, 0], bY: [0, 1, 0], bZ: [0, 0, 1],
        dims: [d.T, d.H, d.W], rig: [bd, sp, sq], rect: new Array(24).fill(0), keyOn: 1, albedo: tone,
        env: [1, row.floor, row.ceil], erefB: EREF.book, srefB: [0, 0, 0], srefP: [0, 0, 0], ...PLAIN, pR: PLAIN.mR, pB: PLAIN.mB, pG: PLAIN.mG, pS: PLAIN.mS,
      },
      true,
      [CK.Shader.MakeColor(CK.Color4f(0, 0, 0, kx), CK.ColorSpace.SRGB)],
    );
  // JS 기하: 면 평면 점 F(면 법선 nf)에서 광선을 이어 닿는 곳의 점·법선·반사율
  function expected(F: Vec3, nf: Vec3, hit: { P: Vec3; n: Vec3; a: C3 }, dodge: boolean, kx = 0): C3 {
    const loss = skyLossAt(F, nf, row, []);
    const lt = lightWithLoss(hit.P, hit.n, toEye(cam, hit.P), row, loss, true, hit.a === paper ? EREF.paper : EREF.book, nf, ROUGH.coated, kx);
    return lt.r.map((r, c) => (dodge ? toneDodge(hit.a[c], r, lt.spec[c]) : toneMul(hit.a[c], r, lt.spec[c]))) as C3;
  }
  const ray = (Q: Vec3) => {
    const v = { x: Q.x - E.x, y: Q.y - E.y, z: Q.z - E.z };
    return v;
  };
  it('책등 가운데: 책등 면, 법선 앞(책등 곡면 가운데는 평평)', () => {
    const F = { x: bO.x + d.T / 2, y: 80, z: 0 };
    const n = { x: 0, y: 0, z: -1 };
    for (const dodge of [false, true]) expect(maxDiff(shader(F, dodge), expected(F, n, { P: F, n, a: tone }, dodge))).toBeLessThan(1.5 / 255);
  });
  it('윤곽 가장자리 화소의 가운데가 상자를 살짝 비껴가도 가장 가까운 면의 빛으로 칠한다(빛 없는 재질 그림이 점선처럼 드러나지 않는다)', () => {
    // 책등 왼쪽 변 바깥 0.6DU(배율 1: 0.6px)와 변 바로 안
    const out = { x: bO.x - 0.6, y: 80, z: 0 };
    const inn = { x: bO.x + 1e-4, y: 80, z: 0 };
    for (const dodge of [false, true]) {
      const o = shader(out, dodge);
      expect(maxDiff(o, shader(inn, dodge))).toBeLessThan(3 / 255);
      expect(maxDiff(o, dodge ? [0, 0, 0] : [1, 1, 1])).toBeGreaterThan(5 / 255);
    }
  });
  it('책등이 받는 창빛 그림자(그림자 그림 kx): 빛 계산 안에서 창빛 몫이 그만큼 빠진다', () => {
    const F = { x: bO.x + d.T / 2, y: 80, z: 0 };
    const n = { x: 0, y: 0, z: -1 };
    for (const kx of [0.4, 1]) for (const dodge of [false, true]) expect(maxDiff(shader(F, dodge, kx), expected(F, n, { P: F, n, a: tone }, dodge, kx))).toBeLessThan(1.5 / 255);
  });
  it('표지 앞 모서리(둥근 모서리 안): 법선이 앞쪽으로 기운다', () => {
    // 표지(x = T) 면, 책등 쪽 변에서 0.6DU: 원호 모서리 법선(둥근 모서리 + 제본 홈)
    const u = 0.6;
    const v = 70;
    const F = { x: bO.x + d.T, y: d.H - v, z: u };
    const rx = Math.min(d.W / 2, EDGE_R);
    const arc = (dist: number, r: number) => Math.max(0, Math.min(1, 1 - dist / r));
    const tx = arc(d.W - u, rx) - arc(u, rx);
    const nz = Math.sqrt(Math.max(1e-4, 1 - tx * tx));
    const hd = (u - GROOVE.at) / GROOVE.width;
    const sx = tx / nz + GROOVE.slope * hd * Math.exp(-hd * hd);
    const l = Math.hypot(sx, 1);
    const n = { x: 1 / l, y: 0, z: sx / l };
    for (const dodge of [false, true]) expect(maxDiff(shader(F, dodge), expected(F, { x: 1, y: 0, z: 0 }, { P: F, n, a: tone }, dodge))).toBeLessThan(1.5 / 255);
  });
  it.each([
    ['머리 구멍 왼쪽 벽 가까이(벽에 닿는다)', bd + 0.1, true],
    ['머리 구멍 가운데(속지 면)', d.T / 2, false],
  ] as [string, number, boolean][])('%s', (_, u, wall) => {
    // 머리(y = H) 면의 열린 칸 안 점 F에서 광선을 이어: 속지 면(깊이 sq) 또는 왼쪽 판 안쪽 벽(x = bd, 법선 +x)
    const F = { x: bO.x + u, y: d.H, z: 50 };
    const r = ray(F);
    const tPage = sq / -r.y;
    const tWall = r.x < 0 ? (bd - u) / r.x : Infinity;
    expect(tWall < tPage).toBe(wall);
    const t = Math.min(tPage, tWall);
    const P = { x: F.x + r.x * t, y: F.y + r.y * t, z: F.z + r.z * t };
    const n = wall ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    for (const dodge of [false, true]) expect(maxDiff(shader(F, dodge), expected(F, { x: 0, y: 1, z: 0 }, { P, n, a: wall ? tone : paper }, dodge))).toBeLessThan(1.5 / 255);
  });
});

describe('평면 사상(캔버스 px → 평면 위 점)', () => {
  it.each([
    ['벽', { O: { x: 0, y: 0, z: SHELF_DEPTH }, n: { x: 0, y: 0, z: -1 } }],
    ['판 윗면', { O: { x: 0, y: 0, z: 0 }, n: { x: 0, y: 1, z: 0 } }],
    ['판 앞면', { O: { x: 0, y: 0, z: -53 }, n: { x: 0, y: 0, z: -1 } }],
  ])('%s: 평면 위에 있고 다시 투영하면 같은 화소', (_, pl) => {
    const px = { s: 2.77, tx: 33, ty: 600 };
    for (const deg of [4, 8]) {
      const cam = camAt(deg);
      const fr = planeFrame(cam, px, pl);
      for (const [X, Y] of [[100, 500], [700, 590], [300, 640]]) {
        const w = fr.Hw[0] * X + fr.Hw[1] * Y + fr.Hw[2];
        const P = { x: (fr.O[0] + X * fr.Ux[0] + Y * fr.Vy[0]) / w, y: (fr.O[1] + X * fr.Ux[1] + Y * fr.Vy[1]) / w, z: (fr.O[2] + X * fr.Ux[2] + Y * fr.Vy[2]) / w };
        expect((P.x - pl.O.x) * pl.n.x + (P.y - pl.O.y) * pl.n.y + (P.z - pl.O.z) * pl.n.z).toBeCloseTo(0, 6);
        const q = toPx(cam, px, P);
        expect(q.x).toBeCloseTo(X, 6);
        expect(q.y).toBeCloseTo(Y, 6);
      }
    }
  });
});
