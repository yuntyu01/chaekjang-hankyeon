// 빛 모델(domain/light-model): 해석적인 하늘 가림(램버트 윤곽 적분 + 앞 가리개는 뒤에 보일 것과의 차이)이
// 같은 장면을 광선으로 직접 적분한 값(몬테카를로)과 맞는지, 그리고 반사·창빛 가림의 기본 성질.
import type { Book3, Vec3 } from '../book3';
import { boxOf, darkening, E_REF, envBRDF, FAR, irradiance, keyBlocked, plankKeyBlocked, polyVF, sceneLight, skyRadiance, traceRadiance, withCovers, type Box, type Env } from '../light-model';
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
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const a = 2 * Math.PI * r();
    const rr = Math.sqrt(r());
    const z = Math.sqrt(1 - rr * rr);
    const w = { x: u.x * rr * Math.cos(a) + v.x * rr * Math.sin(a) + n.x * z, y: u.y * rr * Math.cos(a) + v.y * rr * Math.sin(a) + n.y * z, z: u.z * rr * Math.cos(a) + v.z * rr * Math.sin(a) + n.z * z };
    sum += traceRadiance(p, w, env, boxes);
  }
  return sum / N;
}
const cross = (a: Vec3, b: Vec3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec3) => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
// 창빛을 뺀 받는 빛(해석): sceneLight는 창빛까지 더하므로 그 몫을 뺀다(가림 없는 창빛, 위 판 가림 끔)
function analytic(p: Vec3, n: Vec3, env: Env | null, boxes: Box[]) {
  const key = irradiance(n) - (light.ambient + light.skyUp * n.y);
  return sceneLight(p, n, null, env, boxes, false).r * E_REF - key;
}

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
    ['판 끝 너머 벽, 판 두께 높이(판 끝면이 가린다)', { x: -9, y: -8, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(16)]],
    ['판 끝 너머 벽, 판 위', { x: -9, y: 20, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, [book(16)]],
  ];
  it.each(cases)('%s: 해석 값 = 광선 적분(오차 1% 이내)', (_, p, n, env, books) => {
    const boxes = withCovers(books.map((b) => boxOf(b, 0.12)));
    const mc = monteCarlo(p, n, env, boxes);
    const an = analytic(p, n, env, boxes);
    expect(Math.abs(an - mc) / mc).toBeLessThan(0.01);
  });

  // 판 끝 너머 벽: 판 끝 평면(창)의 판 사이 틈마다 그 줄 안(판 윗면·아랫면·책)이 보인다(판 끝 안쪽에서는 판이 다 가린다).
  // 이웃 줄: 아래 줄(공간 190), 위 줄(공간 180)
  const lifted = (b: Book3, dy: number): Book3 => ({ ...b, t: { ...b.t, y: b.t.y + dy } });
  const rows3: Env = { floor: 0, ceil: 200, below: -SHELF_THICK - 190, above: 200 + SHELF_THICK + 180 };
  it.each([
    ['판 두께 높이', { x: -9, y: -8, z: SHELF_DEPTH }],
    ['판 바로 위', { x: -9, y: 4, z: SHELF_DEPTH }],
    ['위 판 바로 아래', { x: -9, y: 192, z: SHELF_DEPTH }],
    ['위 판 두께 높이(오른쪽)', { x: 372, y: 205, z: SHELF_DEPTH }],
    ['판 끝 안쪽(다른 줄 책은 다 가린다)', { x: 6, y: 40, z: SHELF_DEPTH }],
  ] as [string, Vec3][])('다른 줄 책·판, %s: 해석 값 = 광선 적분(오차 1% 이내)', (_, p) => {
    const boxes = [
      ...withCovers([boxOf(book(16), 0.12), boxOf(book(40), 0.5), boxOf(book(330), 0.3)]),
      ...withCovers([boxOf(lifted(book(10), 200 + SHELF_THICK), 0.2, 1), boxOf(lifted(book(34, 22, 120), 200 + SHELF_THICK), 0.7, 1), boxOf(lifted(book(335), 200 + SHELF_THICK), 0.6, 1)]),
      ...withCovers([boxOf(lifted(book(20, 22, 170), -SHELF_THICK - 190), 0.15, -1)]),
    ];
    const n = { x: 0, y: 0, z: -1 };
    for (const env of [row, rows3]) {
      const mc = monteCarlo(p, n, env, boxes);
      const an = analytic(p, n, env, boxes);
      expect(Math.abs(an - mc) / mc).toBeLessThan(0.01);
    }
  });
  it.each([
    ['아래 판 두께 높이', { x: 372, y: -10, z: SHELF_DEPTH }, rows3],
    ['줄 가운데 높이', { x: -12, y: 100, z: SHELF_DEPTH }, rows3],
    ['맨 아랫줄 판 밑(위로 그 줄 안)', { x: 374, y: -40, z: SHELF_DEPTH }, { floor: -FAR, ceil: -SHELF_THICK, above: 190 }],
  ] as [string, Vec3, Env][])('판 끝 너머 벽, 이웃 줄 판까지, %s: 해석 값 = 광선 적분(오차 1% 이내)', (_, p, env) => {
    const n = { x: 0, y: 0, z: -1 };
    const mc = monteCarlo(p, n, env, []);
    const an = analytic(p, n, env, []);
    expect(Math.abs(an - mc) / mc).toBeLessThan(0.01);
  });
  it('판 끝 너머 벽: 이웃 두 줄이 맞닿는 판 높이에서 두 줄의 계산이 같다(줄 경계 이음새가 없다)', () => {
    // 이 줄(공간 200) 판 윗면 y = 0, 아래 줄(공간 190)의 위 판 = 이 줄 판. 같은 점을 두 줄 좌표로
    const lower: Env = { floor: 0, ceil: 190, below: undefined, above: 190 + SHELF_THICK + 200 };
    const upper: Env = { floor: 0, ceil: 200, below: -SHELF_THICK - 190, above: undefined };
    for (const y of [-SHELF_THICK, -SHELF_THICK / 2, 0]) {
      const p = { x: 372, y, z: SHELF_DEPTH };
      const q = { x: 372, y: y + 190 + SHELF_THICK, z: SHELF_DEPTH };
      const n = { x: 0, y: 0, z: -1 };
      expect(Math.abs(analytic(p, n, upper, []) - analytic(q, n, lower, []))).toBeLessThan(1e-9);
    }
  });

  it('줄 가운데 틈: 좁을수록 그 뒤 벽이 어둡고, 넓어지면 옅어진다(면이 모두 같은 재질일 때)', () => {
    // 틈 양쪽으로 책이 넷씩 붙어 선 줄. 실제 책은 벽 쪽 면(책배)이 밝은 종이라 틈이 넓어지며 어두운 표지가 드러나면 오히려 어두워질 수 있다
    const same = (b: Book3) => ({ ...boxOf(b, 0.12), head: 0.12, fore: 0.12 });
    const rowOf = (gap: number) => withCovers([0, 1, 2, 3].flatMap((k) => [same(book(100 - 22 * k)), same(book(122 + gap + 22 * k))]));
    const at = (gap: number) => darkening({ x: 122 + gap / 2, y: 40, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, row, rowOf(gap), false);
    const ds = [2, 6, 20, 60].map(at);
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeLessThan(ds[i - 1]);
    expect(ds[0]).toBeGreaterThan(0.2);
  });

  it('밝은 판이 하늘보다 밝으면 판 바로 위 벽은 오히려 밝아진다(되비침)', () => {
    expect(darkening({ x: 180, y: 2, z: SHELF_DEPTH }, { x: 0, y: 0, z: -1 }, { floor: 0, ceil: FAR }, [], false)).toBeLessThan(0);
  });
});

describe('빛 모델: 창빛 가림·반사', () => {
  it('위 판이 창빛 원반을 가리는 몫은 판 앞 모서리에 가까울수록 크고, 판 가운데에서는 가로 위치와 상관없다', () => {
    const zf = SHELF_DEPTH + SHELF_FRONT;
    let prev = 2;
    for (let d = 0.5; d < 60; d += 0.5) {
      const k = keyBlocked(d, zf);
      expect(k).toBeLessThanOrEqual(prev + 1e-12);
      prev = k;
    }
    const mid = (SHELF_X0 + SHELF_X1) / 2;
    const a = plankKeyBlocked({ x: mid, y: 190, z: SHELF_DEPTH }, row);
    expect(plankKeyBlocked({ x: mid + 60, y: 190, z: SHELF_DEPTH }, row)).toBeCloseTo(a, 6);
    // 판 왼쪽 끝 너머(빛이 왼쪽에서 와서 판 끝 그늘이 오른쪽으로 밀린다)는 덜 가려진다
    expect(plankKeyBlocked({ x: SHELF_X0, y: 190, z: SHELF_DEPTH }, row)).toBeLessThan(a);
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
