// 선반 한 칸의 책 프레임 계산(순수). 프레임 = 선반 공간의 3D 상자(카메라와 무관). 그리기·터치·그림자는 이 상자를
// 매 프레임 같은 카메라로 투영해 쓴다(투영 결과를 여기 저장하지 않는다).
import { boxSize, collide, CONTACT, frontPoly, hull, type Placed } from './box';
import { corners, fromPlaced, type Book3 } from './book3';
import { project, type Cam, type Point } from './camera';
import { SHELF, SHELF_USABLE_WIDTH, SHELF_X0, SHELF_X1 } from './geometry';
import { bookXs, checkSpace, itemBoxes, itemPositions, moveToDrawer, normalize, placementOf, setTilt, settle, shelfItems, type BookMap } from './layout-engine';
import { firstContact, leanContact, type LeanContact } from './lean';
import { contactOf, fallenSpan, isBacked, LEAN_MENU_MAX, leanStatics, supportTips, tipAngle, type Force } from './statics';
import { tiltToward, type Book, type Pose, type ShelfLayout, type Tilt } from './types';

export type { Point };

export type BookFrame = {
  bookId: string;
  itemKey: string;
  shelfId: string;
  pose: Pose;
  tilt: Tilt;
  stackIndex: number;
  // 기대려 했지만 닿을 곳이 없어(또는 선반 밖이라) 바로 선 책
  leanFailed?: boolean;
  // 기댄 상대 책
  leanOn?: string;
  // 받침을 잃고 바닥까지 넘어진 책(넘어진 방향). withLeans가 눕힌 책으로 바꾼다.
  fell?: -1 | 1;
  // 선반 공간 상자(그리기·충돌의 원본). 기댄 책은 기울어진 상자(angle)
  box: Placed;
};

export type ItemFrame = { key: string; x: number; width: number; bookIds: string[] };

// 선반 판 좌우 끝(선반 공간 x). 이 밖으로 쓰러지거나 지나가면 안 된다(판 3D 상자와 같은 값).
export const PLANK_BOUNDS = { min: SHELF_X0, max: SHELF_X1 };

function frameOf(p: Placed, bookId: string, itemKey: string, shelfId: string, tilt: Tilt, stackIndex: number): BookFrame {
  return { bookId, itemKey, shelfId, pose: p.pose, tilt, stackIndex, box: p };
}

// 선반 한 칸의 상자 배치와 프레임. 충돌·기대기는 선반 공간(가로·깊이·회전).
export function computeShelf(layout: ShelfLayout, books: BookMap, shelfId: string) {
  const positions = itemPositions(shelfItems(layout, shelfId), layout, books);
  const frames: BookFrame[] = [];
  const items: ItemFrame[] = [];
  for (const { item, x, width } of positions) {
    items.push({ key: item.key, x, width, bookIds: item.bookIds });
    itemBoxes(item, layout, books, x).forEach((box, i) => {
      const p = placementOf(layout, box.bookId)!;
      frames.push(frameOf(box, box.bookId, item.key, shelfId, item.stacked || p.pose !== 'spine' ? 0 : p.tilt, item.stacked ? i : 0));
    });
  }
  solveLeans(frames, layout);
  return { frames, items };
}

// 앞면 윤곽(깊이 밀림 없이 선반 공간 x, 바닥 0·위가 -). 테스트의 접촉·겹침 확인용
export function frontOutline(f: BookFrame): Point[] {
  return frontPoly(f.box).map((q) => ({ x: q.x, y: -q.y }));
}

const inside = (poly: { x: number }[]) => poly.every((p) => p.x >= PLANK_BOUNDS.min - 0.01 && p.x <= PLANK_BOUNDS.max + 0.01);

// 기대는 책들의 각도(선반 공간)와 버틸 수 있는지(statics.ts). 깊이 구간이 겹치는 상자만 장애물이다
// (뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
//  - 새로 기대는 책(저장된 기대기 없음): 똑바로 선 자세에서 기울여 LEAN_MENU_MAX까지 처음 닿는 곳. 닿지 않거나,
//    닿아도 무게중심이 축 안쪽이면(넘어짐 한계 이하) 다시 선다.
//  - 이미 기대 있던 책(저장된 각도): 그 각에서 아직 닿아 있으면 그대로(사용자가 꾸민 모습 유지). 받침이 비켜 닿지 않으면
//    그 각에서 더 넘어져 다음 책에 기대고, 미끄러짐 한계를 넘거나 닿을 곳이 없으면 바닥에 눕는다(fell, withLeans가 눕힌다).
//    다른 책이 파고들면(옆 책이 다가오면) 밀려 세워지며 처음 닿는 각을 다시 찾는다.
//  - 받침: 기댄 책들이 미는 힘에 받침이 되는 똑바로 선 책이 넘어가면(너머에 붙은 책이 없을 때) 그 책도 그쪽으로 기울고(도미노),
//    기댄 책이 기댄 책에 기대면 미는 힘을 이어받아 바닥 마찰을 확인한다.
// 순서: 왼쪽으로 기대는 책은 왼쪽부터, 오른쪽으로 기대는 책은 오른쪽부터. 서로 영향을 주므로 바뀌는 것이 없을 때까지 반복한다.
const MAX_ROUNDS = 8;
type Rest = { angle: number; on?: string; failed?: boolean; fell?: boolean };

function solveLeans(frames: BookFrame[], layout: ShelfLayout) {
  // 기운 책은 모두 기대기 결과를 처음부터 다시 푼다(받침으로 쓰이다 넘어간 책, 곧 저장된 기울기 없이 이번 계산에서 기운 책도)
  for (const f of frames) if (f.pose === 'spine' && f.tilt !== 0 && f.stackIndex === 0) f.leanFailed = false;
  if (!frames.some((f) => f.pose === 'spine' && f.tilt !== 0)) return;
  const standing = new Set<string>(); // 넘어짐 한계 이하라 다시 선 책
  const fallen = new Set<string>(); // 바닥에 누운 책(다른 책의 받침이 되지 못한다)
  const toppled = new Set<string>(); // 기댄 책이 미는 힘에 넘어간 받침 책(넘어지는 책처럼 90°까지 찾는다)
  const set = (f: BookFrame, r: Rest) => {
    Object.assign(f, { box: { ...f.box, angle: r.angle }, leanOn: r.on, leanFailed: !!r.failed, fell: r.fell ? (Math.sign(f.tilt) as -1 | 1) : undefined });
  };
  // 장애물: 바닥에 누운 책과, 이 책에 기대 있는 책(이 책이 기울면 함께 밀려난다)은 뺀다
  const othersOf = (f: BookFrame) => frames.filter((o) => o !== f && !fallen.has(o.bookId) && o.leanOn !== f.bookId).map((o) => o.box);
  const storedOf = (f: BookFrame) => {
    const s = placementOf(layout, f.bookId)?.lean;
    return s && Math.sign(s.angle) === Math.sign(f.tilt) ? s : undefined;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const leaners = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0 && !standing.has(f.bookId) && !fallen.has(f.bookId));
    const before = frames.map((f) => `${f.bookId}:${f.box.angle.toFixed(3)}:${f.leanOn ?? ''}:${f.fell ?? ''}:${f.leanFailed ? 1 : 0}`).join('|');
    // 마주 보고 기대는 두 권은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다(한 권씩 풀면 먼저 푼 책이 빈틈을 다 차지한다).
    // 둘 다 넘어짐 한계를 넘어야 하고, 다른 책·선반 끝과 부딪히지 않아야 한다. 아니면 한 권씩 푼다.
    const paired = new Set<string>();
    const byLeft = frames.filter((f) => f.stackIndex === 0 && !fallen.has(f.bookId)).sort((a, b) => a.box.x - b.box.x);
    for (let i = 0; i + 1 < byLeft.length; i++) {
      const a = byLeft[i];
      const b = byLeft[i + 1];
      if (!(a.pose === 'spine' && b.pose === 'spine' && a.tilt > 0 && b.tilt < 0) || standing.has(a.bookId) || standing.has(b.bookId)) continue;
      const rest = frames.filter((o) => o !== a && o !== b && !fallen.has(o.bookId)).map((o) => o.box);
      const ok = (d: number) => {
        const qa = { ...a.box, angle: d };
        const qb = { ...b.box, angle: -d };
        return !rest.some((o) => collide(qa, o) || collide(qb, o)) && inside(frontPoly(qa)) && inside(frontPoly(qb));
      };
      const c = firstContact((d) => collide({ ...a.box, angle: d }, { ...b.box, angle: -d }, CONTACT) || !ok(d));
      if (!c.found || c.angle === 0 || !ok(c.angle)) continue;
      // 마주 기댄 접촉에 닿았는지(다른 책이나 선반 끝에서 멈춘 것이 아닌지)
      if (!collide({ ...a.box, angle: c.angle + 0.6 }, { ...b.box, angle: -(c.angle + 0.6) }, CONTACT)) continue;
      if (c.angle <= tipAngle(a.box.size.w, a.box.size.h) || c.angle <= tipAngle(b.box.size.w, b.box.size.h)) continue;
      set(a, { angle: c.angle, on: b.bookId });
      set(b, { angle: -c.angle, on: a.bookId });
      paired.add(a.bookId).add(b.bookId);
    }
    const ordered = leaners.filter((f) => !paired.has(f.bookId)).sort((a, b) => a.box.x - b.box.x);
    const passes = [ordered.filter((f) => f.tilt < 0), [...ordered].reverse().filter((f) => f.tilt > 0)];
    for (let iter = 0; iter < 3; iter++) for (const pass of passes) for (const f of pass) set(f, restOf(f, othersOf(f), storedOf(f), toppled.has(f.bookId)));
    for (const f of leaners) if (f.fell) fallen.add(f.bookId);

    // 버티는지(무게중심·바닥 마찰)와 받침이 넘어가는지. 기대는 사슬의 바깥(아무도 기대지 않은 책)부터 미는 힘을 넘긴다.
    const active = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0 && !standing.has(f.bookId) && !fallen.has(f.bookId) && f.leanOn && f.box.angle);
    const byId = new Map(frames.map((f) => [f.bookId, f]));
    const loads = new Map<string, Force[]>();
    const leansOnMe = (id: string) => active.filter((f) => f.leanOn === id && !(paired.has(f.bookId) && paired.has(id)));
    const order: BookFrame[] = [];
    const pending = new Set(active.map((f) => f.bookId));
    while (pending.size) {
      const pick = active.find((f) => pending.has(f.bookId) && leansOnMe(f.bookId).every((g) => !pending.has(g.bookId))) ?? active.find((f) => pending.has(f.bookId))!;
      pending.delete(pick.bookId);
      order.push(pick);
    }
    let changed = false;
    for (const f of order) {
      const s = byId.get(f.leanOn!);
      if (!s) continue;
      const st = leanStatics(f.box, contactOf(f.box, s.box), loads.get(f.bookId) ?? []);
      if (!st.ok) {
        changed = true;
        if (st.reason === 'tip') standing.add(f.bookId);
        else fallen.add(f.bookId);
        continue;
      }
      // 마주 기댄 짝은 서로의 받침이다: 둘 사이 접촉 힘은 하나뿐이라 상대가 미는 힘을 또 더하지 않고 각자 판정한다
      // (더하면 먼저 푼 책의 힘이 두 번 세어져 좌우를 바꾸면 결과가 달라진다)
      if (s.leanOn === f.bookId) continue;
      loads.set(s.bookId, [...(loads.get(s.bookId) ?? []), st.onSupport]);
    }
    // 받침이 되는 똑바로 선 세운 책: 미는 힘에 넘어가면 그쪽으로 기운다(다음 바퀴에 넘어지는 책으로 푼다)
    for (const [id, pushes] of loads) {
      const s = byId.get(id);
      if (!s || s.pose !== 'spine' || s.tilt !== 0 || s.stackIndex !== 0) continue;
      const others = othersOf(s);
      const d = supportTips(s.box, pushes, (dir) => isBacked(s.box, dir, others));
      if (!d) continue;
      changed = true;
      s.tilt = tiltToward(d);
      s.leanFailed = false;
      toppled.add(s.bookId);
    }
    for (const id of standing) {
      const f = byId.get(id)!;
      set(f, { angle: 0, failed: true });
    }
    for (const id of fallen) {
      const f = byId.get(id)!;
      if (!f.fell) set(f, { angle: 0, fell: true });
    }
    const after = frames.map((f) => `${f.bookId}:${f.box.angle.toFixed(3)}:${f.leanOn ?? ''}:${f.fell ?? ''}:${f.leanFailed ? 1 : 0}`).join('|');
    if (!changed && after === before) break;
  }
}

// 한 권이 쉬는 자세: 저장된 기대기·옆 상자로 처음 닿는 각과 그 각에서 버티는지(넘어짐·미끄러짐 한계, 힘의 사슬은 solveLeans)
// falling: 받침을 잃었거나 밀려 넘어가는 책(90°까지 찾고, 닿을 곳이 없으면 바닥에 눕는다)
function restOf(f: BookFrame, others: Placed[], stored?: { angle: number; on: string }, falling = false): Rest {
  const dir = Math.sign(f.tilt) as -1 | 1;
  const base = { ...f.box, angle: 0 };
  const T = base.size.w;
  const H = base.size.h;
  // 미끄러짐은 여기서 보지 않는다: 평평한 받침 공식(slipAngle)은 낮은 받침의 모서리에 닿을 때 맞지 않아(버틸 책이 눕는다)
  // 실제 접촉점의 힘 평형(solveLeans의 leanStatics)이 정한다
  const holds = (c: LeanContact): Rest => {
    if (c.outside || !c.found) return { angle: 0, fell: true };
    if (c.angle <= tipAngle(T, H)) return { angle: 0, failed: true };
    return { angle: dir * c.angle, on: c.on };
  };
  if (falling) return holds(leanContact(base, dir, others, PLANK_BOUNDS, 0, 90));
  if (stored) {
    const q = { ...base, angle: stored.angle };
    if (!others.some((o) => collide(q, o)) && inside(frontPoly(q))) {
      // 그 각에서 더 넘어지며(받침이 그대로면 바로 닿는다) 처음 닿는 곳. 90°까지 닿지 않으면 바닥에 눕는다.
      const c = leanContact(base, dir, others, PLANK_BOUNDS, Math.abs(stored.angle), 90);
      if (c.found && Math.abs(c.angle - Math.abs(stored.angle)) < 0.05) {
        // 예전 규칙으로 저장된 각이 넘어짐 한계 이하면 버티지 못하고 선다(불러올 때 restore가 틈을 벌려 둔다)
        return Math.abs(stored.angle) <= tipAngle(T, H) ? { angle: 0, failed: true } : { angle: stored.angle, on: c.on };
      }
      return holds(c);
    }
    // 옆 책이 다가와 파고든다: 밀려 세워지며 처음 닿는 각
    const c = leanContact(base, dir, others, PLANK_BOUNDS, 0, Math.max(LEAN_MENU_MAX, Math.abs(stored.angle)));
    if (!c.found) return { angle: 0, failed: true };
    return holds(c);
  }
  const c = leanContact(base, dir, others, PLANK_BOUNDS, 0, LEAN_MENU_MAX);
  if (!c.found) return { angle: 0, failed: true };
  return holds(c);
}

// 바닥에 누운 책을 눕힌 책 자리로 바꾼다: 축 모서리에서 키만큼 넘어진 쪽으로, 깊이는 서 있던 그대로(발을 축으로 돌 뿐 앞뒤로 움직이지 않는다).
// 오른쪽으로 넘어진 책은 머리가 오른쪽(flip)이다. 무게중심이 선반 판 끝 밖이면 선반에서 떨어진 것이라
// 서랍으로 간다. 판 안이지만 끝을 조금 넘으면(배치 규칙상 튀어나올 수 없어) 안쪽으로 밀어 눕히고, 그 줄에 자리가 없으면 서랍으로.
function layFallen(layout: ShelfLayout, books: BookMap, fallen: BookFrame[]): ShelfLayout {
  let next = layout;
  for (const f of fallen) {
    const p = placementOf(next, f.bookId);
    if (!p) continue;
    const span = fallenSpan({ ...f.box, angle: 0 }, f.fell!);
    const center = (span.x0 + span.x1) / 2;
    if (center < PLANK_BOUNDS.min || center > PLANK_BOUNDS.max) {
      next = detachToDrawer(next, books, f.bookId);
      continue;
    }
    const desired = bookXs(next, books);
    const x = Math.max(SHELF.innerLeft, Math.min(SHELF.innerLeft + SHELF_USABLE_WIDTH - f.box.size.h, span.x0));
    desired.set(f.bookId, x);
    const placements = next.placements.map((q) =>
      q.bookId === f.bookId
        ? { ...q, pose: 'horizontal' as const, tilt: 0 as Tilt, lean: undefined, pos: x, spin: undefined, pitch: undefined, depth: f.box.z, flip: f.fell! > 0 || undefined }
        : q,
    );
    const laid = settle(normalize({ ...next, placements }), books, desired, p.shelfId);
    // 미끄러지며 눕는 책은 넘어진 반대쪽으로 밀려날 수 있다(받침 쪽 책에 머리가 닿아 바닥이 미끄러짐). 키만큼까지만 본다.
    const moved = ((bookXs(laid, books).get(f.bookId) ?? x) - x) * -f.fell!;
    const fits = !checkSpace(laid, books, p.shelfId) && moved > -1 && moved < f.box.size.h;
    next = fits ? laid : detachToDrawer(next, books, f.bookId);
  }
  return next;
}

function detachToDrawer(layout: ShelfLayout, books: BookMap, bookId: string): ShelfLayout {
  const r = moveToDrawer(layout, bookId, books);
  return r.ok ? r.layout : layout;
}

// 불러올 때: 예전 규칙(고정 7°·8° 틈)으로 저장된 기대기 중 버티지 못하는 각(넘어짐 한계 이하)에 걸려 있던 책은
// 메뉴로 기울일 때처럼 틈을 맞춰 다시 기대게 한다(사용자가 고른 기울기를 지킨다). 자리가 모자라면 그대로 두어 withLeans가 바로 세운다.
export function ensureLeanGaps(layout: ShelfLayout, books: BookMap): { layout: ShelfLayout; changed: boolean } {
  let cur = layout;
  let changed = false;
  const leaning = (l: ShelfLayout, p: { bookId: string; shelfId: string }) => {
    const f = computeShelf(l, books, p.shelfId).frames.find((q) => q.bookId === p.bookId);
    return !!f && !!f.box.angle && !f.leanFailed && !f.fell;
  };
  for (const p of layout.placements) {
    if (p.pose !== 'spine' || p.tilt === 0 || p.stackId) continue;
    if (leaning(cur, p)) continue;
    const r = setTilt(cur, books, p.bookId, p.tilt);
    if (!r.ok || !leaning(r.layout, p)) continue;
    cur = r.layout;
    changed = true;
  }
  return { layout: cur, changed };
}

// 확정할 때 기대기 결과를 저장한다. 기댈 수 없던 책은 놓은 자리에서 바로 서고(tilt 0), 받침을 잃고 바닥까지 넘어진 책은 눕히며,
// 미는 힘에 넘어간 받침 책은 기운 책으로 저장한다. 눕힌 책이 생기면 그 줄을 다시 푼다(눕힌 책이 다른 책의 받침이 될 수 있다).
// only: 그 선반의 기대기만 다시 푼다(나머지 선반은 그대로 둔다)
export function withLeans(layout: ShelfLayout, books: BookMap, only?: string): ShelfLayout {
  let cur = layout;
  for (let pass = 0; pass < 4; pass++) {
    const result = new Map<string, BookFrame>();
    for (const shelf of cur.shelves) if (!only || shelf.id === only) for (const f of computeShelf(cur, books, shelf.id).frames) result.set(f.bookId, f);
    const next: ShelfLayout = {
      ...cur,
      placements: cur.placements.map((p) => {
        if (only && p.shelfId !== only) return p;
        const f = result.get(p.bookId);
        if (!f || p.pose !== 'spine' || f.tilt === 0 || f.stackIndex !== 0) return p.lean ? { ...p, lean: undefined } : p;
        if (f.leanFailed || f.fell) return { ...p, tilt: 0 as Tilt, lean: undefined };
        return { ...p, tilt: f.tilt, lean: f.leanOn ? { angle: Math.round(f.box.angle * 1000) / 1000, on: f.leanOn } : undefined };
      }),
    };
    const fallen = [...result.values()].filter((f) => f.fell);
    if (!fallen.length) return next;
    cur = layFallen(next, books, fallen);
  }
  return cur;
}

export function pointInPoly(pt: Point, poly: Point[]) {
  'worklet';
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 상자를 카메라로 투영한 외곽(설계 단위, 원점 = 책 기준선 왼쪽 끝)
export function outlineOf(cam: Cam, b: Book3): Point[] {
  'worklet';
  const out: Point[] = [];
  for (const c of corners(b)) out.push(project(cam, c));
  return hull(out);
}

// 프레임의 화면 외곽 경계 상자(설계 단위): 접근성 칸·정보 상자 자리처럼 정지한 자세로 충분한 곳
export function frameBBox(f: BookFrame, cam: Cam) {
  const poly = outlineOf(cam, fromPlaced(f.box));
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// 선반 밖에서 한 권만 그릴 때(서랍·상세): 똑바로 선 상자 하나의 프레임. 바닥 = FLOOR, 왼쪽 = 0.
export function standaloneFrame(book: Book, pose: Pose): BookFrame {
  const box: Placed = { bookId: book.id, pose, size: boxSize(book, pose), x: 0, y: 0, z: 0, angle: 0 };
  return frameOf(box, book.id, book.id, '', 0, 0);
}

// 선반 한 칸의 3D 자세(그리기·전환 경로의 입력)
export function bodiesOf(layout: ShelfLayout, books: BookMap, shelfId: string): Book3[] {
  return computeShelf(layout, books, shelfId).frames.map((f) => fromPlaced(f.box));
}
