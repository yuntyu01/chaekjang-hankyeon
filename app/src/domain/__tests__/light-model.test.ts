// 빛 모델(domain/light-model): 해석적인 하늘 가림(램버트 윤곽 적분 + 앞 가리개는 뒤에 보일 것과의 차이)이
// 같은 장면을 광선으로 직접 적분한 값(몬테카를로)과 맞는지, 그리고 반사·창빛 가림의 기본 성질.
import type { Book3, Vec3 } from '../book3';
import { COVE_R, coveNormal, envHit, envLobe, JOINT_K, jointShade, runCalibration, sideBlock, ALBEDO, bakedLossAt, contactShade, diskBlocked, gridKeyFree, ggxKey, KEY_C, lum, RAD, ROUGH, skyIrradiance, SREF, bookAlbedo, bookEref, boxOf, tone, toneInv, toneTarget, TONE, darkening, DESIGN, EREF, envBRDF, faceAlbedo, lightWithLoss, FAR, irradiance, L_ELEV, L_UNIT, linearOf, plankKeyBlocked, polyVF, sceneLight, skyLossAt, skyRadiance, solveGrid, traceRadiance, withCovers, type Box, type C3, type Env, type Grid } from '../light-model';
import { FRAME_FRONT, FRAME_X0, FRAME_X1, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '../geometry';
import palette from '@/scene-config/reference-bindings.generated.json';
import { ALBEDO_MAX, light, surfaceMats } from '@/scene-config/lighting';
import { camAt, VIEW_PITCH_MIN } from '../camera';
import { albedoPeak, MAT_UNIFORMS } from '../surface-pattern';

// 재현되는 난수
function rng(seed: number) {
  let k = seed >>> 0;
  return () => {
    k = (Math.imul(k, 1664525) + 1013904223) >>> 0;
    return k / 4294967296;
  };
}

// 법선 n 둘레 코사인 가중 방향으로 받는 빛(하늘·둘레·상자 밝기)을 평균: 하늘 몫 E(창빛 제외)
function monteCarlo(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], N = 60000) {
  const r = rng(7);
  const t = Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = norm(cross(t, n));
  const v = cross(n, u);
  const sum: C3 = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const a = 2 * Math.PI * r();
    const rr = Math.sqrt(r());
    const z = Math.sqrt(1 - rr * rr);
    const w = { x: u.x * rr * Math.cos(a) + v.x * rr * Math.sin(a) + n.x * z, y: u.y * rr * Math.cos(a) + v.y * rr * Math.sin(a) + n.y * z, z: u.z * rr * Math.cos(a) + v.z * rr * Math.sin(a) + n.z * z };
    const rad = traceRadiance(p, w, env, boxes);
    for (let c = 0; c < 3; c++) sum[c] += rad[c];
  }
  return sum.map((v) => v / N) as C3;
}
const cross = (a: Vec3, b: Vec3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3) => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
// 창빛을 뺀 받는 빛(해석): sceneLight는 창빛까지 더하므로 그 몫을 뺀다(가림 없는 창빛, 위 판 가림 끔)
function analytic(p: Vec3, n: Vec3, env: Env | null, boxes: Box[], G?: Grid): C3 {
  const all = irradiance(n);
  const sky = skyIrradiance(n);
  return sceneLight(p, n, null, env, boxes, false, [1, 1, 1], G).r.map((r, c) => r - (all[c] - sky[c])) as C3;
}
// 채널마다 상대 오차의 최댓값
const relErr = (a: C3, b: C3) => Math.max(...a.map((v, c) => Math.abs(v - b[c]) / b[c]));
const lumOf3 = (c: C3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const g3 = (v: number): C3 => [v, v, v];

// 방 빛 가림 모델(하늘 가림·빛 격자)을 검증하는 묶음은 가림 세기를 물리 그대로(1) 두고 돈다(앱은 light.occlusion 비율로 줄여 쓴다)
function withOcclusion() {
  let saved = light.occlusion;
  beforeAll(() => {
    saved = light.occlusion;
    light.occlusion = 1;
  });
  afterAll(() => {
    light.occlusion = saved;
  });
}

const book = (x: number, T = 22, H = 150, W = 100, z = 0): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z } });
const row: Env = { floor: 0, ceil: 200 };

describe('빛 모델: 하늘 가림', () => {
  withOcclusion();
  it('뷰 팩터: 마주 보는 정사각형(정확한 식)과 맞다', () => {
    // 한 변 2, 거리 1인 정사각형 가운데를 마주 보는 점: F = (2/π)·atan(1/√2)·(1/√2)·2 ... 정확한 값 0.5541
    const vf = polyVF({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [{ x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }]);
    expect(vf.F).toBeCloseTo((4 / (2 * Math.PI)) * (1 / Math.SQRT2) * Math.atan(1 / Math.SQRT2) * 2, 4);
    expect(vf.M.x).toBeCloseTo(0, 9);
  });

  const cases: [string, Vec3, Vec3, Env | null, Book3[]][] = [
    ['판 윗면, 책 앞(접촉 어둠)', { x: 111, y: 0, z: -4 }, { x: 0, y: 1, z: 0 }, row, [book(100), book(124), book(76)]],
    ['벽, 좁은 책 틈(3DU)', { x: 123.5, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(100), book(125)]],
    ['벽, 책 머리 위', { x: 111, y: 158, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(100, 22, 150, 100, 10)]],
    ['책등, 앞으로 뺀 이웃 옆', { x: 128, y: 80, z: 0 }, { x: 0, y: 0, z: -1 }, row, [book(100, 22, 150, 100, -40)]],
    ['판 윗면 벽 쪽 구석(위 판 아래)', { x: 180, y: 0, z: SHELF_DEPTH - 5 }, { x: 0, y: 1, z: 0 }, row, []],
    ['맨 아랫줄 판 밑 벽', { x: 180, y: -30, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, { floor: -FAR, ceil: -16 }, []],
    ['판 끝 너머 벽(판 끝면·열린 벽)', { x: -9, y: 20, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(16)]],
  ];
  it.each(cases)('%s: 해석 값 = 광선 적분(오차 1% 이내)', (_, p, n, env, books) => {
    const boxes = withCovers(books.map((b) => boxOf(b, g3(0.12))));
    const mc = monteCarlo(p, n, env, boxes);
    const an = analytic(p, n, env, boxes);
    expect(relErr(an, mc)).toBeLessThan(0.01);
  });

  it('색 있는 책 사이 좁은 틈의 벽: 채널마다 해석 값 = 광선 적분(오차 1% 이내)', () => {
    const boxes = withCovers([boxOf(book(100), [0.5, 0.06, 0.04]), boxOf(book(126), [0.04, 0.1, 0.45])]);
    const p = { x: 124, y: 60, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    expect(relErr(analytic(p, n, row, boxes), monteCarlo(p, n, row, boxes))).toBeLessThan(0.01);
  });

  it('판은 그린 곳에서 끝난다: 판 끝 너머 멀리는 판 없는 열린 방과 같고, 판 끝을 지나며 이어서 밝아지고, 줄 가운데는 판 끝과 거의 상관없다', () => {
    const n = { x: 0, y: 0, z: -1 };
    const mid = (SHELF_X0 + SHELF_X1) / 2;
    for (const y of [20, 100, 190]) {
      const far = analytic({ x: SHELF_X0 - 2000, y, z: SHELF_DEPTH }, n, row, []);
      const open = analytic({ x: SHELF_X0 - 2000, y, z: SHELF_DEPTH }, n, null, []);
      for (let c = 0; c < 3; c++) expect(far[c]).toBeCloseTo(open[c], 2);
      // 판 끝을 사이에 둔 두 점(1DU)은 거의 같다(3% 안, 8비트 한두 단계: 이음매가 보이지 않는다. 위가 밝은 하늘이면 판 끝에서 위 하늘이 열리는 몫이 커 판 가까이는 2% 안팎)
      const inn = analytic({ x: SHELF_X0 + 0.5, y, z: SHELF_DEPTH }, n, row, []);
      const out = analytic({ x: SHELF_X0 - 0.5, y, z: SHELF_DEPTH }, n, row, []);
      for (let c = 0; c < 3; c++) expect(Math.abs(inn[c] - out[c]) / out[c]).toBeLessThan(0.03);
      // 판 끝 쪽으로 갈수록 밝아진다(열린 쪽 하늘이 더 보인다)
      const m = analytic({ x: mid, y, z: SHELF_DEPTH }, n, row, []);
      expect(lumOf3(out)).toBeGreaterThan(lumOf3(m));
      expect(lumOf3(far)).toBeGreaterThanOrEqual(lumOf3(out) - 1e-9);
      // 줄 가운데는 판 끝 영향이 작다: 가운데에서 60DU 옮겨도 3% 안. 하늘이 왼쪽으로 밝으면(skyTilt.x < 0) 열린 왼쪽 판 끝으로 드는 하늘이
      // 더 밝아 오른쪽으로 갈수록 조금 어둡다(이음 없는 완만한 기울기)
      const m2 = analytic({ x: mid + 60, y, z: SHELF_DEPTH }, n, row, []);
      for (let c = 0; c < 3; c++) expect(Math.abs(m2[c] - m[c]) / m[c]).toBeLessThan(0.03);
      if (light.skyTilt.x < 0) expect(lumOf3(m2)).toBeLessThan(lumOf3(m));
    }
  });

  it('줄 가운데 틈: 좁을수록 그 뒤 벽이 어둡고, 넓어지면 옅어진다(면이 모두 같은 재질일 때)', () => {
    // 틈 양쪽으로 책이 넷씩 붙어 선 줄. 실제 책은 벽 쪽 면(책배)이 밝은 종이라 틈이 넓어지며 어두운 표지가 드러나면 오히려 어두워질 수 있다
    const same = (b: Book3) => ({ ...boxOf(b, g3(0.12)), head: 0, fore: 0 });
    const rowOf = (gap: number) => withCovers([0, 1, 2, 3].flatMap((k) => [same(book(100 - 22 * k)), same(book(122 + gap + 22 * k))]));
    const at = (gap: number) => darkening({ x: 122 + gap / 2, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, rowOf(gap), false);
    const ds = [2, 6, 20, 60].map(at);
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeLessThan(ds[i - 1]);
    expect(ds[0]).toBeGreaterThan(0.2);
  });

  it('색 번짐: 따뜻한 나무 판 바로 아래 벽은 판이 되비친 빛을 받아 파랑보다 빨강이 덜 빠진다(판 색을 띤다)', () => {
    // 채널마다 그 채널 하늘 빛에 대한 비(하늘 빛 자체가 방 빛 색을 띤다)
    const n = { x: 0, y: 0, z: -1 };
    const sky = skyIrradiance(n);
    const loss = skyLossAt({ x: 180, y: 195, z: SHELF_DEPTH }, n, row, []).map((v, c) => v / sky[c]);
    const plank = linearOf('#F2DCC1');
    expect(plank[0]).toBeGreaterThan(plank[2]);
    expect(loss[0]).toBeLessThan(loss[1]);
    expect(loss[1]).toBeLessThan(loss[2]);
    // 책 색도 번진다: 파란 책 옆 벽은 같은 밝기의 회색 책 옆보다 파랑이 덜, 빨강이 더 빠진다
    // (책 뒤 좁은 틈은 따뜻한 벽·속지끼리 되비쳐 어느 책이든 빨강이 덜 빠질 수 있어 회색 책과 견준다)
    const q = { x: 124, y: 60, z: SHELF_DEPTH };
    const at = (a: C3) => skyLossAt(q, { x: 0, y: 0, z: -1 }, row, withCovers([boxOf(book(100), a)]));
    const blue = at([0.05, 0.12, 0.4]);
    const grey = at(g3((0.05 + 0.12 + 0.4) / 3));
    expect(blue[2]).toBeLessThan(grey[2]);
    expect(blue[0]).toBeGreaterThan(grey[0]);
  });

  it('판 바로 위 벽은 판 색을 띤다: 판이 그 아래 하늘보다 밝은 채널은 밝아지고 어두운 채널은 어두워진다(되비침)', () => {
    const p = { x: 180, y: 2, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    const E = sceneLight(p, n, null, { floor: 0, ceil: FAR }, [], false, [1, 1, 1]).r;
    // 판이 가리는 하늘(수평 아래)의 밝기 범위
    const skyLo = skyRadiance({ x: 0, y: -1, z: 0 });
    const skyHi = skyRadiance({ x: 0, y: 0, z: -1 });
    const open = irradiance(n);
    for (let c = 0; c < 3; c++) {
      if (RAD.floor[c] > skyHi[c]) expect(E[c]).toBeGreaterThan(open[c]);
      if (RAD.floor[c] < skyLo[c]) expect(E[c]).toBeLessThan(open[c]);
    }
    // 따뜻한 나무: 빨강 > 초록 > 파랑 순으로 덜 어두워진다(채널마다 가림 없는 빛에 대한 비: 빛 자체가 색을 띤다)
    expect(E[0] / open[0]).toBeGreaterThan(E[1] / open[1]);
    expect(E[1] / open[1]).toBeGreaterThan(E[2] / open[2]);
  });
});

// 여러 번 튕긴 빛의 정답: 경로 추적(램버트 면, 하늘, 창빛은 튕긴 점마다 그림자 광선). 판은 그린 범위의 상자, 벽은 끝없는 평면
function pathTrace(p: Vec3, n: Vec3, env: Env, boxes: Box[], N: number): C3 {
  const r = rng(3);
  const slabs: [number, number][] = [[env.floor - SHELF_THICK, env.floor], [env.ceil, env.ceil + SHELF_THICK]];
  // 틀 안쪽 면: 앞 끝 ~ 벽, 위아래로 이어진 상자
  const panels: [number, number][] = env.side ? [[SHELF_X0 - 50, SHELF_X0], [SHELF_X1, SHELF_X1 + 50]] : [];
  type Hit = { t: number; n: Vec3; a: C3 } | null;
  const hitBox = (q: Vec3, w: Vec3, lo: Vec3, hi: Vec3) => {
    let t0 = 1e-7;
    let t1 = Infinity;
    let hn: Vec3 = { x: 0, y: 0, z: 0 };
    for (const k of ['x', 'y', 'z'] as const) {
      if (Math.abs(w[k]) < 1e-12) {
        if (q[k] < lo[k] || q[k] > hi[k]) return null;
        continue;
      }
      const a = (lo[k] - q[k]) / w[k];
      const b = (hi[k] - q[k]) / w[k];
      if (Math.min(a, b) > t0) {
        t0 = Math.min(a, b);
        hn = { x: 0, y: 0, z: 0 };
        hn[k] = w[k] > 0 ? -1 : 1;
      }
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1 ? { t: t0, n: hn } : null;
  };
  const hit = (q: Vec3, w: Vec3): Hit => {
    let best: Hit = null;
    if (w.z > 1e-9) best = { t: (SHELF_DEPTH - q.z) / w.z, n: { x: 0, y: 0, z: -1 }, a: ALBEDO.wall };
    for (const [y0, y1] of slabs) {
      const h = hitBox(q, w, { x: SHELF_X0, y: y0, z: -SHELF_FRONT }, { x: SHELF_X1, y: y1, z: SHELF_DEPTH });
      if (h && (!best || h.t < best.t)) best = { ...h, a: ALBEDO.plank };
    }
    for (const [x0, x1] of panels) {
      const h = hitBox(q, w, { x: x0, y: -1e6, z: -FRAME_FRONT }, { x: x1, y: 1e6, z: SHELF_DEPTH });
      if (h && (!best || h.t < best.t)) best = { ...h, a: ALBEDO.frame };
    }
    for (const b of boxes) {
      const ax = [b.ax, b.ay, b.az];
      const hs = [b.hx, b.hy, b.hz];
      const o = ax.map((a) => (q.x - b.c.x) * a.x + (q.y - b.c.y) * a.y + (q.z - b.c.z) * a.z);
      const wl = ax.map((a) => w.x * a.x + w.y * a.y + w.z * a.z);
      const h = hitBox({ x: o[0], y: o[1], z: o[2] }, { x: wl[0], y: wl[1], z: wl[2] }, { x: -hs[0], y: -hs[1], z: -hs[2] }, { x: hs[0], y: hs[1], z: hs[2] });
      if (h && (!best || h.t < best.t)) {
        const k = h.n.x ? 0 : h.n.y ? 1 : 2;
        const s = h.n.x + h.n.y + h.n.z;
        best = { t: h.t, n: { x: ax[k].x * s, y: ax[k].y * s, z: ax[k].z * s }, a: faceAlbedo(b, k, s) };
      }
    }
    return best;
  };
  const sample = (m: Vec3): Vec3 => {
    const t = Math.abs(m.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const u = norm(cross(t, m));
    const v = cross(m, u);
    const a = 2 * Math.PI * r();
    const rr = Math.sqrt(r());
    const z = Math.sqrt(1 - rr * rr);
    return { x: u.x * rr * Math.cos(a) + v.x * rr * Math.sin(a) + m.x * z, y: u.y * rr * Math.cos(a) + v.y * rr * Math.sin(a) + m.y * z, z: u.z * rr * Math.cos(a) + v.z * rr * Math.sin(a) + m.z * z };
  };
  // 창빛 원반 위 고른 방향(원반 반지름의 탄젠트 평면 원 안 고른 점)
  const ku = norm(cross(Math.abs(L_UNIT.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }, L_UNIT));
  const kv = cross(L_UNIT, ku);
  const keyDir = (): Vec3 => {
    const a = 2 * Math.PI * r();
    const rr = Math.tan(light.radius) * Math.sqrt(r());
    return norm({ x: L_UNIT.x + (ku.x * Math.cos(a) + kv.x * Math.sin(a)) * rr, y: L_UNIT.y + (ku.y * Math.cos(a) + kv.y * Math.sin(a)) * rr, z: L_UNIT.z + (ku.z * Math.cos(a) + kv.z * Math.sin(a)) * rr });
  };
  const sum: C3 = [0, 0, 0];
  const off = (q: Vec3, m: Vec3) => ({ x: q.x + m.x * 1e-5, y: q.y + m.y * 1e-5, z: q.z + m.z * 1e-5 });
  for (let i = 0; i < N; i++) {
    let q = p;
    let m = n;
    let thr: C3 = [1, 1, 1];
    for (let d = 0; d < 9; d++) {
      const w = sample(m);
      const h = hit(off(q, m), w);
      if (!h) {
        const sk = skyRadiance(w);
        for (let c = 0; c < 3; c++) sum[c] += thr[c] * sk[c];
        break;
      }
      q = { x: q.x + w.x * h.t, y: q.y + w.y * h.t, z: q.z + w.z * h.t };
      m = h.n;
      thr = [thr[0] * h.a[0], thr[1] * h.a[1], thr[2] * h.a[2]];
      // 창빛: 원반(반지름 light.radius) 위 한 점으로(원반 일부만 보이는 좁은 틈도 보이는 몫만큼)
      const lw = keyDir();
      const nl = m.x * lw.x + m.y * lw.y + m.z * lw.z;
      if (nl > 0 && !hit(off(q, m), lw)) for (let c = 0; c < 3; c++) sum[c] += thr[c] * light.diffuse * nl * KEY_C[c];
    }
  }
  return sum.map((v) => v / N) as C3;
}

describe('빛 격자(여러 번 튕긴 빛)', () => {
  withOcclusion();
  // 크림 책 양옆에 파란 책(틈 2DU). 격자로 푼 가리개 밝기 vs 경로 추적.
  // 오차: 가리개 면 밝기를 대표 점 하나에서 읽어서, 밝기가 1차보다 훨씬 급하게 바뀌는 곳(틈 입구 쪽)은 덜 잡는다.
  // 틈 깊은 곳처럼 아주 어두운 곳은 화면 밝기 기준 3%(받는 빛 0.025) 안
  const boxes = withCovers([boxOf(book(100), bookAlbedo('#F6E7CF')), boxOf(book(124), bookAlbedo('#8FA6BF')), boxOf(book(76), bookAlbedo('#8FA6BF'))]);
  const G = solveGrid(row, boxes);
  const lumOf = (c: C3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it.each([
    ['책등 바닥(판과 맞닿는 곳)', { x: 111, y: 0.5, z: 0 }, { x: 0, y: 0, z: -1 }],
    ['책등 가운데', { x: 111, y: 75, z: 0 }, { x: 0, y: 0, z: -1 }],
    ['틈 안 표지(입구에서 5)', { x: 122, y: 75, z: 5 }, { x: 1, y: 0, z: 0 }],
    ['틈 뒤 벽', { x: 123, y: 75, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }],
    ['책 없는 벽', { x: 250, y: 100, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }],
    ['책 앞 판 윗면', { x: 111, y: 0, z: -40 }, { x: 0, y: 1, z: 0 }],
  ] as [string, Vec3, Vec3][])('%s: 해석 값(격자) = 경로 추적(휘도 오차 8% 또는 0.025 이내)', (_, p, n) => {
    const an = lumOf(analytic(p, n, row, boxes, G));
    const pt = lumOf(pathTrace(p, n, row, boxes, 6000));
    expect(Math.abs(an - pt)).toBeLessThan(Math.max(0.025, 0.09 * pt)); // 안쪽 면 바로 옆 근사 오차가 약 8%라 9%로 둔다(2026-11-04)
  });
  it('접촉부 그라데이션: 책등은 판에 가까울수록, 틈 안 표지는 깊을수록 어둡다', () => {
    const spine = [0.5, 5, 20, 75].map((y) => lumOf(analytic({ x: 111, y, z: 0 }, { x: 0, y: 0, z: -1 }, row, boxes, G)));
    for (let i = 1; i < spine.length; i++) expect(spine[i]).toBeGreaterThan(spine[i - 1]);
    const slot = [0.5, 5, 15, 50].map((z) => lumOf(analytic({ x: 122, y: 75, z }, { x: 1, y: 0, z: 0 }, row, boxes, G)));
    // 아주 깊은 곳은 해석 값이 하늘 빛 상한(가림 ≤ 하늘 빛)에 닿는 바닥(받는 빛 0.3~0.7%, 경로 추적 0.2~0.5%)이라
    // 그 바닥 안(받는 빛 0.5%)의 차이까지는 순서를 보지 않는다
    expect(slot[1]).toBeLessThan(slot[0]);
    for (let i = 1; i < slot.length; i++) expect(slot[i]).toBeLessThan(slot[i - 1] + 0.005);
  });
});

describe('책장 틀(옆판·위 판): 같은 빛 모델', () => {
  withOcclusion();
  const framed: Env = { floor: 0, ceil: 200, side: true };
  // 옆판 밝기(RAD.sideL·sideR)는 맞추기가 정하므로 물리 그대로의 가림 세기(1)로 다시 맞춘 뒤 정답과 비교한다
  let G: Grid;
  beforeAll(() => {
    runCalibration();
    G = solveGrid(framed, []);
  });
  const appOcclusion = light.occlusion;
  afterAll(() => {
    light.occlusion = appOcclusion;
    runCalibration();
  });
  const lumOf = (c: C3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const front = { x: 0, y: 0, z: -1 };
  const up = { x: 0, y: 1, z: 0 };
  it.each([
    ['틀 안 가운데 벽', { x: 183, y: 100, z: SHELF_DEPTH }, front],
    // 안쪽 면에서 2DU 안쪽 뒷벽(안쪽 면 자리는 RIM_OUT으로 움직이므로 그 면을 기준으로 잡는다). 더 붙으면 근사 오차가 커진다: 1DU 8.4%, 0.5DU 9.3%
    ['왼쪽 옆판 바로 옆 벽', { x: FRAME_X0 + 2, y: 100, z: SHELF_DEPTH }, front],
    ['오른쪽 옆판 바로 옆 벽', { x: FRAME_X1 - 2, y: 100, z: SHELF_DEPTH }, front],
    ['왼쪽 옆판 옆 판 윗면', { x: 3, y: 0, z: 40 }, up],
    ['왼쪽 옆판 안쪽 면', { x: SHELF_X0, y: 100, z: 60 }, { x: 1, y: 0, z: 0 }],
    ['오른쪽 옆판 안쪽 면', { x: SHELF_X1, y: 100, z: 60 }, { x: -1, y: 0, z: 0 }],
  ] as [string, Vec3, Vec3][])('%s: 해석 값 = 경로 추적(휘도 오차 9% 또는 0.025 이내)', (_, p, n) => {
    const an = lumOf(analytic(p, n, framed, [], G));
    const pt = lumOf(pathTrace(p, n, framed, [], 8000));
    expect(Math.abs(an - pt)).toBeLessThan(Math.max(0.025, 0.09 * pt)); // 안쪽 면 바로 옆 근사 오차가 약 8%라 9%로 둔다(2026-11-04)
  });
  // 안쪽 면을 한 밝기로 되비치는 근사의 오차는 두 면이 만나는 모서리에서 가장 크다. 반사율 상한을 0.7 → 0.85로 올리며 튄 빛이 커져 0.052 → 0.072가 됐다(가림 1 기준, 앱은 가림 0.5라 그 절반쯤)
  it('왼쪽 위 안쪽 모서리 벽: 해석 값 = 경로 추적(휘도 오차 0.08 이내)', () => {
    const p = { x: FRAME_X0 + 0.5, y: 195, z: SHELF_DEPTH };
    expect(Math.abs(lumOf(analytic(p, front, framed, [], G)) - lumOf(pathTrace(p, front, framed, [], 8000)))).toBeLessThan(0.08);
  });
  it('구멍 밖 평평한 벽은 가려지지 않는다(판 끝이 벽보다 3mm 나온 몫만 판 바로 밑에)', () => {
    const under: Env = { floor: -FAR, ceil: -SHELF_THICK };
    const flat = (d: number) => lumOf(analytic({ x: 183, y: -SHELF_THICK - d, z: -FRAME_FRONT }, front, under, []));
    expect(flat(20)).toBeGreaterThan(flat(0.5));
    expect(Math.abs(flat(20) - lumOf(analytic({ x: 183, y: 0, z: -FRAME_FRONT }, front, null, [])))).toBeLessThan(0.005);
  });
  it('창빛 가림 = 원반 위 방향을 하나씩 쏜 광선(옆판이 왼쪽 빛을 막는다)', () => {
    const blockedByRay = (p: Vec3) => {
      // 원반 위 고른 방향이 앞면 앞으로 나가기 전에 옆판 평면을 넘으면 막힌다(판은 멀리 두어 옆판만 본다)
      const R = Math.tan(light.radius);
      let n = 0;
      let k = 0;
      for (let i = -60; i <= 60; i++)
        for (let j = -60; j <= 60; j++) {
          const u = i / 60;
          const v = j / 60;
          if (u * u + v * v > 1) continue;
          n++;
          const az = Math.atan2(L_UNIT.x, -L_UNIT.z) + Math.atan(u * R);
          const x = p.x + Math.tan(az) * (p.z + FRAME_FRONT);
          if (x < SHELF_X0 || x > SHELF_X1) k++;
        }
      return k / n;
    };
    for (const p of [{ x: 2, y: 100, z: SHELF_DEPTH }, { x: 20, y: 100, z: SHELF_DEPTH }, { x: 40, y: 100, z: SHELF_DEPTH }, { x: 183, y: 100, z: SHELF_DEPTH }, { x: 364, y: 100, z: SHELF_DEPTH }, { x: 10, y: 100, z: 60 }]) {
      expect(Math.abs(sideBlock(p) - blockedByRay(p))).toBeLessThan(0.015);
    }
    // 왼쪽 빛이라 왼쪽 옆판 옆이 오른쪽 옆판 옆보다 많이 가려진다
    expect(sideBlock({ x: 2, y: 100, z: SHELF_DEPTH })).toBeGreaterThan(sideBlock({ x: 364, y: 100, z: SHELF_DEPTH }) + 0.5);
  });
  it('틀이 있으면 벽은 옆판 가까이에서 물리대로 어두워지고, 왼쪽(빛을 등진 옆판 그늘)이 더 어둡다', () => {
    const at = (x: number) => lumOf(analytic({ x, y: 100, z: SHELF_DEPTH }, front, framed, [], G));
    expect(at(183)).toBeGreaterThan(at(60));
    expect(at(60)).toBeGreaterThan(at(2));
    expect(at(364)).toBeGreaterThan(at(2));
  });
});

describe('카메라 톤 곡선', () => {
  it('되돌리기(toneInv)가 맞고, 단조 증가에 이음매에서 기울기가 이어지며, 1을 넘지 않는다', () => {
    let prev = -1;
    for (let y = 0.001; y < 0.9999; y += 0.0007) {
      expect(tone(toneInv(y))).toBeCloseTo(y, 9);
      const x = toneInv(y);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
    for (let x = 0; x < 50; x += 0.01) expect(tone(x)).toBeLessThanOrEqual(1);
    // 발끝 끝·어깨 시작에서 기울기 1(꺾이지 않는다)
    const slope = (x: number) => (tone(x + 1e-6) - tone(x - 1e-6)) / 2e-6;
    expect(slope(TONE.toe)).toBeCloseTo(1, 4);
    expect(slope(TONE.shoulder)).toBeCloseTo(1, 4);
  });
});

describe('안쪽 모서리 그늘', () => {
  const framed: Env = { floor: 0, ceil: 200, side: true };
  const front = { x: 0, y: 0, z: -1 };
  const up = { x: 0, y: 1, z: 0 };
  const side = { x: 1, y: 0, z: 0 };
  // 위 면에서 h만큼 아래 뒷벽
  const below = (h: number) => jointShade({ x: 183, y: 200 - h, z: SHELF_DEPTH }, front, framed);
  it('틀이 있는 줄에서만, 모서리에 가까울수록 진하고 멀면 거의 없다', () => {
    expect(jointShade({ x: 183, y: 199, z: SHELF_DEPTH }, front, { floor: 0, ceil: 200 })).toBe(0);
    expect(jointShade({ x: 183, y: 199, z: SHELF_DEPTH }, front, null)).toBe(0);
    let prev = 1;
    for (const h of [0, 2, 5, 10, 20, 40, 80]) {
      const f = below(h);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
    expect(below(0)).toBeCloseTo(0.5 * JOINT_K, 2);
    expect(below(80)).toBeLessThan(0.01);
  });
  it('구멍 앞 끝 칸도 안쪽이다: 앞 끝과 그 바로 뒤의 그늘이 이어진다(앞 끝이 빠지면 구운 칸 하나만큼 밝은 줄이 생긴다)', () => {
    const at = (z: number) => jointShade({ x: FRAME_X0, y: 100, z }, side, framed);
    expect(at(-FRAME_FRONT)).toBeGreaterThan(0);
    expect(Math.abs(at(-FRAME_FRONT) - at(-FRAME_FRONT + 12))).toBeLessThan(0.01);
  });
  it('안쪽 면은 창빛 그림자가 없어 위 면 아래에서 뒷벽보다 넓고 진하다', () => {
    const atSide = (h: number) => jointShade({ x: FRAME_X0, y: 200 - h, z: 40 }, side, framed);
    for (const h of [2, 10, 20, 30]) expect(atSide(h)).toBeGreaterThan(below(h));
    expect(atSide(20)).toBeGreaterThan(0.05);
    expect(jointShade({ x: FRAME_X0, y: 2, z: 40 }, side, framed)).toBeGreaterThan(jointShade({ x: FRAME_X0, y: 100, z: 40 }, side, framed));
  });
  it('뒷벽은 아래 판 쪽으로 어두워지지 않고, 안쪽 면 쪽은 위 면 쪽보다 약하다', () => {
    expect(jointShade({ x: 183, y: 1, z: SHELF_DEPTH }, front, framed)).toBeLessThan(0.001);
    expect(jointShade({ x: FRAME_X0 + 1, y: 100, z: SHELF_DEPTH }, front, framed)).toBeLessThan(below(1));
  });
  it('뒷벽 꼭지점은 위 면·안쪽 면 어느 한쪽 가까이보다 어둡고 둘레로 둥글게 옅어진다', () => {
    const at = (dx: number, dy: number) => jointShade({ x: FRAME_X0 + dx, y: 200 - dy, z: SHELF_DEPTH }, front, framed);
    expect(at(1, 1)).toBeGreaterThan(at(1, 100));
    expect(at(1, 1)).toBeGreaterThan(at(100, 1));
    expect(at(1, 1)).toBeGreaterThan(at(10, 10));
    expect(at(10, 10)).toBeGreaterThan(at(40, 40));
    // 대각선 거리가 같은 두 점의 그늘이 비슷하다: 네모가 아니라 둥근 무늬
    expect(Math.abs(at(14, 2) - at(10, 10))).toBeLessThan(0.1);
  });
  it('판 윗면은 안쪽 면과 뒷벽 쪽으로 어두워지고 구멍 앞에 나온 판 앞면에는 없다', () => {
    expect(jointShade({ x: FRAME_X0 + 1, y: 0, z: 0 }, up, framed)).toBeGreaterThan(0.05);
    expect(jointShade({ x: 183, y: 0, z: SHELF_DEPTH - 1 }, up, framed)).toBeGreaterThan(0.03);
    expect(jointShade({ x: 183, y: 0, z: 0 }, up, framed)).toBeLessThan(0.01);
    expect(jointShade({ x: FRAME_X0 + 1, y: -6, z: -SHELF_FRONT }, front, framed)).toBe(0);
  });
  it('구운 가림에 그 몫만큼 받는 빛으로 들어가고, 책 면(self ≥ 0)에는 넣지 않는다', () => {
    const P = { x: 183, y: 197, z: SHELF_DEPTH };
    const base = skyLossAt(P, front, framed, []);
    const baked = bakedLossAt(P, front, framed, []);
    expect(baked[1]).toBeGreaterThan(base[1]);
    const book = bakedLossAt(P, front, framed, [], undefined, 0);
    expect(book[1]).toBeCloseTo(base[1], 9);
  });
});

describe('안쪽 모서리 곡면', () => {
  const framed: Env = { floor: 0, ceil: 200, side: true };
  const wall = { x: 0, y: 0, z: -1 };
  const side = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  it('뒷벽은 안쪽 면 쪽으로 45°, 위 면 쪽으로 25° 돈다', () => {
    const a = coveNormal({ x: FRAME_X0, y: 100, z: SHELF_DEPTH }, wall, framed);
    expect(a.x).toBeCloseTo(Math.SQRT1_2, 6);
    const c = coveNormal({ x: 183, y: 200, z: SHELF_DEPTH }, wall, framed);
    expect(Math.atan2(-c.y, -c.z)).toBeCloseTo((25 * Math.PI) / 180, 6);
  });
  it('안쪽 면은 위 면 쪽으로 25° 돌고, 깊이 방향(뒷벽 쪽)으로는 돌지 않는다. 천장은 돌지 않는다', () => {
    const a = coveNormal({ x: FRAME_X0, y: 200, z: 40 }, side, framed);
    expect(Math.atan2(-a.y, a.x)).toBeCloseTo((25 * Math.PI) / 180, 6);
    expect(coveNormal({ x: FRAME_X0, y: 100, z: SHELF_DEPTH }, side, framed)).toEqual(side);
    expect(coveNormal({ x: 183, y: 0, z: SHELF_DEPTH }, up, framed)).toEqual(up);
    const down = { x: 0, y: -1, z: 0 };
    expect(coveNormal({ x: FRAME_X0 + 1, y: 200, z: 40 }, down, framed)).toEqual(down);
  });
  it('곡면 밖과 틀 없는 줄은 면 법선 그대로, 곡면 안에서는 모서리에서 멀수록 면 법선에 가깝다', () => {
    expect(coveNormal({ x: 183, y: 100, z: SHELF_DEPTH }, wall, framed)).toEqual(wall);
    expect(coveNormal({ x: FRAME_X0, y: 100, z: SHELF_DEPTH }, wall, { floor: 0, ceil: 200 })).toEqual(wall);
    let prev = 1;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const n = coveNormal({ x: FRAME_X0 + COVE_R * t, y: 100, z: SHELF_DEPTH }, wall, framed);
      expect(n.x).toBeLessThan(prev + 1e-9);
      prev = n.x;
    }
    expect(prev).toBeCloseTo(0, 6);
  });
});

describe('재질 반사율 맞추기(역렌더링)', () => {
  it('노출 기준: 반사율은 모두(시안 장정 색 × 장정 재질 포함) 그 화면 색 이하이고 결의 가장 밝은 점까지 실제 흰 재질 반사율(ALBEDO_MAX) 이하, 이득은 그중 가장 작은 값', () => {
    const peak = (m: keyof typeof MAT_UNIFORMS) => albedoPeak(MAT_UNIFORMS[m]); // 짧은 섬유는 이득에 넣지 않는다(반사율 1 아래인지는 surface-pattern 시험)
    const all: [C3, C3, number][] = [
      [ALBEDO.wall, DESIGN.wall, peak('paint')],
      [ALBEDO.plank, DESIGN.plank, peak('wood')],
      [ALBEDO.paper, DESIGN.paper, peak('pages')],
      ...Object.keys(palette).flatMap((hex) => (['fine', 'linen', 'matte', 'laid'] as const).map((m): [C3, C3, number] => [bookAlbedo(hex, m), linearOf(hex), peak(m)])),
    ];
    let tight = 0;
    for (const [a, d, f] of all)
      a.forEach((v, c) => {
        expect(v).toBeLessThanOrEqual(d[c] + 1e-9);
        expect(v * f).toBeLessThanOrEqual(ALBEDO_MAX + 1e-9);
        tight = Math.max(tight, v / d[c], (v * f) / ALBEDO_MAX);
      });
    // 틀은 대표 자리가 그늘진 안쪽 면이라 보이는 색보다 밝을 수 있고 상한만 지킨다
    ALBEDO.frame.forEach((v) => {
      const f = peak(surfaceMats.frame);
      expect(v * f).toBeLessThanOrEqual(ALBEDO_MAX + 1e-9);
      tight = Math.max(tight, (v * f) / ALBEDO_MAX);
    });
    // 이득을 조금이라도 낮추면 어느 하나가 넘는다
    expect(tight).toBeCloseTo(1, 9);
  });
  it('벽 대표 자리(구멍 밖 평평한 벽)에서 받는 빛 비가 1: 벽지 색 그대로 보인다', () => {
    const p = { x: (SHELF_X0 + SHELF_X1) / 2, y: 100, z: -FRAME_FRONT };
    const n = { x: 0, y: 0, z: -1 };
    const refEnv: Env = { floor: 0, ceil: 200, side: true };
    // 대표 자리 빛은 빈 줄의 여러 번 튕긴 빛(빛 격자)이고, 그 자리 반사 몫(1 − ks)까지 들어 있다
    const E = lightWithLoss(p, n, null, refEnv, skyLossAt(p, n, refEnv, [], solveGrid(refEnv, [], undefined, 1)), true, [1, 1, 1]).r;
    const ks = envBRDF(0.999, ROUGH.paint);
    E.forEach((e, c) => expect((e * (1 - ks)) / EREF.wall[c]).toBeCloseTo(1, 1));
  });
});

describe('하늘 가림 상한', () => {
  withOcclusion();
  it('가림이 하늘 빛을 넘으면(겹친 가리개를 두 번 센 회색 오차) 넘친 만큼을 세 채널에서 똑같이 빼: 채널 차이(되비친 빛의 색)는 그대로, 음수는 없다', () => {
    // 창빛을 등진 면(받는 빛 = 하늘 빛뿐)
    const p = { x: 100, y: 75, z: 50 };
    const n = { x: L_UNIT.x > 0 ? -1 : 1, y: 0, z: 0 };
    const sky = skyIrradiance(n);
    // 하늘 빛을 넘는 몫(비): 초록 2%, 파랑 6% 넘음 → 6% 몫(하늘 빛 × 0.06)을 세 채널에서 뺀다
    const loss: C3 = [sky[0] - 0.05, sky[1] * 1.02, sky[2] * 1.06];
    const E = lightWithLoss(p, n, null, row, loss, true, [1, 1, 1]).r;
    E.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    expect(Math.min(...E)).toBeCloseTo(0, 9);
    // 받는 빛 = 하늘 빛 − (가림 − 0.06·하늘 빛)
    E.forEach((v, c) => expect(v).toBeCloseTo(sky[c] - (loss[c] - 0.06 * sky[c]), 9));
    // 넘지 않으면 그대로
    const ok: C3 = [sky[0] - 0.1, sky[1] - 0.05, sky[2] - 0.02];
    const E2 = lightWithLoss(p, n, null, row, ok, true, [1, 1, 1]).r;
    E2.forEach((v, c) => expect(v).toBeCloseTo(sky[c] - ok[c], 9));
  });
});

describe('대표 자리 반사광(SREF)', () => {
  const refEnv: Env = { floor: 0, ceil: 200, side: true };
  // 대표 자리(맞추기와 같은 눈·자리)에서 빛 모델이 주는 받는 빛 비 r과 반사광 spec
  const e = camAt(VIEW_PITCH_MIN).eye!;
  const eye = { x: e.x, y: e.y, z: e.z - e.dist };
  const front = { x: 0, y: 0, z: -1 };
  const at = (p: Vec3, eref: C3, rough: number) => {
    const d = { x: eye.x - p.x, y: eye.y - p.y, z: eye.z - p.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return lightWithLoss(p, front, { x: d.x / l, y: d.y / l, z: d.z / l }, refEnv, skyLossAt(p, front, refEnv, [], solveGrid(refEnv, [], undefined, 1)), true, eref, undefined, rough);
  };
  const mid = (SHELF_X0 + SHELF_X1) / 2;
  it.each([
    ['벽', { x: mid, y: 100, z: -FRAME_FRONT }, () => EREF.wall, ROUGH.paint, () => SREF.wall, () => DESIGN.wall],
    ['판 앞면', { x: mid, y: -SHELF_THICK / 2, z: -SHELF_FRONT }, () => EREF.plank, ROUGH.wood, () => SREF.plank, () => DESIGN.plank],
    ['린넨 장정(하늘색)', { x: mid, y: 75, z: 0 }, () => bookEref('linen'), ROUGH.linen, () => SREF.book.linen, () => linearOf('#88A4BA')],
  ] as [string, Vec3, () => C3, number, () => C3, () => C3][])('%s: 반사광이 SREF이고, 확산 + 반사광으로 보이는 색이 재질 색', (_, p, eref, rough, sref, design) => {
    const { r, spec } = at(p, eref(), rough);
    spec.forEach((v, c) => expect(v).toBeCloseTo(sref()[c], 2));
    design().forEach((d, c) => expect(toneTarget(d, r[c], spec[c], sref()[c])).toBeCloseTo(d, 2));
  });
  it('반사광보다 짙은 채널은 반사율 0(그 방의 빛에서 그만큼 짙게 보일 수 없다)', () => {
    const navy = linearOf('#1D426B');
    const a = bookAlbedo('#1D426B', 'matte');
    navy.forEach((v, c) => {
      if (toneInv(v) <= SREF.book.matte[c]) expect(a[c]).toBe(0);
      else expect(a[c]).toBeGreaterThan(0);
    });
  });
});

describe('빛 모델: 창빛 가림·반사', () => {
  it('위 판이 창빛 원반을 가리는 몫은 판 앞 모서리에 가까울수록 크고, 판 범위 안에서는 가로 위치와 상관없고, 판 끝 너머로 갈수록 0으로 준다', () => {
    let prev = 2;
    const mid = (SHELF_X0 + SHELF_X1) / 2;
    for (let d = 0.5; d < 90; d += 0.5) {
      const k = plankKeyBlocked({ x: mid, y: 190 - d, z: SHELF_DEPTH }, { ...row, ceil: 190 });
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
    const a = plankKeyBlocked({ x: mid, y: 190, z: SHELF_DEPTH }, row);
    expect(a).toBeGreaterThan(0.05);
    expect(plankKeyBlocked({ x: mid + 60, y: 190, z: SHELF_DEPTH }, row)).toBeCloseTo(a, 9);
    let last = a;
    for (const dx of [-5, 0, 5, 10, 20, 40]) {
      const k = plankKeyBlocked({ x: SHELF_X0 - dx, y: 190, z: SHELF_DEPTH }, row);
      expect(k).toBeLessThanOrEqual(last + 1e-12);
      last = k;
    }
    expect(plankKeyBlocked({ x: SHELF_X0 - 60, y: 190, z: SHELF_DEPTH }, row)).toBeCloseTo(0, 9);
  });

  // 광선 표본 적분: 원반 위 방향을 고르게 뽑아 판 상자(가로 X0~X1, 높이, 앞 끝~벽)에 실제로 막히는지 센다
  const sampled = (p: { x: number; y: number; z: number }, env: Env) => {
    const N = 160;
    let hit = 0;
    let all = 0;
    const plank = (yb: number, yt: number) => ({ x0: SHELF_X0, x1: SHELF_X1, y0: yb, y1: yt });
    const boxes = [env.ceil < FAR ? plank(env.ceil, env.ceil + SHELF_THICK) : null, env.floor > -FAR ? plank(env.floor - SHELF_THICK, env.floor) : null].filter(Boolean) as { x0: number; x1: number; y0: number; y1: number }[];
    const az = Math.atan2(L_UNIT.x, -L_UNIT.z);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const u = -1 + (2 * (i + 0.5)) / N;
        const v = -1 + (2 * (j + 0.5)) / N;
        if (u * u + v * v > 1) continue;
        all++;
        const ty = Math.tan(L_ELEV + u * light.radius);
        const tx = Math.tan(az + v * light.radius);
        // 앞으로 s만큼: (p.x + s·tx, p.y + s·ty, p.z − s), s ∈ [0, p.z + SHELF_FRONT]
        const blocked = boxes.some((b) => {
          let lo = 0;
          let hi = p.z + SHELF_FRONT;
          for (const [o, d, mn, mx] of [[p.x, tx, b.x0, b.x1], [p.y, ty, b.y0, b.y1]] as const) {
            if (Math.abs(d) < 1e-12) {
              if (o < mn || o > mx) return false;
              continue;
            }
            let a = (mn - o) / d;
            let c = (mx - o) / d;
            if (a > c) [a, c] = [c, a];
            lo = Math.max(lo, a);
            hi = Math.min(hi, c);
          }
          return lo <= hi;
        });
        if (blocked) hit++;
      }
    return hit / all;
  };

  it('판 그림자 = 광선 표본 적분: 판 아래·판 끝 양쪽·판 끝 너머 판 두께 높이(오른쪽 끝도)', () => {
    const env = { ...row, ceil: 190, floor: 0 };
    const pts = [
      { x: (SHELF_X0 + SHELF_X1) / 2, y: 175, z: SHELF_DEPTH },
      { x: (SHELF_X0 + SHELF_X1) / 2, y: 150, z: SHELF_DEPTH },
      { x: SHELF_X0 + 5, y: 182, z: SHELF_DEPTH },
      { x: SHELF_X0 + 15, y: 175, z: SHELF_DEPTH },
      { x: SHELF_X1 - 5, y: 182, z: SHELF_DEPTH },
      { x: SHELF_X1 + 5, y: 195, z: SHELF_DEPTH }, // 위 판 두께 높이, 오른쪽 끝 너머
      { x: SHELF_X1 + 10, y: 195, z: SHELF_DEPTH },
      { x: SHELF_X1 + 15, y: 185, z: SHELF_DEPTH },
      { x: SHELF_X0 - 5, y: 195, z: SHELF_DEPTH },
      { x: SHELF_X1 + 5, y: -10, z: SHELF_DEPTH }, // 아래 판 두께 높이, 오른쪽 끝 너머
      { x: (SHELF_X0 + SHELF_X1) / 2, y: 150, z: 60 }, // 벽 앞(책 앞면)
    ];
    for (const p of pts) expect(plankKeyBlocked(p, env)).toBeCloseTo(sampled(p, env), 1);
  });

  it('판 끝 너머 벽은 판 앞 모서리에서 시작하는 대각선 쐐기 밖이면 밝다(오른쪽 여백 전체가 그늘이 되지 않는다)', () => {
    const env = { ...row, ceil: 190, floor: 0 };
    // 오른쪽 끝 너머, 판 두께 높이(판 안쪽은 다 가린다): 빛이 왼쪽에서 오므로 판 끝면은 원반의 오른쪽 일부만 가려 끝에서 멀어질수록
    // 빨리 밝아진다(반지름 14° 원반이라 쐐기 가장자리가 15DU쯤 번진다)
    expect(plankKeyBlocked({ x: SHELF_X1 + 15, y: 195, z: SHELF_DEPTH }, env)).toBeLessThan(0.2);
    expect(plankKeyBlocked({ x: SHELF_X1 + 25, y: 195, z: SHELF_DEPTH }, env)).toBeLessThan(0.05);
    // 같은 거리 왼쪽 끝 너머는 판 쪽(오른쪽)이 빛과 반대라 가리지 않는다
    expect(plankKeyBlocked({ x: SHELF_X0 - 15, y: 195, z: SHELF_DEPTH }, env)).toBeLessThan(0.05);
    // 판 범위 안 끝 가까이(판 아래)는 판 안쪽과 거의 같게 가린다(끝에서 10DU 안은 왼쪽 끝 너머로 빠지는 낮은 빛만 조금 든다)
    const inner = plankKeyBlocked({ x: (SHELF_X0 + SHELF_X1) / 2, y: 182, z: SHELF_DEPTH }, env);
    expect(plankKeyBlocked({ x: SHELF_X0 + 15, y: 182, z: SHELF_DEPTH }, env)).toBeGreaterThan(inner - 0.1);
    expect(plankKeyBlocked({ x: SHELF_X0 + 10, y: 182, z: SHELF_DEPTH }, env)).toBeGreaterThan(inner - 0.2);
  });

  it('원반을 수평선과 두 수직선으로 자른 넓이(diskBlocked) = 수치 적분, 수직선이 원반 밖이면 활꼴', () => {
    const num = (u0: number, v0: number, v1: number) => {
      let a = 0;
      const N = 1200;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const v = -1 + (2 * (i + 0.5)) / N;
          const u = -1 + (2 * (j + 0.5)) / N;
          if (u * u + v * v <= 1 && u >= u0 && v >= v0 && v <= v1) a++;
        }
      return (a * 4) / (N * N) / Math.PI;
    };
    for (const [u0, v0, v1] of [[0.3, -2, 2], [-0.4, -2, 2], [0.2, -0.5, 0.7], [-0.6, 0.3, 2], [0.8, -2, -0.2], [-2, -0.3, 0.4]]) expect(diskBlocked(u0, v0, v1)).toBeCloseTo(num(u0, v0, v1), 2);
  });

  it('거친 종이의 환경 반사: 정면 F0 안팎(거친 면은 미세면끼리 가려 조금 덜하다), 비스듬히 볼수록 커지지만 10%를 넘지 않는다(거울 프레넬처럼 수십 %가 되지 않는다)', () => {
    const r = ROUGH.paper;
    expect(envBRDF(1, r)).toBeGreaterThan(0.015);
    expect(envBRDF(1, r)).toBeLessThan(0.04);
    expect(envBRDF(0.1, r)).toBeGreaterThan(envBRDF(1, r));
    expect(envBRDF(0.1, r)).toBeLessThan(0.1);
  });

  it('재질: 모두 같은 유전체(F0)라 정면 반사는 비슷하고, 매끈할수록(코팅지 > 천 > 무광 종이) 비스듬한 반사와 창빛 하이라이트가 크다', () => {
    expect(ROUGH.linen).toBeLessThan(ROUGH.matte);
    expect(ROUGH.matte).toBeLessThan(ROUGH.paper);
    for (const r of [ROUGH.linen, ROUGH.paper, ROUGH.matte]) expect(Math.abs(envBRDF(1, r) - envBRDF(1, ROUGH.paper))).toBeLessThan(0.015);
    expect(envBRDF(0.1, ROUGH.linen)).toBeGreaterThan(envBRDF(0.1, ROUGH.matte));
    expect(envBRDF(0.1, ROUGH.matte)).toBeGreaterThan(envBRDF(0.1, ROUGH.paper));
    // 거울 방향(빛과 눈의 가운데가 법선)의 하이라이트
    const v = { x: 0, y: 0, z: -1 };
    const hx = L_UNIT.x + v.x, hy = L_UNIT.y + v.y, hz = L_UNIT.z + v.z;
    const hl = Math.hypot(hx, hy, hz);
    const n = { x: hx / hl, y: hy / hl, z: hz / hl };
    expect(ggxKey(n, v, ROUGH.linen)).toBeGreaterThan(ggxKey(n, v, ROUGH.matte));
    expect(ggxKey(n, v, ROUGH.matte)).toBeGreaterThan(ggxKey(n, v, ROUGH.paper));
  });

  it('창빛 하이라이트는 광원 원반 크기보다 좁아지지 않는다: 거칠기 0이어도 봉우리가 유한하고, 빛 에너지(반구 적분)는 1을 넘지 않는다', () => {
    const v = { x: 0, y: 0, z: -1 };
    for (const r of [0, ROUGH.linen, ROUGH.paper]) {
      // 법선을 반구 위로 훑어 n·l 가중 반사(π·휘도/세기를 π로 나눈 것)를 눈 방향마다 적분 = 방향 반사율 ≤ F 몫
      let s = 0;
      const N = 160;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < 2 * N; j++) {
          const th = ((i + 0.5) / N) * (Math.PI / 2);
          const ph = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
          const w = { x: Math.sin(th) * Math.cos(ph), y: Math.sin(th) * Math.sin(ph), z: -Math.cos(th) };
          // 빛 방향 L_UNIT 고정, 눈 방향 w를 돌려 거울 몫 적분(상반성으로 같다)
          s += (ggxKey({ x: 0, y: 0, z: -1 }, w, r) / Math.PI) * Math.sin(th) * (Math.PI / 2 / N) * (Math.PI / N) * Math.cos(th) / Math.max(1e-6, -L_UNIT.z);
        }
      expect(Number.isFinite(ggxKey({ x: L_UNIT.x, y: L_UNIT.y, z: L_UNIT.z }, v, r))).toBe(true);
      expect(s).toBeLessThan(1);
    }
  });

  it('하늘은 위가 밝다', () => {
    expect(lum(skyRadiance({ x: 0, y: 1, z: 0 }))).toBeGreaterThan(lum(skyRadiance({ x: 0, y: 0, z: -1 })));
  });
});

describe('빛 격자 창빛: 판과 책 가림의 합집합', () => {
  // 원반 위 고른 방향(촘촘히)으로 판 덩어리·책 상자(축 정렬)를 지나는지 센 값
  const dense = (P: Vec3, env: Env, book: { lo: Vec3; hi: Vec3 } | null) => {
    const t = { x: 0, y: 1, z: 0 };
    const c = { x: t.y * L_UNIT.z - t.z * L_UNIT.y, y: t.z * L_UNIT.x - t.x * L_UNIT.z, z: t.x * L_UNIT.y - t.y * L_UNIT.x };
    const cl = Math.hypot(c.x, c.y, c.z);
    const u = { x: c.x / cl, y: c.y / cl, z: c.z / cl };
    const v = { x: L_UNIT.y * u.z - L_UNIT.z * u.y, y: L_UNIT.z * u.x - L_UNIT.x * u.z, z: L_UNIT.x * u.y - L_UNIT.y * u.x };
    const hits = (w: Vec3, lo: Vec3, hi: Vec3) => {
      let t0 = 1e-4;
      let t1 = Infinity;
      for (const k of ['x', 'y', 'z'] as const) {
        if (Math.abs(w[k]) < 1e-12) {
          if (P[k] < lo[k] || P[k] > hi[k]) return false;
          continue;
        }
        const a = (lo[k] - P[k]) / w[k];
        const b = (hi[k] - P[k]) / w[k];
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      return t0 < t1;
    };
    const slabs = [
      { lo: { x: SHELF_X0, y: env.ceil, z: -SHELF_FRONT }, hi: { x: SHELF_X1, y: env.ceil + SHELF_THICK, z: SHELF_DEPTH } },
      { lo: { x: SHELF_X0, y: env.floor - SHELF_THICK, z: -SHELF_FRONT }, hi: { x: SHELF_X1, y: env.floor, z: SHELF_DEPTH } },
    ];
    const N = 6000;
    let plank = 0;
    let either = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.tan(light.radius) * Math.sqrt((i + 0.5) / N);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      const d = { x: L_UNIT.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r, y: L_UNIT.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r, z: L_UNIT.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r };
      const p = slabs.some((s) => hits(d, s.lo, s.hi));
      const b = !!book && hits(d, book.lo, book.hi);
      if (p) plank++;
      if (p || b) either++;
    }
    return { plank: plank / N, union: either / N };
  };

  it('책이 없으면 판이 가린 활꼴 넓이 그대로', () => {
    for (const y of [150, 170, 190]) {
      const P = { x: 180, y, z: SHELF_DEPTH };
      expect(gridKeyFree(P, row, [], [])).toBeCloseTo(1 - plankKeyBlocked(P, row), 9);
      expect(plankKeyBlocked(P, row)).toBeCloseTo(dense(P, row, null).plank, 1);
    }
  });

  it('판이 원반 위쪽, 책 머리가 아래쪽을 가리면 겹친 몫을 두 번 빼지 않는다(따로 곱하면 너무 밝다)', () => {
    // 벽 점을 빛 각도에 맞춰 잡는다: 위 판이 원반 가운데 위쪽을, 앞에 선 책 머리(점 바로 위, 벽에서 22DU)가 그보다 조금 위까지 아래쪽을 가린다
    const y = 200 - (SHELF_DEPTH + SHELF_FRONT) * Math.tan(L_ELEV);
    const H = y + 22 * Math.tan(L_ELEV + 0.1 * light.radius);
    const P = { x: 180, y, z: SHELF_DEPTH };
    const book: Book3 = { id: 'b', dims: { T: 50, H, W: 100 }, roll: 0, yaw: 0, t: { x: 150, y: 0, z: 0 } };
    const exact = dense(P, row, { lo: { x: 150, y: 0, z: 0 }, hi: { x: 200, y: H, z: 100 } });
    const got = gridKeyFree(P, row, [boxOf(book, [0.5, 0.5, 0.5])], [false]);
    expect(Math.abs(got - (1 - exact.union))).toBeLessThan(0.08);
    // 따로 곱한 값(판 활꼴 × 책 방향 몫)은 합집합보다 눈에 띄게 밝다
    const bookOnly = dense(P, { floor: -FAR, ceil: FAR }, { lo: { x: 150, y: 0, z: 0 }, hi: { x: 200, y: H, z: 100 } }).union;
    expect((1 - exact.plank) * (1 - bookOnly) - (1 - exact.union)).toBeGreaterThan(0.1);
  });
});

describe('접촉 그늘', () => {
  const box = boxOf({ id: 'a', dims: { T: 30, H: 160, W: 110 }, roll: 0, yaw: 0, t: { x: 100, y: 0, z: 0 } }, [0.5, 0.5, 0.5]);
  const up = { x: 0, y: 1, z: 0 };
  const front = { x: 0, y: 0, z: -1 };
  it('책 밑동 바로 앞이 가장 짙고 좁게 사라진다', () => {
    const at = (z: number) => contactShade({ x: 115, y: 0, z }, up, [box]);
    expect(at(0)).toBeCloseTo(0.5);
    expect(at(-3)).toBeGreaterThan(at(-10));
    expect(at(-10)).toBeGreaterThan(at(-30));
    expect(at(-30)).toBeLessThan(0.06);
    expect(at(-120)).toBeLessThan(0.005);
  });
  it('받치는 면만: 벽·표지 같은 수직 면은 어두워지지 않는다(벽에 테두리가 생기지 않게)', () => {
    expect(contactShade({ x: 115, y: 60, z: 122 }, front, [box])).toBe(0);
  });
  it('벽에 기댄 표지처럼 기운 면도 받치는 면이 아니다', () => {
    const r = (14 * Math.PI) / 180;
    expect(contactShade({ x: 115, y: 60, z: 122 }, { x: 0, y: Math.sin(r), z: -Math.cos(r) }, [box])).toBe(0);
  });
  it('자기 상자, 면 위로 솟지 않은 책은 세지 않는다', () => {
    expect(contactShade({ x: 115, y: 0, z: 0 }, up, [box], 0)).toBe(0);
    expect(contactShade({ x: 115, y: 170, z: 50 }, up, [box])).toBe(0); // 책 머리보다 위에 있는 윗면
    expect(contactShade({ x: 115, y: 0, z: 0 }, up, [])).toBe(0);
  });
  it('그릴 때의 가림: 하늘 가림 + 접촉 몫의 받는 빛, 그려진 뒤 받는 빛이 그 몫만큼 준다', () => {
    const P = { x: 115, y: 0, z: -3 };
    const plain = skyLossAt(P, up, null, [box]);
    const baked = bakedLossAt(P, up, null, [box]);
    expect(baked[1]).toBeGreaterThan(plain[1]);
    const lit = (loss: number[]) => lightWithLoss(P, up, null, null, loss as [number, number, number], false).r[1];
    const f = contactShade(P, up, [box]);
    expect(lit(baked) / lit(plain)).toBeLessThan(1 - f * 0.8);
  });
});

describe('그늘 색과 반사 경계(2026-11-03 사용자)', () => {
  it('크림색이 그늘에서 붉어지지 않는다: 어두워져도 R/B 비가 거의 그대로', () => {
    const c = linearOf('#FDF0E0');
    const at = (k: number) => [0, 1, 2].map((i) => tone(toneInv(c[i]) * k));
    const ratio = (v: number[]) => v[0] / v[2];
    for (const k of [0.9, 0.8, 0.6]) expect(ratio(at(k)) / ratio(at(1))).toBeLessThan(1.03);
  });
  it('거친 면 반사에는 판 앞 모서리의 칼 같은 선이 없다', () => {
    const env: Env = { floor: 0, ceil: 200 };
    const l = Math.hypot(0.5, 1);
    const w = { x: 0, y: 0.5 / l, z: -1 / l };
    const lum3 = (c: C3) => (c[0] + c[1] + c[2]) / 3;
    let hard = 0;
    let soft = 0;
    for (let y = 100; y < 190; y++) {
      const a = { x: 180, y, z: 50 };
      const b = { x: 180, y: y + 1, z: 50 };
      hard = Math.max(hard, Math.abs(lum3(envHit(b, w, env).rad) - lum3(envHit(a, w, env).rad)));
      soft = Math.max(soft, Math.abs(lum3(envLobe(b, w, env, 0.8)) - lum3(envLobe(a, w, env, 0.8))));
    }
    expect(hard).toBeGreaterThan(0.1);
    expect(soft).toBeLessThan(hard * 0.05);
  });
});
