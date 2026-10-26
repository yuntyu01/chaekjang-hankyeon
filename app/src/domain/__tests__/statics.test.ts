// 가만히 있는 자세 판정(statics.ts): 닫힌 꼴 공식과 힘 평형 계산이 같은 답을 내는지, 경계에서 바뀌는지.
import { fromPlaced } from '../book3';
import type { Placed } from '../box';
import { frontLean, frontSupport2 } from '../front-pose';
import {
  centerXY,
  contactOf,
  FLOOR_FRICTION,
  isBacked,
  LEAN_MARGIN,
  LEAN_MENU_MAX,
  leanHolds,
  leanStatics,
  massOf,
  menuLeanAngle,
  outlineXY,
  pivotOf,
  slipAngle,
  supportTips,
  tipAngle,
  wallLeanRest,
  type Contact,
  type Force,
  type Vec2,
} from '../statics';

const rad = (d: number) => (d * Math.PI) / 180;
const spine = (id: string, x: number, w: number, h: number, d = 100, angle = 0): Placed => ({ bookId: id, pose: 'spine', size: { w, h, d }, x, y: 0, z: 0, angle });

describe('한계각', () => {
  it('넘어짐 한계 = atan(두께/키), 미끄러짐 한계 = atan(2μ + 두께/키)', () => {
    expect(tipAngle(30, 150)).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 9);
    expect(slipAngle(30, 150)).toBeCloseTo((Math.atan(2 * FLOOR_FRICTION + 0.2) * 180) / Math.PI, 9);
    expect(leanHolds(30, 150, tipAngle(30, 150) - 0.1)).toBe(false);
    expect(leanHolds(30, 150, tipAngle(30, 150) + 0.1)).toBe(true);
    expect(leanHolds(30, 150, slipAngle(30, 150) + 0.1)).toBe(false);
  });

  it('메뉴로 기울일 각은 넘어짐 한계 + 여유, 한도(20°)를 넘는 두꺼운 책은 null', () => {
    expect(menuLeanAngle(30, 150)).toBeCloseTo(tipAngle(30, 150) + LEAN_MARGIN, 9);
    expect(menuLeanAngle(60, 150)).toBeNull(); // 21.8° + 여유 > 20°
    expect(LEAN_MENU_MAX).toBe(20);
  });

  it('벽에 기댄 표지 책: 한계 이하면 서고, 미끄러짐 한계를 넘으면 눕고, 그 사이는 그대로', () => {
    expect(wallLeanRest(30, 150, 5)).toBe(0);
    expect(wallLeanRest(30, 150, 20)).toBe(20);
    expect(wallLeanRest(30, 150, 50)).toBe(90);
    expect(wallLeanRest(30, 150, 90)).toBe(90);
  });
});

describe('기댄 책의 힘 평형', () => {
  // 왼쪽 받침(키 큰 책) 옆면에 윗모서리가 닿는 경우: 받침이 미는 힘 = 무게 × (tan θ − T/H) / 2
  const support = spine('S', 0, 40, 200);
  const at = (deg: number) => {
    const T = 30;
    const H = 150;
    // 축(왼쪽 아래 모서리)이 x = 40 + H sin θ 에 있으면 윗모서리가 받침 옆면(x = 40)에 닿는다
    const leaner = spine('L', 40 + H * Math.sin(rad(deg)), T, H, 100, -deg);
    return { leaner, T, H };
  };

  it('미는 힘이 닫힌 꼴과 같다', () => {
    for (const deg of [12, 20, 30, 40]) {
      const { leaner, T, H } = at(deg);
      const c = contactOf(leaner, support);
      expect(c.n.x).toBeCloseTo(1, 6); // 옆면이 오른쪽으로 민다
      const st = leanStatics(leaner, c);
      expect(st.normal).toBeCloseTo((Math.tan(rad(deg)) - T / H) / 2, 4);
    }
  });

  it('넘어짐 한계 아래면 받침을 밀지 않아 다시 서고(tip), 미끄러짐 한계 위면 바닥이 미끄러진다(slip)', () => {
    const { T, H } = at(10);
    const low = at(tipAngle(T, H) - 1).leaner;
    expect(leanStatics(low, contactOf(low, support))).toMatchObject({ ok: false, reason: 'tip' });
    const ok = at(tipAngle(T, H) + 1).leaner;
    expect(leanStatics(ok, contactOf(ok, support)).ok).toBe(true);
    const steep = at(slipAngle(T, H) + 1).leaner;
    expect(leanStatics(steep, contactOf(steep, support))).toMatchObject({ ok: false, reason: 'slip' });
  });

  it('받침 꼭짓점이 기댄 책 옆면에 닿을 때(받침이 낮다)는 미는 방향이 옆면에 수직이다', () => {
    const low = spine('S', 0, 40, 60);
    const deg = 25;
    // 축에서 높이 60인 곳의 옆면이 받침 오른쪽 위 모서리(40, 60)에 닿는 자리
    const leaner = spine('L', 40 + 60 * Math.tan(rad(deg)), 30, 150, 100, -deg);
    const c = contactOf(leaner, low);
    expect(c.n.x).toBeCloseTo(Math.cos(rad(deg)), 4);
    expect(c.n.y).toBeCloseTo(Math.sin(rad(deg)), 4);
    expect(c.at.y).toBeCloseTo(60, 3);
  });
});

describe('받침이 넘어가는지', () => {
  it('가볍고 얇은 받침은 큰 힘에 넘어가고, 너머에 붙은 책이 있으면 버틴다', () => {
    const s = spine('S', 100, 20, 120);
    const push = [{ f: { x: -0.3 * 30 * 160 * 100, y: 0 }, at: { x: 120, y: 110 } }];
    expect(supportTips(s, push, () => false)).toBe(-1);
    expect(supportTips(s, push, () => true)).toBe(0);
    // 작은 힘은 버틴다
    expect(supportTips(s, [{ f: { x: -100, y: 0 }, at: { x: 120, y: 110 } }], () => false)).toBe(0);
  });

  it('붙어 선 책을 찾는다(깊이가 겹치고 간격이 좁을 때만)', () => {
    const s = spine('S', 100, 20, 120);
    expect(isBacked(s, -1, [spine('A', 60, 40, 150)])).toBe(true);
    expect(isBacked(s, -1, [spine('A', 50, 40, 150)])).toBe(false);
    expect(isBacked(s, 1, [spine('A', 60, 40, 150)])).toBe(false);
  });
});

// 2D 핵심(contact2·statics2)으로 나누기 전 계산을 그대로 옮겨 둔 것: 감싼 함수(contactOf·leanStatics)가 똑같은 답을 내는지 본다
function legacyContactOf(leaner: Placed, support: Placed): Contact {
  const closest = (q: Vec2, a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    const c = { x: a.x + t * dx, y: a.y + t * dy };
    return { c, d: Math.hypot(q.x - c.x, q.y - c.y) };
  };
  const outward = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
  };
  const L = outlineXY({ ...leaner });
  const S = outlineXY(support);
  const P = pivotOf(leaner);
  const dir = Math.sign(leaner.angle) || 1;
  const [u, v] = [...L].sort((a, b) => b.y - a.y);
  const top = dir * (u.x - v.x) >= 0 ? u : v;
  let best: { d: number; at: Vec2; n: Vec2 } = { d: Infinity, at: top, n: { x: -dir, y: 0 } };
  for (let i = 0; i < S.length; i++) {
    const { d } = closest(top, S[i], S[(i + 1) % S.length]);
    if (d < best.d) best = { d, at: top, n: outward(S[i], S[(i + 1) % S.length]) };
  }
  let inward = outward(P, top);
  if (Math.sign(inward.x) !== dir) inward = { x: -inward.x, y: -inward.y };
  inward = { x: -inward.x, y: -inward.y };
  for (const q of S) {
    const { c, d } = closest(q, P, top);
    if (d < best.d - 1e-6) best = { d, at: c, n: inward };
  }
  return { at: best.at, n: best.n };
}
function legacyLeanStatics(leaner: Placed, contact: Contact, external: Force[] = [], mu = FLOOR_FRICTION) {
  const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
  const P = pivotOf(leaner);
  const m = massOf(leaner);
  const g = centerXY(leaner);
  const r = (q: Vec2) => ({ x: q.x - P.x, y: q.y - P.y });
  let tau = cross(r(g), { x: 0, y: -m });
  for (const e of external) tau += cross(r(e.at), e.f);
  const lever = cross(r(contact.at), contact.n);
  const N = Math.abs(lever) < 1e-9 ? -1 : -tau / lever;
  const fx = N * contact.n.x + external.reduce((s, e) => s + e.f.x, 0);
  const fy = N * contact.n.y + external.reduce((s, e) => s + e.f.y, 0) - m;
  const floor = { x: -fx, y: -fy };
  const onSupport = { f: { x: -N * contact.n.x, y: -N * contact.n.y }, at: contact.at };
  if (N <= 0) return { normal: N / m, onSupport, floor, ok: false, reason: 'tip' };
  if (floor.y <= 0 || Math.abs(floor.x) > mu * floor.y + 1e-9) return { normal: N / m, onSupport, floor, ok: false, reason: 'slip' };
  return { normal: N / m, onSupport, floor, ok: true };
}

// 수는 상대 오차 1e-9 안(윗모서리를 꼭짓점 정렬 대신 발에서 바로 계산해 마지막 자리가 다를 수 있다), 나머지는 그대로
function expectNear(a: unknown, b: unknown): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(b)) expectNear((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    return;
  }
  expect(a).toBe(b);
}

describe('2D 핵심으로 나눈 뒤에도 세운 책 계산은 그대로', () => {
  it('크게 기운 책(tan θ > 키/두께)도 기우는 쪽 윗모서리는 발 바로 위: 낮은 받침 꼭짓점이 옆면을 수직으로 받친다', () => {
    // 150×30 책이 85°(> atan(5) = 78.7°)로 왼쪽에 기울어 높이 12인 받침 꼭짓점에 옆면이 얹혔다
    const leaner = spine('L', 200, 30, 150, 100, -85);
    const reach = 12 * Math.tan(rad(85)); // 옆면이 높이 12를 지나는 곳(발에서 가로 거리, 옆면은 바닥에서 5° 들려 있다)
    const support = spine('S', 200 - reach - 40, 40, 12);
    const c = contactOf(leaner, support);
    expect(c.n.y).toBeGreaterThan(0.99);
    expect(c.n.x).toBeCloseTo(Math.cos(rad(85)), 3);
    expect(c.at.y).toBeCloseTo(12, 3);
  });

  it('접촉·미는 힘·바닥 반력·판정이 예전 계산과 같다(받침 높낮이·양쪽·밖에서 오는 힘)', () => {
    let n = 0;
    for (const h of [40, 60, 120, 200])
      for (const deg of [-40, -25, -15, -8, 8, 15, 25, 40])
        for (const x of [45, 60, 90]) {
          const leaner = spine('L', x, 30, 150, 100, deg);
          const support = deg < 0 ? spine('S', 0, 40, h) : spine('S', x + 30 + 150 * Math.sin(rad(Math.abs(deg))) - 10, 40, h);
          const c = contactOf(leaner, support);
          expectNear(c, legacyContactOf(leaner, support));
          const push: Force[] = [{ f: { x: -0.2 * 30 * 150 * 100 * Math.sign(deg), y: -500 }, at: { x: x + 10, y: 120 } }];
          for (const ext of [[], push]) {
            const st = leanStatics(leaner, c, ext);
            expectNear(st, legacyLeanStatics(leaner, c, ext));
            n += st.ok ? 1 : 0;
          }
        }
    expect(n).toBeGreaterThan(10); // 버티는 경우와 아닌 경우가 섞여 있다
  });
});

describe('표지 책이 뒤로 넘어져 받침에 기댈 때(젖힘 평면, front-pose)', () => {
  const dims = { T: 20, H: 100, W: 75 };
  // 이 책(돌리기 축 x = 0)의 폭 전체에 걸친 받침: 앞면 z = front, 키 h, 깊이 30
  const wall = (front: number, h: number, x0 = -40, w = 80) => fromPlaced({ bookId: 'S', pose: 'spine', size: { w, h, d: 30 }, x: x0, y: 0, z: front, angle: 0 });

  it('높은 받침 앞면에 윗모서리가 닿으면 벽과 같은 한계(넘어짐 atan(T/H), 미끄러짐 atan(2μ + T/H))', () => {
    for (const deg of [tipAngle(20, 100) - 1, 15, 30, 40, slipAngle(20, 100) - 0.5, slipAngle(20, 100) + 0.5]) {
      const s = { depth: -30, pitch: deg, spin: 0 };
      const front = s.depth + dims.T + dims.H * Math.sin(rad(deg));
      const v = frontLean(dims, s, frontSupport2(dims, s, 0, wall(front, 200)));
      expect(v.contact.n.x).toBeCloseTo(-1, 6);
      expect(v.normal).toBeCloseTo((Math.tan(rad(deg)) - 20 / 100) / 2, 6);
      expect(v.ok).toBe(deg > tipAngle(20, 100) && deg <= slipAngle(20, 100));
    }
  });

  it('받침 꼭짓점이 뒷면에 닿으면 미는 방향이 뒷면에 수직이고, 크기는 축 둘레 돌림힘 평형', () => {
    const deg = 60;
    const s = { depth: -30, pitch: deg, spin: 0 };
    // 축(z -10)에서 뒷면을 따라 s = 40인 점에 받침 앞 위 모서리
    const at = { z: -10 + 40 * Math.sin(rad(deg)), y: 40 * Math.cos(rad(deg)) };
    const v = frontLean(dims, s, frontSupport2(dims, s, 0, wall(at.z, at.y)));
    expect(v.contact.n.x).toBeCloseTo(-Math.cos(rad(deg)), 6);
    expect(v.contact.n.y).toBeCloseTo(Math.sin(rad(deg)), 6);
    expect(v.normal).toBeCloseTo((50 * Math.sin(rad(deg)) - 10 * Math.cos(rad(deg))) / 40, 6);
    expect(v.reason).toBe('slip');
  });

  it('받침은 이 책 폭 안에 든 부분만 본다(돌린 틀에서 잘라 낸다)', () => {
    const s = { depth: -30, pitch: 30, spin: 0 };
    expect(frontSupport2(dims, s, 0, wall(20, 50, 40, 20))).toEqual([]); // x 40~60: 폭(±37.5) 밖
    const part = frontSupport2(dims, s, 0, wall(20, 50, 30, 20));
    const full = frontSupport2(dims, s, 0, wall(20, 50));
    expect(part.length).toBe(full.length);
    part.forEach((q, i) => {
      expect(q.x).toBeCloseTo(full[i].x, 9);
      expect(q.y).toBeCloseTo(full[i].y, 9);
    });
    // 30° 돌린 책: 되돌린 틀에서 받침 앞면(돌리기 축에서 Z = 40)이 기울어 보이고, 가장 가까운 점은 폭 경계 x' = 37.5에서 잘린 점
    const c = Math.cos(rad(30));
    const sn = Math.sin(rad(30));
    const X = (37.5 - 40 * sn) / c; // x' = X·cos + Z·sin = 37.5
    const spun = frontSupport2(dims, { ...s, spin: 30 }, 0, wall(20, 50));
    expect(Math.min(...spun.map((q) => q.x))).toBeCloseTo(-20 + 40 * c - X * sn, 6);
  });
});
