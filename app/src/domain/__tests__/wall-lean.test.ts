// 벽에 기댄 책은 당길수록 더 기울고, 벽이 닿지 않는 거리에서는 바닥에 눕는다.
import { corners, gap, lowest } from '../book3';
import { bookHeight, bookThickness, SHELF_DEPTH, SHELF_FRONT, wallPitch } from '../geometry';
import { bookXs, boxOf, depthRange, frontRelease, frontSpin, frontStateOf, frontTilt, normalize, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
import { MOCKUP_BOOKS, MOCKUP_LAYOUT } from '../mockup-sample';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import { tipAngle } from '../statics';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const ID = 'b16'; // 표지 전시 책
const B = books[ID];
const H = bookHeight(B);
const T = bookThickness(B);

// 3번째 선반에 표지 책 한 권
function lone(depth: number): ShelfLayout {
  const p = SAMPLE_LAYOUT.placements.find((q) => q.bookId === ID)!;
  return normalize({
    ...SAMPLE_LAYOUT,
    placements: [...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId !== 'shelf-3'), { ...p, pos: 120, depth }],
    drawer: [...SAMPLE_LAYOUT.drawer, ...SAMPLE_LAYOUT.placements.filter((q) => q.shelfId === 'shelf-3' && q.bookId !== ID).map((q) => q.bookId)],
  });
}
const body = (l: ShelfLayout) => bodiesOf(l, books, 'shelf-3').find((b) => b.id === ID)!;
const footZ = (l: ShelfLayout) => boxOf(l, books, ID)!.z + T; // 뒤쪽 아래 모서리

// 벽에서 z만큼 떨어진 자리(뒤쪽 아래 모서리 기준)
const depthAtGap = (g: number) => SHELF_DEPTH - T - g;

it('벽에 기댄 책을 당기면 20°를 넘어도 더 기울며 벽과 바닥 접촉을 유지하고, 마찰이 버티지 못하면 눕는다', () => {
  let l = lone(depthAtGap(H * 0.6)); // 멀리
  expect(body(l).pitch ?? 0).toBe(0);
  // 넘어짐 한계(약 12.9°)와 미끄러짐 한계(약 45.8°) 사이에서는 그 각으로 기댄다
  expect(tipAngle(T, H)).toBeGreaterThan(12);
  const steps = [20, 30, 14, Math.asin(0.6) * 180 / Math.PI].map((deg) => H * Math.sin((deg * Math.PI) / 180));
  const pitches: number[] = [];
  for (const [i, g] of steps.entries()) {
    // 첫 걸음은 기댄 채로 옮긴다(머리 손잡이로 젖힌 뒤처럼): 서 있는 책은 앞뒤로 옮겨도 저절로 기대지 않는다
    l = ok(setDepth(l, books, ID, depthAtGap(g), i === 0 ? true : undefined));
    pitches.push(body(l).pitch ?? 0);
    // 바닥 자리는 사용자가 둔 곳 그대로
    expect(footZ(l)).toBeCloseTo(SHELF_DEPTH - g, 1);
    const b = body(l);
    expect(lowest(b)).toBeCloseTo(0, 6); // 선반에 닿고 뜨지 않음
    let back = -Infinity;
    for (const c of corners(b)) back = Math.max(back, c.z);
    expect(back).toBeLessThanOrEqual(SHELF_DEPTH + 1e-6); // 벽을 뚫지 않음
    if (b.pitch) expect(back).toBeCloseTo(SHELF_DEPTH, 1); // 기대면 윗모서리가 벽에 닿는다(각은 0.01° 단위로 저장)
  }
  expect(pitches[0]).toBeCloseTo(20, 1);
  expect(pitches[1]).toBeCloseTo(30, 1);
  expect(pitches[2]).toBeCloseTo(14, 1);
  expect(pitches[3]).toBeCloseTo(Math.asin(0.6) * 180 / Math.PI, 1);
  // 미끄러짐 한계를 넘게 당기면 바닥이 앞으로 미끄러져 눕는다(선반 안)
  const flat = ok(setDepth(l, books, ID, depthAtGap(H * Math.sin((50 * Math.PI) / 180))));
  expect(placementOf(flat, ID)!.pitch).toBe(90);
  for (const c of corners(body(flat))) expect(c.z).toBeGreaterThanOrEqual(-SHELF_FRONT - 0.01);
});

it('기댄 책을 넘어짐 한계 아래로 밀어 넣으면 다시 선다', () => {
  let l = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(H * Math.sin((20 * Math.PI) / 180)), true));
  expect(placementOf(l, ID)!.pitch).toBeCloseTo(20, 1);
  l = ok(setDepth(l, books, ID, depthAtGap(H * Math.sin((8 * Math.PI) / 180))));
  expect(placementOf(l, ID)!.pitch ?? 0).toBe(0);
});

it('각도는 책 높이·두께·거리에서: 같은 틈이면 키가 큰 책이 덜 기운다', () => {
  const g = 20;
  expect(wallPitch(B, depthAtGap(g), true)).toBeCloseTo((Math.asin(g / H) * 180) / Math.PI, 6);
  const tall = { ...B, dims: { ...B.dims, height: H * 1.3 } };
  expect(wallPitch(tall, SHELF_DEPTH - bookThickness(tall) - g, true)).toBeLessThan(wallPitch(B, depthAtGap(g), true));
});

it('서 있던 책은 앞뒤로 옮겨도(벽 바로 앞까지) 서 있고, 기댄 책은 먼 곳까지 연속해서 넘어간다', () => {
  const mid = H * Math.sin((26 * Math.PI) / 180);
  // 서 있던 책은 벽 가까이 가도 기대지 않는다
  for (const g of [mid, 20, 5, 0.5]) {
    const standing = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(g)));
    expect(placementOf(standing, ID)!.pitch ?? 0).toBe(0);
  }
  // 기대 있던 책(버티는 각 20°)은 더 먼 틈에서도 계속 기댄다
  let leaning = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(H * Math.sin((20 * Math.PI) / 180)), true));
  leaning = ok(setDepth(leaning, books, ID, depthAtGap(mid)));
  expect(placementOf(leaning, ID)!.pitch ?? 0).toBeGreaterThan(0);
  // 끄는 도중 상태(prevLean)로도 같은 판단
  expect(placementOf(ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(mid), true)), ID)!.pitch ?? 0).toBeGreaterThan(0);
});

it('앞뒤 조절 범위: 뒷면이 벽에 닿는 곳까지(기대도 바닥 자리 기준)', () => {
  const l = ok(setDepth(lone(depthAtGap(H * 0.6)), books, ID, depthAtGap(10)));
  expect(depthRange(l, books, ID).hi).toBeCloseTo(SHELF_DEPTH - T, 6);
});

it('기댄 책은 옆 책을 뚫지 않는다(18권 배치의 표지 책)', () => {
  const l = ok(setDepth(SAMPLE_LAYOUT, books, ID, depthAtGap(20)));
  const bs = bodiesOf(l, books, 'shelf-3');
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-0.3);
});

describe('머리 손잡이: 젖히기·좌우 돌리기(하나의 3D 자세)', () => {
  const touching = (l: ShelfLayout) => {
    let back = -Infinity;
    for (const c of corners(body(l))) back = Math.max(back, c.z);
    return back;
  };
  // 손잡이로 끄는 동안처럼 한 걸음씩
  function drag(l0: ShelfLayout, steps: { pitch?: number; spin?: number }[]) {
    const f = frontStateOf(l0, books, ID)!;
    let cur = f.state;
    let l = l0;
    for (const st of steps) {
      const r = st.pitch !== undefined ? frontTilt(l0, books, ID, cur, f.qx, st.pitch) : frontSpin(l0, books, ID, cur, f.qx, st.spin!);
      if (r) {
        cur = r.state;
        l = r.layout;
      }
    }
    return { l, cur, qx: f.qx };
  }

  it('벽 전에는 바닥 고정으로 젖히고, 닿은 뒤 더 젖히면 바닥이 앞으로, 세우면 바닥이 뒤로(벽 접촉 유지)', () => {
    const start = lone(depthAtGap(20));
    const foot0 = footZ(start);
    // 벽에 닿기 전(20 DU 틈이면 약 7°에서 닿는다)
    let d = drag(start, [{ pitch: 3 }]);
    expect(footZ(d.l)).toBeCloseTo(foot0, 1);
    expect(touching(d.l)).toBeLessThan(SHELF_DEPTH - 1);
    // 더 젖히면 벽에 닿은 채 바닥이 앞으로
    d = drag(start, [{ pitch: 3 }, { pitch: 8 }, { pitch: 15 }]);
    expect(d.cur.pitch).toBeCloseTo(15, 1);
    expect(touching(d.l)).toBeCloseTo(SHELF_DEPTH, 1);
    expect(footZ(d.l)).toBeLessThan(foot0 - 1);
    // 세우면 벽에 닿은 채 바닥이 뒤로, 0°에서 뒷면이 벽에
    const back = drag(start, [{ pitch: 3 }, { pitch: 8 }, { pitch: 15 }, { pitch: 5 }, { pitch: 0 }]);
    expect(back.cur.pitch).toBe(0);
    expect(footZ(back.l)).toBeCloseTo(SHELF_DEPTH, 1);
  });

  it('손으로 받친 중간 자세는 놓으면 제자리에서 선다, 벽에 기댄 자세는 유지', () => {
    const start = lone(depthAtGap(40));
    const mid = drag(start, [{ pitch: 5 }]); // 벽에 안 닿음
    const rel = frontRelease(start, books, ID, mid.cur, mid.qx)!;
    expect(placementOf(rel, ID)!.pitch ?? 0).toBe(0);
    expect(footZ(rel)).toBeCloseTo(footZ(start), 1);
    const lean = drag(start, [{ pitch: 5 }, { pitch: 12 }, { pitch: 18 }]);
    const kept = frontRelease(start, books, ID, lean.cur, lean.qx)!;
    expect(placementOf(kept, ID)!.pitch).toBeCloseTo(lean.cur.pitch, 1);
 
    // 벽에 닿아 있어도 넘어짐 한계 이하로 살짝 기댄 자세는 놓으면 다시 선다(무게중심이 바닥 축 안쪽)
    const near = lone(depthAtGap(8));
    const slight = drag(near, [{ pitch: 3 }, { pitch: 6 }, { pitch: 9 }]);
    expect(slight.cur.pitch).toBeLessThan(tipAngle(T, H));
    expect(touching(slight.l)).toBeCloseTo(SHELF_DEPTH, 1);
    expect(placementOf(frontRelease(near, books, ID, slight.cur, slight.qx)!, ID)!.pitch ?? 0).toBe(0);
  });

  it('좌우로 돌려도 축 위치(가로)는 그대로, 기댄 채 돌리면 벽 접촉을 다시 계산해 유지', () => {
    const start = lone(depthAtGap(20));
    const f0 = frontStateOf(start, books, ID)!;
    const turned = drag(start, [{ spin: 10 }]);
    expect(turned.cur.spin).toBeCloseTo(10, 1);
    expect(frontStateOf(turned.l, books, ID)!.qx).toBeCloseTo(f0.qx, 1);
    // 기댄 뒤 돌리기, 돌린 뒤 더 젖히기: 두 각이 서로를 초기화하지 않는다
    const both = drag(start, [{ pitch: 5 }, { pitch: 12 }, { spin: -8 }, { pitch: 16 }]);
    expect(both.cur.spin).toBeCloseTo(-8, 1);
    expect(both.cur.pitch).toBeCloseTo(16, 1);
    expect(touching(both.l)).toBeCloseTo(SHELF_DEPTH, 1);
    expect(lowest(body(both.l))).toBeCloseTo(0, 4); // 뜨지 않음
    // 저장·복원
    const back = normalize(JSON.parse(JSON.stringify(both.l)));
    expect(body(back)).toEqual(body(both.l));
  });

  it('책이 붙은 홈 배치에서 중간 각도로도 돈다: 옆 책은 양옆으로 모서리가 나온 만큼만 비켰다가 좁아지면 제자리로', () => {
    const mb: BookMap = Object.fromEntries(MOCKUP_BOOKS.map((b) => [b.id, b]));
    const id = MOCKUP_BOOKS.find((b) => b.title === '느린 계절')!.id;
    const shelf = placementOf(MOCKUP_LAYOUT, id)!.shelfId;
    const f = frontStateOf(MOCKUP_LAYOUT, mb, id)!;
    const x0 = bookXs(MOCKUP_LAYOUT, mb);
    const me = x0.get(id)!;
    for (const want of [5, 10, 16, 25, 40, 90, -16]) {
      const r = frontSpin(MOCKUP_LAYOUT, mb, id, f.state, f.qx, want);
      if (!r) throw new Error(`no-space ${want}`);
      expect(r.state.spin).toBeCloseTo(want, 1);
      expect(frontStateOf(r.layout, mb, id)!.qx).toBeCloseTo(f.qx, 1);
      // 손잡이를 놓으면 끄는 동안 마지막 배치에서 확정한다(비킨 옆 책 자리 그대로)
      expect(frontRelease(r.layout, mb, id, r.state, f.qx)).not.toBeNull();
      const x1 = bookXs(r.layout, mb);
      for (const q of r.layout.placements) {
        if (q.shelfId !== shelf || q.bookId === id) continue;
        const d = x1.get(q.bookId)! - x0.get(q.bookId)!;
        // 왼쪽 책은 왼쪽으로만, 오른쪽 책은 오른쪽으로만, 돌린 모서리가 나온 만큼(대각선 반 − 반폭 ≈ 2.4DU)까지
        expect(Math.abs(d)).toBeLessThanOrEqual(2.6);
        if (Math.abs(d) > 0.01) expect(Math.sign(d)).toBe(x0.get(q.bookId)! < me ? -1 : 1);
        if (Math.abs(want) >= 40) expect(Math.abs(d)).toBeLessThan(0.05);
      }
      const after = bodiesOf(r.layout, mb, shelf);
      for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) expect(gap(after[i], after[j])).toBeGreaterThan(-0.3);
    }
  });

  it('붙어 선 책 사이에서도 옆 책을 밀며 크게 돌고, 선반 앞 끝 밖으로 나가지 않는다(18권 배치)', () => {
    for (const want of [-60, 60]) {
      const f = frontStateOf(SAMPLE_LAYOUT, books, ID)!;
      const r = frontSpin(SAMPLE_LAYOUT, books, ID, f.state, f.qx, want);
      if (!r) throw new Error('no-space');
      expect(r.state.spin).toBeCloseTo(want, 0);
      expect(frontStateOf(r.layout, books, ID)!.qx).toBeCloseTo(f.qx, 1); // 제자리에서 돈다
      const after = bodiesOf(r.layout, books, 'shelf-3');
      for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) expect(gap(after[i], after[j])).toBeGreaterThan(-0.3);
      for (const p of corners(body(r.layout))) {
        expect(p.z).toBeGreaterThanOrEqual(-SHELF_FRONT - 0.01);
        expect(p.z).toBeLessThanOrEqual(SHELF_DEPTH + 0.01);
      }
    }
  });
});
