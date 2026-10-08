// 빛 모델(domain/light-model): 해석적인 하늘 가림(램버트 윤곽 적분 + 앞 가리개는 뒤에 보일 것과의 차이)이
// 같은 장면을 광선으로 직접 적분한 값(몬테카를로)과 맞는지, 그리고 반사·창빛 가림의 기본 성질.
import type { Book3, Vec3 } from '../book3';
import { ALBEDO, ggxKey, KEY_C, lum, RAD, ROUGH, skyIrradiance, SREF, bookAlbedo, bookEref, boxOf, tone, toneInv, toneTarget, TONE, darkening, DESIGN, EREF, envBRDF, faceAlbedo, lightWithLoss, FAR, irradiance, keyBlocked, L_UNIT, linearOf, plankKeyBlocked, polyVF, sceneLight, skyLossAt, skyRadiance, solveGrid, traceRadiance, withCovers, type Box, type C3, type Env, type Grid } from '../light-model';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '../geometry';
import palette from '@/ui/art/reference-bindings.generated.json';
import { light } from '@/ui/lighting';
import { camAt, VIEW_PITCH_MIN } from '../camera';
import { grainPeak, MAT_UNIFORMS } from '../surface-pattern';

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
const g3 = (v: number): C3 => [v, v, v];

const book = (x: number, T = 22, H = 150, W = 100, z = 0): Book3 => ({ id: `b${x}`, dims: { T, H, W }, roll: 0, yaw: 0, t: { x, y: 0, z } });
const row: Env = { floor: 0, ceil: 200 };

describe('빛 모델: 하늘 가림', () => {
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
    ['그린 판 끝 너머 벽(가림 계산에서는 판이 이어진다)', { x: -9, y: 20, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(16)]],
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

  it('판은 가림 계산에서 가로로 끝없이 이어진다: 책이 없으면 그린 판 끝 너머 벽도 줄 가운데 벽과 같다(줄 끝 흰 번짐 없음)', () => {
    const n = { x: 0, y: 0, z: -1 };
    for (const y of [-8, 20, 190]) {
      const mid = analytic({ x: (SHELF_X0 + SHELF_X1) / 2, y, z: SHELF_DEPTH }, n, row, []);
      for (const x of [SHELF_X0 - 9, SHELF_X1 + 9]) {
        const end = analytic({ x, y, z: SHELF_DEPTH }, n, row, []);
        for (let c = 0; c < 3; c++) expect(end[c]).toBeCloseTo(mid[c], 6);
      }
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
    expect(RAD.floor[2]).toBeLessThan(skyLo[2]);
    // 따뜻한 나무: 빨강 > 초록 > 파랑 순으로 덜 어두워진다
    expect(E[0]).toBeGreaterThan(E[1]);
    expect(E[1]).toBeGreaterThan(E[2]);
  });
});

// 여러 번 튕긴 빛의 정답: 경로 추적(램버트 면, 하늘, 창빛은 튕긴 점마다 그림자 광선). 판은 가로로 끝없는 상자, 벽은 판 사이 끝없는 평면
function pathTrace(p: Vec3, n: Vec3, env: Env, boxes: Box[], N: number): C3 {
  const r = rng(3);
  const slabs: [number, number][] = [[env.floor - SHELF_THICK, env.floor], [env.ceil, env.ceil + SHELF_THICK]];
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
      const h = hitBox(q, w, { x: -1e6, y: y0, z: -SHELF_FRONT }, { x: 1e6, y: y1, z: SHELF_DEPTH });
      if (h && (!best || h.t < best.t)) best = { ...h, a: ALBEDO.plank };
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
    expect(Math.abs(an - pt)).toBeLessThan(Math.max(0.025, 0.08 * pt));
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

describe('재질 반사율 맞추기(역렌더링)', () => {
  it('노출 기준: 반사율은 모두(시안 장정 색 × 장정 재질 포함) 그 화면 색 이하이고 결의 가장 밝은 점까지 1 이하, 이득은 그중 가장 작은 값', () => {
    const peak = (m: keyof typeof MAT_UNIFORMS) => grainPeak(MAT_UNIFORMS[m]);
    const all: [C3, C3, number][] = [
      [ALBEDO.wall, DESIGN.wall, peak('paint')],
      [ALBEDO.plank, DESIGN.plank, peak('wood')],
      [ALBEDO.paper, DESIGN.paper, peak('pages')],
      ...Object.keys(palette).flatMap((hex) => (['paper', 'cloth', 'coated'] as const).map((m): [C3, C3, number] => [bookAlbedo(hex, m), linearOf(hex), peak(m)])),
    ];
    let tight = 0;
    for (const [a, d, f] of all)
      a.forEach((v, c) => {
        expect(v).toBeLessThanOrEqual(d[c] + 1e-9);
        expect(v * f).toBeLessThanOrEqual(1 + 1e-9);
        tight = Math.max(tight, v / d[c], v * f);
      });
    // 이득을 조금이라도 낮추면 어느 하나가 넘는다
    expect(tight).toBeCloseTo(1, 9);
  });
  it('벽 대표 자리(빈 줄 가운데)에서 받는 빛 비가 1: 시안 벽 색 그대로 보인다', () => {
    const p = { x: (SHELF_X0 + SHELF_X1) / 2, y: 100, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    // 대표 자리 빛은 빈 줄의 여러 번 튕긴 빛(빛 격자)이고, 그 자리 반사 몫(1 − ks)까지 들어 있다
    const E = lightWithLoss(p, n, null, row, skyLossAt(p, n, row, [], solveGrid(row, [])), true, [1, 1, 1]).r;
    const ks = envBRDF(0.999, ROUGH.paint);
    E.forEach((e, c) => expect((e * (1 - ks)) / EREF.wall[c]).toBeCloseTo(1, 1));
  });
});

describe('하늘 가림 상한', () => {
  it('가림이 하늘 빛을 넘으면(겹친 가리개를 두 번 센 회색 오차) 넘친 만큼을 세 채널에서 똑같이 빼: 채널 차이(되비친 빛의 색)는 그대로, 음수는 없다', () => {
    const p = { x: 100, y: 75, z: 50 };
    const n = { x: -1, y: 0, z: 0 };
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
  // 대표 자리(맞추기와 같은 눈·자리)에서 빛 모델이 주는 받는 빛 비 r과 반사광 spec
  const e = camAt(VIEW_PITCH_MIN).eye!;
  const eye = { x: e.x, y: e.y, z: e.z - e.dist };
  const front = { x: 0, y: 0, z: -1 };
  const at = (p: Vec3, eref: C3, rough: number) => {
    const d = { x: eye.x - p.x, y: eye.y - p.y, z: eye.z - p.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return lightWithLoss(p, front, { x: d.x / l, y: d.y / l, z: d.z / l }, row, skyLossAt(p, front, row, [], solveGrid(row, [])), true, eref, undefined, rough);
  };
  const mid = (SHELF_X0 + SHELF_X1) / 2;
  it.each([
    ['벽', { x: mid, y: 100, z: SHELF_DEPTH }, () => EREF.wall, ROUGH.paint, () => SREF.wall, () => DESIGN.wall],
    ['판 앞면', { x: mid, y: -SHELF_THICK / 2, z: -SHELF_FRONT }, () => EREF.plank, ROUGH.wood, () => SREF.plank, () => DESIGN.plank],
    ['코팅지 장정(하늘색)', { x: mid, y: 75, z: 0 }, () => bookEref('coated'), ROUGH.coated, () => SREF.book.coated, () => linearOf('#88A4BA')],
  ] as [string, Vec3, () => C3, number, () => C3, () => C3][])('%s: 반사광이 SREF이고, 확산 + 반사광으로 보이는 색이 재질 색', (_, p, eref, rough, sref, design) => {
    const { r, spec } = at(p, eref(), rough);
    spec.forEach((v, c) => expect(v).toBeCloseTo(sref()[c], 2));
    design().forEach((d, c) => expect(toneTarget(d, r[c], spec[c], sref()[c])).toBeCloseTo(d, 2));
  });
  it('반사광보다 짙은 채널은 반사율 0(그 방의 빛에서 그만큼 짙게 보일 수 없다)', () => {
    const navy = linearOf('#1D426B');
    const a = bookAlbedo('#1D426B', 'coated');
    navy.forEach((v, c) => {
      if (toneInv(v) <= SREF.book.coated[c]) expect(a[c]).toBe(0);
      else expect(a[c]).toBeGreaterThan(0);
    });
  });
});

describe('빛 모델: 창빛 가림·반사', () => {
  it('위 판이 창빛 원반을 가리는 몫은 판 앞 모서리에 가까울수록 크고, 가로 위치와 상관없다(판은 끝없이 이어진다)', () => {
    const zf = SHELF_DEPTH + SHELF_FRONT;
    let prev = 2;
    for (let d = 0.5; d < 60; d += 0.5) {
      const k = keyBlocked(d, zf);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
    const mid = (SHELF_X0 + SHELF_X1) / 2;
    const a = plankKeyBlocked({ x: mid, y: 190, z: SHELF_DEPTH }, row);
    expect(plankKeyBlocked({ x: mid + 60, y: 190, z: SHELF_DEPTH }, row)).toBeCloseTo(a, 9);
    expect(plankKeyBlocked({ x: SHELF_X0 - 9, y: 190, z: SHELF_DEPTH }, row)).toBeCloseTo(a, 9);
  });

  it('거친 종이의 환경 반사: 정면 F0 안팎(거친 면은 미세면끼리 가려 조금 덜하다), 비스듬히 볼수록 커지지만 10%를 넘지 않는다(거울 프레넬처럼 수십 %가 되지 않는다)', () => {
    const r = ROUGH.paper;
    expect(envBRDF(1, r)).toBeGreaterThan(0.015);
    expect(envBRDF(1, r)).toBeLessThan(0.04);
    expect(envBRDF(0.1, r)).toBeGreaterThan(envBRDF(1, r));
    expect(envBRDF(0.1, r)).toBeLessThan(0.1);
  });

  it('재질: 모두 같은 유전체(F0)라 정면 반사는 비슷하고, 매끈할수록(코팅지 > 천 > 무광 종이) 비스듬한 반사와 창빛 하이라이트가 크다', () => {
    expect(ROUGH.coated).toBeLessThan(ROUGH.cloth);
    expect(ROUGH.cloth).toBeLessThan(ROUGH.paper);
    for (const r of [ROUGH.coated, ROUGH.paper, ROUGH.cloth]) expect(Math.abs(envBRDF(1, r) - envBRDF(1, ROUGH.paper))).toBeLessThan(0.015);
    expect(envBRDF(0.1, ROUGH.coated)).toBeGreaterThan(envBRDF(0.1, ROUGH.cloth));
    expect(envBRDF(0.1, ROUGH.cloth)).toBeGreaterThan(envBRDF(0.1, ROUGH.paper));
    // 거울 방향(빛과 눈의 가운데가 법선)의 하이라이트
    const v = { x: 0, y: 0, z: -1 };
    const hx = L_UNIT.x + v.x, hy = L_UNIT.y + v.y, hz = L_UNIT.z + v.z;
    const hl = Math.hypot(hx, hy, hz);
    const n = { x: hx / hl, y: hy / hl, z: hz / hl };
    expect(ggxKey(n, v, ROUGH.coated)).toBeGreaterThan(ggxKey(n, v, ROUGH.cloth));
    expect(ggxKey(n, v, ROUGH.cloth)).toBeGreaterThan(ggxKey(n, v, ROUGH.paper));
  });

  it('창빛 하이라이트는 광원 원반 크기보다 좁아지지 않는다: 거칠기 0이어도 봉우리가 유한하고, 빛 에너지(반구 적분)는 1을 넘지 않는다', () => {
    const v = { x: 0, y: 0, z: -1 };
    for (const r of [0, ROUGH.coated, ROUGH.paper]) {
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
