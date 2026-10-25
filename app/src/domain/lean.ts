// 기대기 각 찾기(순수). 세운 책을 바닥 모서리를 축으로 쓰러뜨리며 옆 책(또는 쌓인 책·표지 책)의 실제 3D 상자에
// 처음 닿는 각도를 찾는다. 그 각도에서 버틸 수 있는지(무게중심·마찰)는 statics.ts가 판정한다.
import { fromPlaced, gap } from './book3';
import { CONTACT, frontPoly, type Placed } from './box';
import { LEAN_MENU_MAX } from './statics';

export type LeanContact = {
  angle: number; // 처음 닿는(또는 선반 끝을 넘는) 각도, 부호 없음
  on?: string; // 닿은 책
  found: boolean; // 책에 닿았다
  outside: boolean; // 닿기 전에 선반 판 끝을 넘는다(그쪽으로 넘어지면 선반에서 떨어진다)
};

// 기우는 쪽 바닥 모서리를 축으로 from°에서 to°까지 쓰러뜨리며 처음 닿는 곳. 깊이가 겹치는 상자만 장애물이다
// (화면에서 나란해도 깊이가 달라 실제로 닿지 않는 책은 받침이 되지 못한다).
export function leanContact(p: Placed, dir: -1 | 1, others: Placed[], bounds: { min: number; max: number }, from = 0, to = LEAN_MENU_MAX): LeanContact {
  const obstacles = others.filter((o) => o.bookId !== p.bookId).map((o) => ({ id: o.bookId, b: fromPlaced(o) }));
  const at = (deg: number) => fromPlaced({ ...p, angle: dir * deg });
  const out = (deg: number) => frontPoly({ ...p, angle: dir * deg }).some((q) => q.x < bounds.min - 0.01 || q.x > bounds.max + 0.01);
  const touching = (deg: number) => {
    const me = at(deg);
    return obstacles.find((o) => gap(me, o.b) < -CONTACT)?.id;
  };
  const c = firstContact((deg) => out(deg) || touching(deg) !== undefined, from, to);
  if (!c.found) return { angle: from, found: false, outside: false };
  const on = touching(c.angle + 0.6);
  return { angle: c.angle, on, found: on !== undefined, outside: on === undefined };
}

// hits(deg)가 처음 참이 되는 직전 각도: from에서 to까지 0.5도 간격으로 찾고 이분법으로 좁힌다.
// from에서 바로 닿으면 from, to까지 닿지 않으면 found=false.
export function firstContact(hits: (deg: number) => boolean, from = 0, to = LEAN_MENU_MAX) {
  if (hits(from + 0.3)) return { angle: from, found: true };
  const step = 0.5;
  let lo = from;
  let hi = -1;
  for (let d = from + step; d <= to + 1e-9; d += step) {
    if (hits(d)) {
      hi = d;
      break;
    }
    lo = d;
  }
  if (hi < 0) return { angle: from, found: false };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) hi = mid;
    else lo = mid;
  }
  return { angle: lo, found: true };
}
