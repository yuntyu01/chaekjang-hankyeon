// 넘어지는 동작(transition gravityPlan): 무게중심이 내내 내려가는 회전만 점점 빨라지다 닿는 순간 멈추고,
// 손이 하는 움직임(세우기·똑바로 선 책 기울이기·옮기기)은 그대로 천천히 출발해 천천히 멈춘다.
// 이어 주기(safeOffsets): 적용 순간 더하는 차이도 책끼리 겹치지 않게 줄이거나 버린다.
import { corners, fromPlaced, gap, type Book3 } from '../book3';
import type { Placed } from '../box';
import { tipAngle } from '../statics';
import { bookAt, fallsUnderGravity, gravityPlan, holdTrack, OFF_T, planTransition, safeOffsets, withOff, type Seg, type Track } from '../transition';

const T = 30;
const H = 150;
const spine = (id: string, x: number, angle = 0): Placed => ({ bookId: id, pose: 'spine', size: { w: T, h: H, d: 100 }, x, y: 0, z: 0, angle });
const b3 = (p: Placed) => fromPlaced(p);
const comY = (b: Book3) => corners(b).reduce((s, c) => s + c.y, 0) / 8;

describe('넘어지는 동작', () => {
  it('넘어짐 한계를 넘은 기댄 책이 더 기울면(받침을 잃음) 점점 빨라지다 닿는 순간 멈춘다', () => {
    const from = b3(spine('L', 100, -12));
    const to = b3(spine('L', 100, -25));
    expect(12).toBeGreaterThan(tipAngle(T, H));
    const plan = planTransition([from], [to]);
    const g = gravityPlan(plan);
    expect(g?.fall).toBe(true);
    const tr = g!.tracks[0];
    expect(tr.segs.some((s) => s.e === 1)).toBe(true);
    const roll = (t: number) => bookAt(tr, t).roll;
    // 앞 절반에 간 각이 전체의 1/4보다 작고(천천히 출발), 끝 직전 마지막 5%에 가장 많이 간다(닿을 때 가장 빠름)
    expect(Math.abs(roll(0.5) - roll(0))).toBeLessThan(13 / 4);
    let fastest = 0;
    let at = 0;
    for (let k = 1; k <= 20; k++) {
      const d = Math.abs(roll(k / 20) - roll((k - 1) / 20));
      if (d > fastest) [fastest, at] = [d, k];
    }
    expect(at).toBe(20);
    expect(roll(1)).toBeCloseTo(-25, 6);
    // 무게중심은 내내 내려간다
    for (let k = 1; k <= 20; k++) expect(comY(bookAt(tr, k / 20))).toBeLessThanOrEqual(comY(bookAt(tr, (k - 1) / 20)) + 1e-9);
  });

  it('넘어짐 한계 아래로 놓은 책이 다시 서는 것도 중력: 점점 빨라진다', () => {
    const from = b3(spine('L', 100, -tipAngle(T, H) + 3));
    const to = b3(spine('L', 100, 0));
    const g = gravityPlan(planTransition([from], [to]));
    expect(g?.fall).toBe(true);
  });

  it('똑바로 선 책을 기울이기·기댄 책을 세우기는 무게중심을 들어 올리므로 손이 하는 움직임(경로 그대로)', () => {
    const up = b3(spine('L', 100, 0));
    const lean = b3(spine('L', 100, -15));
    expect(gravityPlan(planTransition([up], [lean]))).toBeNull();
    expect(gravityPlan(planTransition([lean], [up]))).toBeNull();
  });

  it('옆으로 옮기기만 하는 경로는 넘어짐이 아니다', () => {
    expect(gravityPlan(planTransition([b3(spine('A', 100))], [b3(spine('A', 160))]))).toBeNull();
  });

  it('넘어지는 책과 같은 경로의 다른 움직임은 조각 안에서 천천히 출발·멈춤(줄 시계가 고르게 흘러도 부드럽게)', () => {
    const plan = planTransition([b3(spine('L', 100, -12)), b3(spine('M', 300))], [b3(spine('L', 100, -25)), b3(spine('M', 340))]);
    const g = gravityPlan(plan)!;
    expect(g.fall).toBe(true);
    const m = g.tracks.find((t) => t.id === 'M')!;
    const moving = m.segs.filter((s) => Math.abs(s.t1 - s.t0) > 0 && s.e !== undefined);
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.every((s) => s.e === 2)).toBe(true);
    // 끝에서 멈춘다(마지막 2%에 간 거리가 작다)
    const x = (t: number) => bookAt(m, t).t.x;
    expect(Math.abs(x(1) - x(0.98))).toBeLessThan(0.05);
  });

  it('조각 판정: 받침에서 떨어지거나(들어 올림) 멀리 가며 기울면 넘어짐이 아니다', () => {
    const from = b3(spine('L', 100, -12));
    const to = b3(spine('L', 100, -25));
    const tr = planTransition([from], [to]).tracks[0];
    const s = tr.segs.find((q) => q.r0 !== q.r1)!;
    expect(fallsUnderGravity(tr, s)).toBe(true);
    const lifted: Seg = { ...s, w1: { ...s.w1, y: s.w1.y + 20 } };
    expect(fallsUnderGravity(tr, lifted)).toBe(false);
    const far: Seg = { ...s, w1: { ...s.w1, x: s.w1.x - 400 } };
    expect(fallsUnderGravity(tr, far)).toBe(false);
  });
});

describe('이어 주기도 충돌 검사 안에', () => {
  const dims = { T: 20, H: 150, W: 100 };
  const at = (id: string, x: number): Book3 => ({ id, dims, roll: 0, yaw: 0, spin: 0, pitch: 0, t: { x, y: 0, z: 0 } });
  const seg = (t0: number, t1: number, x0: number, x1: number): Seg => ({
    kind: 0, t0, t1, r0: 0, r1: 0, y0: 0, y1: 0, sp0: 0, sp1: 0, pi0: 0, pi1: 0,
    a: { x: 0, y: 0, z: 0 }, w0: { x: x0, y: 0, z: 0 }, w1: { x: x1, y: 0, z: 0 },
    al: 0, x0: 0, x1: 0, b0: 0, b1: 0, z0: 0, z1: 0,
  });
  // A는 [10, 30]에 서 있고, B는 x 50 → 31로 빨리 다가와(진행 0.3에 틈 1) 머문다
  const A = holdTrack(at('A', 10));
  const B: Track = { id: 'B', dims, moving: true, segs: [seg(0, 0.3, 50, 31), seg(0.3, 1, 31, 31)] };
  const minGap = (rec: Record<string, Track>) => {
    let m = Infinity;
    for (let k = 0; k <= 80; k++) m = Math.min(m, gap(bookAt(rec.A, (OFF_T * k) / 80), bookAt(rec.B, (OFF_T * k) / 80)));
    return m;
  };
  const off = (x: number) => ({ x, y: 0, z: 0, roll: 0, yaw: 0, spin: 0, pitch: 0 });

  it('차이를 그대로 더하면 다가오는 쪽으로 넘쳐 겹치는데, 겹치지 않을 만큼 줄인다', () => {
    const base = { A, B };
    const rec = { A, B: withOff(B, off(-10)) };
    expect(minGap(rec)).toBeLessThan(-0.25);
    const safe = safeOffsets(rec, base);
    expect(minGap(safe)).toBeGreaterThanOrEqual(-0.25);
    expect(Math.abs(safe.B.off!.x)).toBeGreaterThan(0); // 버리지 않고 줄였다(튀는 폭이 작다)
    expect(Math.abs(safe.B.off!.x)).toBeLessThan(10);
  });

  it('겹치지 않는 차이는 그대로 둔다', () => {
    const rec = { A, B: withOff(B, off(10)) };
    expect(safeOffsets(rec, { A, B })).toBe(rec);
  });

  it('줄여도 계속 겹치면 이어 주기를 버린다(원래 경로)', () => {
    // A 너머 왼쪽 멀리서 A를 가로질러 오는 차이(-200): 반씩 줄여도 앞부분에서 A와 겹친다
    const rec = { A, B: withOff(B, off(-200)) };
    const safe = safeOffsets(rec, { A, B });
    expect(safe.B).toBe(B);
  });
});
