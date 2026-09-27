// 순수 배치 계산. UI와 저장소는 여기서 검증된 레이아웃만 확정한다.
import {
  bookHeight,
  CAMERA,
  frontWidth,
  LYING_BACK_Z,
  H_OVERHANG,
  LEGACY_LEAN,
  MAX_STACK,
  MENU_LEAN,
  SHELF,
  SHELF_USABLE_WIDTH,
  singleFootprint,
  stackFootprint,
  visibleBookOutline,
  HOME_SHELF_COUNT,
} from './geometry';
import type { Book, BookPlacement, Pose, ShelfLayout, ShelfLayoutV1, Tilt } from './types';

export type BookMap = Record<string, Book>;

export type ShelfItem = {
  key: string; // 단권은 bookId, 그룹은 stackId
  shelfId: string;
  order: number;
  bookIds: string[]; // 아래에서 위 순서
  stacked: boolean;
};

export type FailReason =
  | 'no-space'
  | 'stack-full'
  | 'not-stackable'
  | 'tilt-only-spine'
  | 'unknown-book'
  | 'unknown-shelf'
  | 'shelf-not-empty'
  | 'in-drawer'
  | 'no-change';

export type Result = { ok: true; layout: ShelfLayout } | { ok: false; reason: FailReason };

export type DropTarget =
  | { kind: 'insert'; shelfId: string; index: number; x?: number } // index는 끌고 있는 책을 뺀 뒤의 자리, x는 빈 공간에 놓을 때 왼쪽 끝
  | { kind: 'stack'; shelfId: string; itemKey: string };

const stackIdFor = (bottomBookId: string) => `stack:${bottomBookId}`;

export function sortedShelves(layout: ShelfLayout) {
  return [...layout.shelves].sort((a, b) => a.order - b.order);
}

// 선반별 자리 목록(순서대로).
export function shelfItems(layout: ShelfLayout, shelfId: string): ShelfItem[] {
  const byKey = new Map<string, ShelfItem>();
  for (const p of layout.placements) {
    if (p.shelfId !== shelfId) continue;
    const key = p.stackId ?? p.bookId;
    let item = byKey.get(key);
    if (!item) {
      item = { key, shelfId, order: p.order, bookIds: [], stacked: !!p.stackId };
      byKey.set(key, item);
    }
    item.bookIds.push(p.bookId);
  }
  const stackOrderOf = new Map(layout.placements.map((p) => [p.bookId, p.stackOrder ?? 0]));
  const items = [...byKey.values()].sort((a, b) => a.order - b.order);
  for (const it of items) it.bookIds.sort((a, b) => stackOrderOf.get(a)! - stackOrderOf.get(b)!);
  return items;
}

export function placementOf(layout: ShelfLayout, bookId: string) {
  return layout.placements.find((p) => p.bookId === bookId);
}

export function itemWidth(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  if (item.stacked) return stackFootprint(item.bookIds.map((id) => books[id])).width;
  const p = placementOf(layout, item.bookIds[0])!;
  return singleFootprint(books[p.bookId], p).width;
}

export function itemHeight(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  if (item.stacked) return stackFootprint(item.bookIds.map((id) => books[id])).height;
  const p = placementOf(layout, item.bookIds[0])!;
  return singleFootprint(books[p.bookId], p).height;
}

type XY = { x: number; y: number };

function intervalAt(poly: XY[], y: number) {
  const xs: number[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if (y < Math.min(a.y, b.y) - 1e-6 || y > Math.max(a.y, b.y) + 1e-6) return;
    if (Math.abs(a.y - b.y) < 1e-6) xs.push(a.x, b.x);
    else xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  });
  return xs.length ? { left: Math.min(...xs), right: Math.max(...xs) } : null;
}

// 눕힌 책 끝면이 화면에서 차지하는 폭(DU): 깊이 끝까지 × 카메라 kx
function lyingEndGap(item: ShelfItem, books: BookMap) {
  const depth = Math.max(...item.bookIds.map((id) => frontWidth(books[id])));
  return (LYING_BACK_Z + depth) * CAMERA.kx;
}

function packedPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  const packed: { item: ShelfItem; x: number; width: number; poly: XY[] }[] = [];
  for (const item of items) {
    const width = itemWidth(item, layout, books), height = itemHeight(item, layout, books);
    const poly = item.stacked
      ? [{ x: 0, y: -height }, { x: width, y: -height }, { x: width, y: 0 }, { x: 0, y: 0 }]
      : visibleBookOutline(books[item.bookIds[0]], { ...placementOf(layout, item.bookIds[0])!, tilt: 0 });
    let x = 0;
    const last = packed[packed.length - 1];
    // 눕힌 책(더미) 바로 뒤에는 오른쪽 끝면이 보일 만큼 띄운다(뒤에 놓여 옆 책 앞면에 가려지지 않게, 시안처럼)
    if (last && isHorizontalItem(last.item, layout)) x = last.x + last.width + lyingEndGap(last.item, books);
    for (const prev of packed) {
      for (const y of [...prev.poly, ...poly].map((q) => q.y)) {
        const a = intervalAt(prev.poly, y), b = intervalAt(poly, y);
        if (a && b) x = Math.max(x, prev.x + a.right - b.left + SHELF.gap);
      }
    }
    packed.push({ item, x, width, poly });
  }
  return packed;
}

// ---------- 빈틈과 위치 ----------
// 책은 윤곽대로 붙인 위치(packed) + 앞쪽 빈틈의 누적에 선다. 기울기는 빈틈 안에서만 생기므로 점유 폭은 늘지 않는다.

const rad = (d: number) => (d * Math.PI) / 180;

function posOf(layout: ShelfLayout, item: ShelfItem) {
  return placementOf(layout, item.bookIds[0])?.pos;
}

// 위치 값이 하나도 없는 예전 저장본: 가운데 정렬 + 기울인 책이 7도로 기댈 만큼의 빈틈을 만들어 준다.
function legacyXs(items: ShelfItem[], layout: ShelfLayout, books: BookMap, packed: { x: number; width: number }[]) {
  const gaps = items.map(() => 0);
  items.forEach((item, i) => {
    if (item.stacked) return;
    const p = placementOf(layout, item.bookIds[0])!;
    if (p.pose !== 'spine' || p.tilt === 0) return;
    const need = bookHeight(books[p.bookId]) * Math.sin(rad(LEGACY_LEAN)) + 0.3;
    if (p.tilt < 0 && i > 0) gaps[i] += need;
    if (p.tilt > 0 && i < items.length - 1) gaps[i + 1] += need;
  });
  const used = packed.length ? packed[packed.length - 1].x + packed[packed.length - 1].width : 0;
  const extra = gaps.reduce((a, g) => a + g, 0);
  gaps[0] += Math.max(0, (SHELF_USABLE_WIDTH - used - extra) / 2);
  let acc = SHELF.innerLeft;
  return packed.map((p, i) => {
    acc += gaps[i];
    return p.x + acc;
  });
}

// 원하는 위치를 최대한 지키며 겹치지 않게 민다(윤곽대로 붙인 간격이 최소 간격). 오른쪽 끝을 넘으면 왼쪽으로 되민다.
// 원하는 위치가 없는 자리는 앞 자리 바로 뒤에 붙는다.
function resolveXs(items: ShelfItem[], layout: ShelfLayout, packed: { x: number; width: number }[], want: (i: number) => number | undefined) {
  const { lo, hi } = bounds(items, layout);
  const xs: number[] = [];
  items.forEach((_, i) => {
    const w = want(i);
    const min = i === 0 ? lo : xs[i - 1] + (packed[i].x - packed[i - 1].x);
    xs.push(w === undefined ? min : Math.max(w, min));
  });
  const n = items.length;
  if (n && xs[n - 1] + packed[n - 1].width > hi) {
    xs[n - 1] = hi - packed[n - 1].width;
    for (let i = n - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - (packed[i + 1].x - packed[i].x));
  }
  return xs;
}

export function itemPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  const packed = packedPositions(items, layout, books);
  const xs = items.every((it) => posOf(layout, it) === undefined)
    ? legacyXs(items, layout, books, packed)
    : resolveXs(items, layout, packed, (i) => posOf(layout, items[i]));
  return packed.map(({ item, width }, i) => ({ item, x: xs[i], width }));
}

// 선반 끝 한계: 눕힌 책(쌓기 포함)은 끝을 조금 넘어도 된다.
function bounds(items: ShelfItem[], layout: ShelfLayout) {
  const lo = items.length && isHorizontalItem(items[0], layout) ? -H_OVERHANG : 0;
  const hi = SHELF_USABLE_WIDTH + (items.length && isHorizontalItem(items[items.length - 1], layout) ? H_OVERHANG : 0);
  return { lo: SHELF.innerLeft + lo, hi: SHELF.innerLeft + hi };
}

// 오른쪽 끝(점유 끝)
export function usedWidth(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  const pos = itemPositions(items, layout, books);
  return pos.length ? pos[pos.length - 1].x + pos[pos.length - 1].width - SHELF.innerLeft : 0;
}

// 모든 책의 현재 위치(자리 왼쪽 끝). 연산 전후로 책이 제자리에 머물게 할 때 쓴다.
export function bookXs(layout: ShelfLayout, books: BookMap) {
  const xs = new Map<string, number>();
  for (const shelf of layout.shelves) {
    for (const pos of itemPositions(shelfItems(layout, shelf.id), layout, books)) {
      pos.item.bookIds.forEach((id) => xs.set(id, pos.x));
    }
  }
  return xs;
}

// 연산 뒤 위치 확정: desired(연산 전 위치 + 옮긴 책의 목표 위치)를 지키며 겹치면 민다. 결과를 pos로 저장한다.
export function settle(layout: ShelfLayout, books: BookMap, desired: Map<string, number>): ShelfLayout {
  const posByBook = new Map<string, number>();
  for (const shelf of layout.shelves) {
    const items = shelfItems(layout, shelf.id);
    if (!items.length) continue;
    const packed = packedPositions(items, layout, books);
    const xs = resolveXs(items, layout, packed, (i) => items[i].bookIds.map((id) => desired.get(id)).find((v) => v !== undefined));
    items.forEach((item, i) => item.bookIds.forEach((id) => posByBook.set(id, Math.round(xs[i] * 100) / 100)));
  }
  return { ...layout, placements: layout.placements.map((p) => (posByBook.has(p.bookId) ? { ...p, pos: posByBook.get(p.bookId) } : p)) };
}

// Keep three shelves. Books on removed shelves are preserved in the drawer.
export function threeShelfLayout(layout: ShelfLayout): ShelfLayout {
  const shelves = sortedShelves(layout).slice(0, HOME_SHELF_COUNT);
  for (let n = 1; shelves.length < HOME_SHELF_COUNT; n++) {
    const id = `shelf-${n}`;
    if (!shelves.some((s) => s.id === id)) shelves.push({ id, order: shelves.length });
  }
  const kept = new Set(shelves.map((s) => s.id));
  const overflow = layout.placements.filter((p) => !kept.has(p.shelfId)).map((p) => p.bookId);
  return normalize({ ...layout, shelves, placements: layout.placements.filter((p) => kept.has(p.shelfId)), drawer: [...layout.drawer, ...overflow] });
}

export function isHorizontalItem(item: ShelfItem, layout: ShelfLayout) {
  return item.bookIds.every((id) => placementOf(layout, id)?.pose === 'horizontal');
}

// 선반별 order, 그룹의 stackOrder와 stackId를 다시 매긴다. 한 권만 남은 그룹은 풀어준다.
export function normalize(layout: ShelfLayout): ShelfLayout {
  const shelves = sortedShelves(layout).map((s, i) => ({ id: s.id, order: i }));
  const placements: BookPlacement[] = [];
  for (const shelf of shelves) {
    shelfItems(layout, shelf.id).forEach((item, order) => {
      const single = item.bookIds.length === 1;
      const stackId = single ? undefined : stackIdFor(item.bookIds[0]);
      item.bookIds.forEach((bookId, stackOrder) => {
        const p = placementOf(layout, bookId)!;
        const next: BookPlacement = {
          bookId,
          shelfId: shelf.id,
          order,
          pose: p.pose,
          tilt: p.pose === 'spine' ? p.tilt : 0,
        };
        if (stackId) {
          next.stackId = stackId;
          next.stackOrder = stackOrder;
        }
        const src = placementOf(layout, item.bookIds[0])!;
        if (src.pos !== undefined) next.pos = src.pos;
        if (p.lean && p.pose === 'spine' && p.tilt !== 0) next.lean = p.lean;
        placements.push(next);
      });
    });
  }
  const placed = new Set(placements.map((p) => p.bookId));
  const drawer = [...new Set(layout.drawer ?? [])].filter((id) => !placed.has(id));
  return { version: 2, shelves, placements, drawer };
}

export function migrate(saved: ShelfLayout | ShelfLayoutV1): ShelfLayout {
  if (saved.version === 1) return normalize({ ...saved, version: 2, drawer: [] });
  return normalize(saved);
}

// 책을 자리에서 빼낸다. 옆 책들은 제자리에 남고 빈자리가 생긴다(books가 없으면 위치 보존 없이 뺀다).
// 그룹에서 빼면 나머지는 빈틈 없이 내려앉는다.
export function detach(layout: ShelfLayout, bookId: string, books?: BookMap): ShelfLayout {
  const removed = normalize({ ...layout, placements: layout.placements.filter((p) => p.bookId !== bookId) });
  return books ? settle(removed, books, bookXs(layout, books)) : removed;
}

function withOrders(layout: ShelfLayout, shelfId: string, items: ShelfItem[]): BookPlacement[] {
  const orderOf = new Map<string, number>();
  items.forEach((it, i) => it.bookIds.forEach((id) => orderOf.set(id, i)));
  return layout.placements.map((p) =>
    p.shelfId === shelfId && orderOf.has(p.bookId) ? { ...p, order: orderOf.get(p.bookId)! } : p,
  );
}

function insertItem(
  layout: ShelfLayout,
  placement: Omit<BookPlacement, 'shelfId' | 'order'>,
  shelfId: string,
  index: number,
  books?: BookMap,
  x?: number,
): ShelfLayout {
  const items = shelfItems(layout, shelfId);
  const at = Math.max(0, Math.min(index, items.length));
  const newItem: ShelfItem = { key: placement.bookId, shelfId, order: at, bookIds: [placement.bookId], stacked: false };
  items.splice(at, 0, newItem);
  const placements = withOrders(layout, shelfId, items);
  placements.push({ bookId: placement.bookId, pose: placement.pose, tilt: placement.tilt, shelfId, order: at });
  const next = normalize({ ...layout, placements });
  if (!books) return next;
  // 다른 책은 제자리, 새 책은 x(없으면 앞 책 바로 뒤)에 두고 겹치면 민다.
  const desired = bookXs(layout, books);
  if (x !== undefined) desired.set(placement.bookId, x);
  else desired.delete(placement.bookId);
  return settle(next, books, desired);
}

// 여러 선반의 공간·무결성을 한 번에 확인한다.
export function checkSpace(layout: ShelfLayout, books: BookMap): FailReason | null {
  for (const shelf of layout.shelves) {
    const items = shelfItems(layout, shelf.id);
    if (!items.length) continue;
    const pos = itemPositions(items, layout, books);
    const { lo, hi } = bounds(items, layout);
    if (pos[0].x < lo - 0.01 || pos[pos.length - 1].x + pos[pos.length - 1].width > hi + 0.01) return 'no-space';
  }
  return null;
}

export function validate(layout: ShelfLayout, books: BookMap, expectedIds?: string[]): string[] {
  const errors: string[] = [];
  const shelfIds = new Set(layout.shelves.map((s) => s.id));
  const seen = new Set<string>();
  for (const p of layout.placements) {
    if (seen.has(p.bookId)) errors.push(`duplicate:${p.bookId}`);
    seen.add(p.bookId);
    if (!books[p.bookId]) errors.push(`unknown-book:${p.bookId}`);
    if (!shelfIds.has(p.shelfId)) errors.push(`unknown-shelf:${p.bookId}`);
    if (p.pose !== 'spine' && p.tilt !== 0) errors.push(`tilt:${p.bookId}`);
    if (![-7, 0, 7].includes(p.tilt)) errors.push(`tilt-value:${p.bookId}`);
  }
  for (const id of layout.drawer) {
    if (seen.has(id)) errors.push(`duplicate:${id}`);
    seen.add(id);
    if (!books[id]) errors.push(`unknown-book:${id}`);
  }
  if (expectedIds) {
    for (const id of expectedIds) if (!seen.has(id)) errors.push(`missing:${id}`);
  }
  const groups = new Map<string, BookPlacement[]>();
  for (const p of layout.placements) {
    if (!p.stackId) continue;
    groups.set(p.stackId, [...(groups.get(p.stackId) ?? []), p]);
  }
  for (const [id, members] of groups) {
    if (members.length < 2 || members.length > MAX_STACK) errors.push(`stack-size:${id}`);
    if (new Set(members.map((m) => `${m.shelfId}/${m.order}`)).size !== 1) errors.push(`stack-slot:${id}`);
    const orders = members.map((m) => m.stackOrder).sort();
    if (orders.some((o, i) => o !== i)) errors.push(`stack-order:${id}`);
    if (members.some((m) => m.pose !== 'horizontal')) errors.push(`stack-pose:${id}`);
  }
  for (const shelf of layout.shelves) {
    const orders = shelfItems(layout, shelf.id).map((it) => it.order);
    if (new Set(orders).size !== orders.length) errors.push(`order:${shelf.id}`);
  }
  if (errors.length === 0 && checkSpace(layout, books)) errors.push('no-space');
  return errors;
}

// 구조(선반·순서·자세·쌓기)와 실제 위치가 같으면 변화 없음. 저장 형식 차이(pos 유무, 기대기 캐시)는 무시한다.
function sameArrangement(a: ShelfLayout, b: ShelfLayout, books: BookMap) {
  const strip = (l: ShelfLayout) => JSON.stringify(normalize({ ...l, placements: l.placements.map(({ pos: _p, lean: _l, x: _x, ...rest }) => rest) }));
  if (strip(a) !== strip(b)) return false;
  const xa = bookXs(a, books);
  const xb = bookXs(b, books);
  return [...xa].every(([id, x]) => Math.abs(x - (xb.get(id) ?? Infinity)) < 0.05);
}

function finish(prev: ShelfLayout, next: ShelfLayout, books: BookMap): Result {
  const space = checkSpace(next, books);
  if (space) return { ok: false, reason: space };
  if (sameArrangement(prev, next, books)) return { ok: false, reason: 'no-change' };
  return { ok: true, layout: next };
}

// 드롭 적용. 임시 레이아웃 전체를 만들고 검증된 경우만 돌려준다.
export function moveBook(layout: ShelfLayout, books: BookMap, bookId: string, target: DropTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: layout.drawer.includes(bookId) ? 'in-drawer' : 'unknown-book' };
  if (!layout.shelves.some((s) => s.id === target.shelfId)) return { ok: false, reason: 'unknown-shelf' };
  const base = detach(layout, bookId, books);
  if (target.kind === 'insert') {
    return finish(layout, insertItem(base, { ...p, stackId: undefined }, target.shelfId, target.index, books, target.x), books);
  }
  if (p.pose !== 'horizontal') return { ok: false, reason: 'not-stackable' };
  const item = shelfItems(base, target.shelfId).find((it) => it.key === target.itemKey);
  if (!item || !isHorizontalItem(item, base)) return { ok: false, reason: 'not-stackable' };
  if (item.bookIds.length >= MAX_STACK) return { ok: false, reason: 'stack-full' };
  const stackId = stackIdFor(item.bookIds[0]);
  const placements = base.placements.map((q) =>
    item.bookIds.includes(q.bookId) ? { ...q, stackId, stackOrder: item.bookIds.indexOf(q.bookId) } : q,
  );
  placements.push({
    bookId,
    shelfId: target.shelfId,
    order: item.order,
    pose: 'horizontal',
    tilt: 0,
    stackId,
    stackOrder: item.bookIds.length,
  });
  return finish(layout, settle(normalize({ ...base, placements }), books, bookXs(base, books)), books);
}

function itemIndexOf(layout: ShelfLayout, bookId: string) {
  const p = placementOf(layout, bookId)!;
  const items = shelfItems(layout, p.shelfId);
  return { p, items, index: items.findIndex((it) => it.bookIds.includes(bookId)) };
}

export function setPose(layout: ShelfLayout, books: BookMap, bookId: string, pose: Pose): Result {
  const found = placementOf(layout, bookId);
  if (!found) return { ok: false, reason: 'unknown-book' };
  if (found.pose === pose) return { ok: false, reason: 'no-change' };
  const { p, index } = itemIndexOf(layout, bookId);
  if (p.stackId) {
    // 그룹에서 빠져 바로 오른쪽 자리로 나온다.
    const base = detach(layout, bookId, books);
    return finish(layout, insertItem(base, { bookId, pose, tilt: 0 }, p.shelfId, index + 1, books), books);
  }
  const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, pose, tilt: 0 as Tilt } : q));
  return finish(layout, settle(normalize({ ...layout, placements }), books, bookXs(layout, books)), books);
}

// 좌우 돌리기 한 단계. dir -1 = 왼쪽(반시계), +1 = 오른쪽(시계).
// 세운 책: 반대쪽 기울임 → 똑바로 → 이쪽 기울임 → 눕힘(자리가 없으면 똑바로). 누운 책·표지 책은 다시 세운다.
export function rotateStep(layout: ShelfLayout, books: BookMap, bookId: string, dir: -1 | 1): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.pose !== 'spine') return setPose(layout, books, bookId, 'spine');
  const side = Math.sign(p.tilt);
  if (side === -dir) return setTilt(layout, books, bookId, 0);
  if (side === 0) return setTilt(layout, books, bookId, (dir * 7) as Tilt);
  // 눕힐 자리가 없으면 눕힘 단계를 건너뛰고 다시 세운다(돌리기가 막히지 않게)
  const lie = setPose(layout, books, bookId, 'horizontal');
  return lie.ok ? lie : setTilt(layout, books, bookId, 0);
}

export function setTilt(layout: ShelfLayout, books: BookMap, bookId: string, tilt: Tilt): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.pose !== 'spine') return { ok: false, reason: 'tilt-only-spine' };
  // 먼저 지금 위치를 확정한다(예전 저장본의 자동 빈틈 규칙이 기울기 변경에 따라 달라지지 않게).
  const fixed = settle(layout, books, bookXs(layout, books));
  const placements = fixed.placements.map((q) => (q.bookId === bookId ? { ...q, tilt, lean: undefined } : q));
  const next = normalize({ ...fixed, placements });
  const desired = bookXs(fixed, books);
  if (tilt !== 0) {
    // 기대는 쪽에 MENU_LEAN만큼 쓰러질 틈을 벌린다(빈 공간이 있으면 쓰고, 없으면 옆 책을 민다).
    const items = shelfItems(next, p.shelfId);
    const i = items.findIndex((it) => it.bookIds.includes(bookId));
    const need = bookHeight(books[bookId]) * Math.sin(rad(MENU_LEAN));
    const nb = tilt < 0 ? items[i - 1] : items[i + 1];
    if (nb) {
      const pos = itemPositions(items, next, books);
      const packed = packedPositions(items, next, books);
      const [l, r] = tilt < 0 ? [i - 1, i] : [i, i + 1];
      const have = pos[r].x - pos[l].x - (packed[r].x - packed[l].x);
      if (have < need) {
        const moveId = tilt < 0 ? bookId : nb.bookIds[0];
        desired.set(moveId, desired.get(moveId)! + (need - have));
      }
    }
  }
  return finish(layout, settle(next, books, desired), books);
}

// 메뉴의 "이전/다음 자리". 쌓인 책은 그룹 바로 옆으로 나온다.
export function moveBy(layout: ShelfLayout, books: BookMap, bookId: string, delta: -1 | 1): Result {
  if (!placementOf(layout, bookId)) return { ok: false, reason: 'unknown-book' };
  const { p, items, index } = itemIndexOf(layout, bookId);
  if (p.stackId) {
    return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index: delta < 0 ? index : index + 1 });
  }
  const target = index + delta;
  if (target < 0 || target >= items.length) return { ok: false, reason: 'no-change' };
  return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index: target });
}

// 메뉴의 "다른 선반". 해당 선반의 끝에 놓는다.
export function moveToShelf(layout: ShelfLayout, books: BookMap, bookId: string, shelfId: string): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.shelfId === shelfId) return { ok: false, reason: 'no-change' };
  const count = shelfItems(detach(layout, bookId), shelfId).length;
  return moveBook(layout, books, bookId, { kind: 'insert', shelfId, index: count });
}

export function addShelf(layout: ShelfLayout, id: string): ShelfLayout {
  return normalize({ ...layout, shelves: [...layout.shelves, { id, order: layout.shelves.length }] });
}

export function removeShelf(layout: ShelfLayout, shelfId: string): Result {
  if (layout.placements.some((p) => p.shelfId === shelfId)) return { ok: false, reason: 'shelf-not-empty' };
  return { ok: true, layout: normalize({ ...layout, shelves: layout.shelves.filter((s) => s.id !== shelfId) }) };
}

// 드래그 중 삽입 자리 판정. centerX는 선반 판 안쪽 기준 설계 단위.
// 눕힌 책을 눕힌 책/그룹의 가운데 절반 위에 가져가면 쌓기, 그 밖은 나란히 놓기.
export function findDropTarget(
  detached: ShelfLayout,
  books: BookMap,
  shelfId: string,
  centerX: number,
  draggedPose: Pose,
  draggedWidth = 0,
): DropTarget {
  const positions = itemPositions(shelfItems(detached, shelfId), detached, books);
  if (draggedPose === 'horizontal') {
    for (const pos of positions) {
      const inMiddle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
      if (inMiddle && isHorizontalItem(pos.item, detached)) {
        return { kind: 'stack', shelfId, itemKey: pos.item.key };
      }
    }
  }
  const index = positions.filter((pos) => pos.x + pos.width / 2 < centerX).length;
  const over = positions.some((pos) => centerX >= pos.x && centerX <= pos.x + pos.width);
  // 빈 공간 위: 그 자리에 놓는다(2DU 단위로 맞춰 미리보기가 떨리지 않게)
  if (!over) return { kind: 'insert', shelfId, index, x: Math.round((centerX - draggedWidth / 2) / 2) * 2 };
  return { kind: 'insert', shelfId, index };
}

export function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.shelfId !== b.shelfId) return false;
  return a.kind === 'insert' ? a.index === (b as typeof a).index && a.x === (b as typeof a).x : a.itemKey === (b as typeof a).itemKey;
}

// ---------- 책 서랍 ----------

export function moveToDrawer(layout: ShelfLayout, bookId: string, books?: BookMap): Result {
  if (!placementOf(layout, bookId)) return { ok: false, reason: layout.drawer.includes(bookId) ? 'no-change' : 'unknown-book' };
  const base = detach(layout, bookId, books);
  return { ok: true, layout: normalize({ ...base, drawer: [bookId, ...base.drawer] }) };
}

// 서랍 또는 새 책을 선반 끝 빈 자리에 세워 꽂는다. 위 선반부터 찾고, 자리가 없으면 no-space.
function placeAtFirstFit(layout: ShelfLayout, books: BookMap, bookId: string): Result {
  for (const shelf of sortedShelves(layout)) {
    const count = shelfItems(layout, shelf.id).length;
    const next = insertItem(layout, { bookId, pose: 'spine', tilt: 0 }, shelf.id, count, books);
    if (!checkSpace(next, books)) return { ok: true, layout: next };
  }
  return { ok: false, reason: 'no-space' };
}

export function placeFromDrawer(layout: ShelfLayout, books: BookMap, bookId: string): Result {
  if (!layout.drawer.includes(bookId)) return { ok: false, reason: 'unknown-book' };
  const base = { ...layout, drawer: layout.drawer.filter((id) => id !== bookId) };
  return placeAtFirstFit(base, books, bookId);
}

// 새 책 추가: 선반 빈 자리에 꽂고, 꽉 차 있으면 서랍에 넣는다.
export function addBook(layout: ShelfLayout, books: BookMap, bookId: string): { layout: ShelfLayout; where: 'shelf' | 'drawer' } {
  if (placementOf(layout, bookId) || layout.drawer.includes(bookId)) return { layout, where: placementOf(layout, bookId) ? 'shelf' : 'drawer' };
  const r = placeAtFirstFit(layout, books, bookId);
  if (r.ok) return { layout: r.layout, where: 'shelf' };
  return { layout: normalize({ ...layout, drawer: [...layout.drawer, bookId] }), where: 'drawer' };
}

// 저장용: 각 자리의 정규화 위치(선반 사용 폭 대비, 0~1)를 기록한다. 화면 폭과 무관.
export function withNormalizedX(layout: ShelfLayout, books: BookMap): ShelfLayout {
  const xs = new Map<string, number>();
  for (const shelf of layout.shelves) {
    for (const pos of itemPositions(shelfItems(layout, shelf.id), layout, books)) {
      const x = Math.round(((pos.x - SHELF.innerLeft) / SHELF_USABLE_WIDTH) * 10000) / 10000;
      pos.item.bookIds.forEach((id) => xs.set(id, x));
    }
  }
  return { ...layout, placements: layout.placements.map((p) => ({ ...p, x: xs.get(p.bookId) })) };
}

// ---------- 자리 바꾸기(꾹 눌러 좌우로 옮길 때) ----------

// 같은 선반의 다른 자리와 서로 위치를 바꾼다. 쌓인 책이면 그룹에서 빠져 그 자리로 가고, 원래 자리 책은 뒤로 밀린다.
export function swapWith(layout: ShelfLayout, books: BookMap, bookId: string, targetKey: string): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  const items = shelfItems(layout, p.shelfId);
  const j = items.findIndex((it) => it.key === targetKey);
  if (j < 0) return { ok: false, reason: 'unknown-book' };
  if (p.stackId) {
    return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index: j });
  }
  const i = items.findIndex((it) => it.bookIds.includes(bookId));
  if (i === j) return { ok: false, reason: 'no-change' };
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  // 두 책이 서로의 자리로 간다(폭이 달라 겹치면 민다).
  const desired = bookXs(layout, books);
  const xi = desired.get(items[i].bookIds[0])!;
  const xj = desired.get(items[j].bookIds[0])!;
  items[i].bookIds.forEach((id) => desired.set(id, xj));
  items[j].bookIds.forEach((id) => desired.set(id, xi));
  return finish(layout, settle(normalize({ ...layout, placements: withOrders(layout, p.shelfId, next) }), books, desired), books);
}

// 끌고 있는 책 가운데(centerX, 설계 단위)가 어느 자리 위에 있는지. 확정 배치 기준으로 판정해 미리보기가 출렁이지 않게 한다.
// 눕힌 책을 눕힌 책/그룹의 가운데 절반 위에 놓으면 쌓기.
export type SwapTarget =
  | { kind: 'swap'; itemKey: string }
  | { kind: 'stack'; itemKey: string }
  | { kind: 'place'; x: number } // 빈 공간에 놓기(x: 책 왼쪽 끝)
  | { kind: 'self' };

export function findSwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, centerX: number): SwapTarget {
  const p = placementOf(layout, bookId)!;
  const positions = itemPositions(shelfItems(layout, p.shelfId), layout, books);
  for (const pos of positions) {
    if (centerX < pos.x || centerX > pos.x + pos.width) continue;
    if (pos.item.bookIds.includes(bookId)) return { kind: 'self' };
    const middle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (p.pose === 'horizontal' && middle && isHorizontalItem(pos.item, layout)) return { kind: 'stack', itemKey: pos.item.key };
    break; // 다른 책 위: 그 자리에 끼워 넣고 옆 책들을 민다(자리 바꾸기 대신)
  }
  const mine = positions.find((pos) => pos.item.bookIds.includes(bookId));
  const w = mine?.width ?? 0;
  return { kind: 'place', x: Math.round((centerX - w / 2) / 2) * 2 };
}

export function applySwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, t: SwapTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (t.kind === 'self') return { ok: false, reason: 'no-change' };
  if (t.kind === 'stack') return moveBook(layout, books, bookId, { kind: 'stack', shelfId: p.shelfId, itemKey: t.itemKey });
  if (t.kind === 'place') {
    // 끼울 순서: 지금 화면의 위치(빼기 전)에서 끄는 책의 가운데보다 가운데가 왼쪽인 책 수
    const all = itemPositions(shelfItems(layout, p.shelfId), layout, books);
    const mine = all.find((pos) => pos.item.bookIds.includes(bookId));
    const center = t.x + (mine?.width ?? 0) / 2;
    const index = all.filter((pos) => pos !== mine && pos.x + pos.width / 2 < center).length;
    return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index, x: t.x });
  }
  return swapWith(layout, books, bookId, t.itemKey);
}
