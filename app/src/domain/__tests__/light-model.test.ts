// 빛 모델(domain/light-model): 해석적인 하늘 가림(램버트 윤곽 적분 + 앞 가리개는 뒤에 보일 것과의 차이)이
// 같은 장면을 광선으로 직접 적분한 값(몬테카를로)과 맞는지, 그리고 반사·창빛 가림의 기본 성질.
import type { Book3, Vec3 } from '../book3';
import { ALBEDO, boxOf, darkening, DESIGN, EREF, envBRDF, lightWithLoss, FAR, irradiance, keyBlocked, linearOf, plankKeyBlocked, polyVF, sceneLight, skyLossAt, skyRadiance, traceRadiance, withCovers, type Box, type C3, type Env } from '../light-model';
import { SHELF_DEPTH, SHELF_FRONT, SHELF_THICK, SHELF_X0, SHELF_X1 } from '../geometry';
import { light } from '@/ui/lighting';

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
function analytic(p: Vec3, n: Vec3, env: Env | null, boxes: Box[]): C3 {
  const key = irradiance(n) - (light.ambient + light.skyUp * n.y);
  return sceneLight(p, n, null, env, boxes, false, [1, 1, 1]).r.map((r) => r - key) as C3;
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
    const loss = skyLossAt({ x: 180, y: 195, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, []);
    const plank = linearOf('#F2DCC1');
    expect(plank[0]).toBeGreaterThan(plank[2]);
    expect(loss[0]).toBeLessThan(loss[1]);
    expect(loss[1]).toBeLessThan(loss[2]);
    // 책 색도 번진다: 파란 책 옆 벽은 그 책이 가린 만큼 파랑이 덜 빠진다
    const blue = withCovers([boxOf(book(100), [0.05, 0.12, 0.4])]);
    const q = { x: 124, y: 60, z: SHELF_DEPTH };
    const l0 = skyLossAt(q, { x: 0, y: 0, z: -1 }, row, []);
    const l2 = skyLossAt(q, { x: 0, y: 0, z: -1 }, row, blue);
    expect(l2[2] - l0[2]).toBeLessThan(l2[0] - l0[0]);
  });

  it('판이 그 방향 하늘보다 밝은 채널은 판 바로 위 벽이 오히려 밝아진다(되비침): 나무 판은 빨강이 하늘보다 밝고 파랑은 어둡다', () => {
    const p = { x: 180, y: 2, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    const E = sceneLight(p, n, null, { floor: 0, ceil: FAR }, [], false, [1, 1, 1]).r;
    expect(E[0]).toBeGreaterThan(irradiance(n));
    expect(E[2]).toBeLessThan(irradiance(n));
  });
});

describe('재질 반사율 맞추기(역렌더링)', () => {
  it('반사율은 모두 1 이하, 벽은 시안 색 그대로(카메라 기준)', () => {
    for (const c of [ALBEDO.wall, ALBEDO.plank, ALBEDO.paper]) expect(Math.max(...c)).toBeLessThanOrEqual(1);
    expect(ALBEDO.wall).toEqual(DESIGN.wall);
  });
  it('벽 대표 자리(빈 줄 가운데)에서 받는 빛 비가 1: 시안 벽 색 그대로 보인다', () => {
    const p = { x: (SHELF_X0 + SHELF_X1) / 2, y: 100, z: SHELF_DEPTH };
    const n = { x: 0, y: 0, z: -1 };
    const E = lightWithLoss(p, n, null, row, skyLossAt(p, n, row, []), true, [1, 1, 1]).r;
    // 대표 자리 빛에는 그 자리 반사 몫(1 − ks)까지 들어 있다
    const ks = envBRDF(0.999);
    E.forEach((e, c) => expect((e * (1 - ks)) / EREF.wall[c]).toBeCloseTo(1, 1));
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

  it('거친 종이의 환경 반사: 정면 약 3%, 비스듬히 볼수록 커지지만 10%를 넘지 않는다(거울 프레넬처럼 수십 %가 되지 않는다)', () => {
    expect(envBRDF(1)).toBeGreaterThan(0.02);
    expect(envBRDF(1)).toBeLessThan(0.04);
    expect(envBRDF(0.1)).toBeGreaterThan(envBRDF(1));
    expect(envBRDF(0.1)).toBeLessThan(0.1);
  });

  it('하늘은 위가 밝다', () => {
    expect(skyRadiance({ x: 0, y: 1, z: 0 })).toBeGreaterThan(skyRadiance({ x: 0, y: 0, z: -1 }));
  });
});
