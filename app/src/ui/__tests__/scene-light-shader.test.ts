/**
 * @jest-environment node
 */
// 빛 셰이더(SkSL)가 컴파일되고, 같은 점에서 JS 빛 모델(domain/light-model)과 같은 값을 내는지(CanvasKit으로 실제로 그려 읽는다).
import type { Book3, Vec3 } from '@/domain/book3';
import { BAND_IN, bakeLoss, bandOf, boxOf, DESIGN, EREF, FAR, gammaDodge, gammaMul, lightWithLoss, linearOf, packBoxes, skyLossAt, toEye, withCovers, type Band, type BoxBuf, type C3, type Env } from '@/domain/light-model';
import { SHELF_DEPTH, SHELF_THICK } from '@/domain/geometry';
import { bakeSource, bookSource, litSource, LOSS_OFF, LOSS_SCALE, planeFrame } from '../scene-light-sksl';
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
// 1×1 그림에 셰이더를 그려 회색 값(0~1)을 읽는다. child: 셰이더 자식(구운 그림 자리)
function draw(src: string, values: Record<string, number | number[]>, child = false): C3 {
  const err: string[] = [];
  const effect = CK.RuntimeEffect.Make(src, (e: string) => err.push(e));
  if (!effect) throw new Error(err.join('\n'));
  const uni = uniformArray(effect, values);
  const kids = child ? [CK.Shader.MakeColor(CK.Color4f(0, 0, 0, 1), CK.ColorSpace.SRGB)] : [];
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
function shaderLoss(P: Vec3, n: Vec3, env: Env | null, bx: BoxBuf, band: Record<string, number[]> = NO_BAND) {
  const { U, V } = axes(n);
  const g = draw(bakeSource(), {
    O: [P.x - 0.5e-3 * (U.x + V.x), P.y - 0.5e-3 * (U.y + V.y), P.z - 0.5e-3 * (U.z + V.z)],
    Ux: [U.x * 1e-3, U.y * 1e-3, U.z * 1e-3],
    Vy: [V.x * 1e-3, V.y * 1e-3, V.z * 1e-3],
    tN: [n.x, n.y, n.z],
    env: env ? [1, env.floor, env.ceil] : [0, 0, 0],
    box: bx.v,
    nBox: bx.list.length,
    selfIdx: -1,
    ...band,
  });
  return g.map((v) => v * LOSS_SCALE - LOSS_OFF) as C3;
}

// 그리는 셰이더(둘레 하늘 가림을 그 자리에서, liveEnv)의 곱하기·닷지 값: 평평한 면 P(법선 n), 눈 cam4
const CAM4 = [183, 300, 0, 4918];
function shaderLit(P: Vec3, n: Vec3, env: Env | null, dodge: boolean | 'direct', albedo: C3, base?: number[]) {
  const { U, V } = axes(n);
  return draw(
    litSource(dodge),
    {
      ...(base ? { base } : null),
      O: [P.x - 0.5e-3 * (U.x + V.x), P.y - 0.5e-3 * (U.y + V.y), P.z - 0.5e-3 * (U.z + V.z)],
      Ux: [U.x * 1e-3, U.y * 1e-3, U.z * 1e-3],
      Vy: [V.x * 1e-3, V.y * 1e-3, V.z * 1e-3],
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
    for (const src of [bakeSource(), litSource(false), litSource(true), litSource('direct'), bookSource(false), bookSource(true)]) {
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
    const edge = { x: 375, y: 200 - BAND_IN, z: SHELF_DEPTH };
    const near = lightWithLoss(edge, n, null, row, skyLossAt(edge, n, row, list), true, [1, 1, 1]).r;
    const bot = lit({ x: 375, y: 200 + 1e-6, z: SHELF_DEPTH });
    const mid = lit({ x: 375, y: 200 - BAND_IN + SHELF_THICK / 2, z: SHELF_DEPTH });
    const top = lit({ x: 375, y: 200 + SHELF_THICK - 1e-6, z: SHELF_DEPTH });
    // 위 줄에서 본 같은 띠(위 줄 둘레, 아래 판 띠): 가운데 값이 같다
    const upBand = bandOf(upper, row, false);
    for (let c = 0; c < 3; c++) {
      expect(bot[c]).toBeCloseTo(near[c], 3);
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
    const lt = lightWithLoss(P, n, toEye(cam, P), env, skyLossAt(P, n, env, []), true, EREF.wall);
    const mul = lt.r.map((r) => gammaMul(r)) as C3;
    const dodge = lt.r.map((r, c) => gammaDodge(r, lt.spec[c], albedo[c])) as C3;
    expect(maxDiff(shaderLit(P, n, env, false, albedo), mul)).toBeLessThan(1.5 / 255);
    expect(maxDiff(shaderLit(P, n, env, true, albedo), dodge)).toBeLessThan(1.5 / 255);
    // 한 번에 칠하기(단색 재질 base): base × 곱하기 / (1 − 닷지), 채널마다 1에서 자름(두 겹을 칠한 결과와 같다)
    const base = [0.99, 0.97, 0.945];
    const direct = base.map((b, c) => Math.min(1, (b * mul[c]) / Math.max(1e-4, 1 - dodge[c]))) as C3;
    expect(maxDiff(shaderLit(P, n, env, 'direct', albedo, base), direct)).toBeLessThan(2 / 255);
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
  const shader = (Q: Vec3, dodge: boolean) =>
    draw(
      bookSource(dodge),
      {
        cam4: CAM4, pxa: pxaOf(Q), bO: [bO.x, bO.y, bO.z], bX: [1, 0, 0], bY: [0, 1, 0], bZ: [0, 0, 1],
        dims: [d.T, d.H, d.W], rig: [bd, sp, sq], rect: new Array(24).fill(0), keyOn: 1, albedo: tone,
        env: [1, row.floor, row.ceil],
      },
      true,
    );
  // JS 기하: 면 평면 점 F(면 법선 nf)에서 광선을 이어 닿는 곳의 점·법선·반사율
  function expected(F: Vec3, nf: Vec3, hit: { P: Vec3; n: Vec3; a: C3 }, dodge: boolean): C3 {
    const loss = skyLossAt(F, nf, row, []);
    const lt = lightWithLoss(hit.P, hit.n, toEye(cam, hit.P), row, loss, true, hit.a === paper ? EREF.paper : EREF.book);
    return lt.r.map((r, c) => (dodge ? gammaDodge(r, lt.spec[c], hit.a[c]) : gammaMul(r))) as C3;
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
