// 책 면이 받는 그림자: 가리개가 받는 면보다 빛 쪽에 있을 때만, 경계는 가리개를 따라 움직이고 받는 책 위치와는 무관하다.
import { corners, faceCorners, faceNormal, rot, type Book3 } from '../book3';
import { shadowOnPlane, travelOf } from '../cast-shadow';
import { SHELF_FRONT } from '../geometry';
import { applySwapTarget, bookXs, findSwapTarget, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import type { ShelfLayout } from '../types';
import { light } from '@/ui/theme';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const L = travelOf(light.dir);
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const body = (l: ShelfLayout, id: string) => bodiesOf(l, books, 'shelf-2').find((b) => b.id === id)!;

// 받는 책 앞면(책등) 평면 위 그림자의 오른쪽 끝 x
function shadowRight(occ: Book3, recv: Book3) {
  const n = rot(recv.roll, recv.yaw, faceNormal('spine'), recv.spin ?? 0, recv.pitch ?? 0);
  const p0 = corners(recv)[faceCorners('spine')[0]];
  const r = shadowOnPlane(corners(occ), p0, n, L);
  return r.pts.length ? Math.max(...r.pts.map((q) => q.x)) : null;
}

describe('월든 → 채식주의자', () => {
  it('같은 깊이(앞면이 같은 평면)면 그림자가 닿지 않는다', () => {
    expect(shadowRight(body(SAMPLE_LAYOUT, 'b07'), body(SAMPLE_LAYOUT, 'b09'))).toBeNull();
  });

  it('월든을 앞으로 당기면 그림자가 생기고, 끝(오른쪽 경계)은 월든 오른쪽 끝 + 앞으로 나온 거리 × (빛의 x/z)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const w = body(l, 'b07');
    const right = shadowRight(w, body(l, 'b09'))!;
    let wx = -Infinity;
    for (const c of corners(w)) wx = Math.max(wx, c.x);
    expect(right).toBeCloseTo(wx + SHELF_FRONT * (L.x / L.z), 1);
  });

  it('경계는 월든을 따라 움직이고, 채식주의자를 옮겨도 그대로(책등의 특정 위치에 붙어 있지 않다)', () => {
    const l = ok(setDepth(SAMPLE_LAYOUT, books, 'b07', -SHELF_FRONT));
    const base = shadowRight(body(l, 'b07'), body(l, 'b09'))!;
    // 월든을 오른쪽으로 6DU
    const x7 = bookXs(l, books).get('b07')!;
    const w7 = bodiesOf(l, books, 'shelf-2').find((b) => b.id === 'b07')!;
    let cx = 0;
    for (const c of corners(w7)) cx += c.x / 8;
    const moved = applySwapTarget(l, books, 'b07', findSwapTarget(l, books, 'b07', cx + 6));
    if (moved.ok) {
      const dx = bookXs(moved.layout, books).get('b07')! - x7;
      expect(shadowRight(body(moved.layout, 'b07'), body(moved.layout, 'b09'))).toBeCloseTo(base + dx, 1);
    }
    // 채식주의자만 같은 깊이에서 옆으로: 받는 평면이 같으므로 경계 x는 그대로
    const b9 = body(l, 'b09');
    const shifted = { ...b9, t: { ...b9.t, x: b9.t.x + 5 } };
    expect(shadowRight(body(l, 'b07'), shifted)).toBeCloseTo(base, 6);
  });
});
