// 가만히 있는 자세 판정(statics.ts): 닫힌 꼴 공식과 힘 평형 계산이 같은 답을 내는지, 경계에서 바뀌는지.
import type { Placed } from '../box';
import {
  contactOf,
  FLOOR_FRICTION,
  isBacked,
  LEAN_MARGIN,
  LEAN_MENU_MAX,
  leanHolds,
  leanStatics,
  menuLeanAngle,
  slipAngle,
  supportTips,
  tipAngle,
  wallLeanRest,
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
