// 순수 배치 계산. UI와 저장소는 여기서 검증된 레이아웃만 확정한다.
import {
  MAX_STACK,
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
  | { kind: 'insert'; shelfId: string; index: number } // index는 끌고 있는 책을 뺀 뒤의 자리
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

function packedPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  const packed: { item: ShelfItem; x: number; width: number; poly: XY[] }[] = [];
  for (const item of items) {
    const width = itemWidth(item, layout, books), height = itemHeight(item, layout, books);
    const poly = item.stacked
      ? [{ x: 0, y: -height }, { x: width, y: -height }, { x: width, y: 0 }, { x: 0, y: 0 }]
      : visibleBookOutline(books[item.bookIds[0]], placementOf(layout, item.bookIds[0])!);
    let x = 0;
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

// Pack actual silhouettes, then centre the whole group on the plank.
export function itemPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  const packed = packedPositions(items, layout, books);
  const used = Math.max(0, ...packed.map((p) => p.x + p.width));
  const inset = SHELF.innerLeft + Math.max(0, (SHELF_USABLE_WIDTH - used) / 2);
  return packed.map(({ item, x, width }) => ({ item, x: x + inset, width }));
}

export function usedWidth(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  return Math.max(0, ...packedPositions(items, layout, books).map((p) => p.x + p.width));
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

// 책을 자리에서 빼낸다. 그룹에서 빼면 나머지는 빈틈 없이 내려앉는다.
export function detach(layout: ShelfLayout, bookId: string): ShelfLayout {
  return normalize({ ...layout, placements: layout.placements.filter((p) => p.bookId !== bookId) });
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
): ShelfLayout {
  const items = shelfItems(layout, shelfId);
  const at = Math.max(0, Math.min(index, items.length));
  const newItem: ShelfItem = { key: placement.bookId, shelfId, order: at, bookIds: [placement.bookId], stacked: false };
  items.splice(at, 0, newItem);
  const placements = withOrders(layout, shelfId, items);
  placements.push({ bookId: placement.bookId, pose: placement.pose, tilt: placement.tilt, shelfId, order: at });
  return normalize({ ...layout, placements });
}

// 여러 선반의 공간·무결성을 한 번에 확인한다.
export function checkSpace(layout: ShelfLayout, books: BookMap): FailReason | null {
  for (const shelf of layout.shelves) {
    if (usedWidth(shelfItems(layout, shelf.id), layout, books) > SHELF_USABLE_WIDTH + 0.01) return 'no-space';
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

function finish(prev: ShelfLayout, next: ShelfLayout, books: BookMap): Result {
  const space = checkSpace(next, books);
  if (space) return { ok: false, reason: space };
  if (JSON.stringify(normalize(prev)) === JSON.stringify(next)) return { ok: false, reason: 'no-change' };
  return { ok: true, layout: next };
}

// 드롭 적용. 임시 레이아웃 전체를 만들고 검증된 경우만 돌려준다.
export function moveBook(layout: ShelfLayout, books: BookMap, bookId: string, target: DropTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: layout.drawer.includes(bookId) ? 'in-drawer' : 'unknown-book' };
  if (!layout.shelves.some((s) => s.id === target.shelfId)) return { ok: false, reason: 'unknown-shelf' };
  const base = detach(layout, bookId);
  if (target.kind === 'insert') {
    return finish(layout, insertItem(base, { ...p, stackId: undefined }, target.shelfId, target.index), books);
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
  return finish(layout, normalize({ ...base, placements }), books);
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
    const base = detach(layout, bookId);
    return finish(layout, insertItem(base, { bookId, pose, tilt: 0 }, p.shelfId, index + 1), books);
  }
  const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, pose, tilt: 0 as Tilt } : q));
  return finish(layout, normalize({ ...layout, placements }), books);
}

export function setTilt(layout: ShelfLayout, books: BookMap, bookId: string, tilt: Tilt): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.pose !== 'spine') return { ok: false, reason: 'tilt-only-spine' };
  const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, tilt } : q));
  return finish(layout, normalize({ ...layout, placements }), books);
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
  return { kind: 'insert', shelfId, index };
}

export function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind || a.shelfId !== b.shelfId) return false;
  return a.kind === 'insert' ? a.index === (b as typeof a).index : a.itemKey === (b as typeof a).itemKey;
}

// ---------- 책 서랍 ----------

export function moveToDrawer(layout: ShelfLayout, bookId: string): Result {
  if (!placementOf(layout, bookId)) return { ok: false, reason: layout.drawer.includes(bookId) ? 'no-change' : 'unknown-book' };
  const base = detach(layout, bookId);
  return { ok: true, layout: normalize({ ...base, drawer: [bookId, ...base.drawer] }) };
}

// 서랍 또는 새 책을 선반 끝 빈 자리에 세워 꽂는다. 위 선반부터 찾고, 자리가 없으면 no-space.
function placeAtFirstFit(layout: ShelfLayout, books: BookMap, bookId: string): Result {
  for (const shelf of sortedShelves(layout)) {
    const count = shelfItems(layout, shelf.id).length;
    const next = insertItem(layout, { bookId, pose: 'spine', tilt: 0 }, shelf.id, count);
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
  return finish(layout, normalize({ ...layout, placements: withOrders(layout, p.shelfId, next) }), books);
}

// 끌고 있는 책 가운데(centerX, 설계 단위)가 어느 자리 위에 있는지. 확정 배치 기준으로 판정해 미리보기가 출렁이지 않게 한다.
// 눕힌 책을 눕힌 책/그룹의 가운데 절반 위에 놓으면 쌓기.
export type SwapTarget = { kind: 'swap'; itemKey: string } | { kind: 'stack'; itemKey: string } | { kind: 'end' } | { kind: 'self' };

export function findSwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, centerX: number): SwapTarget {
  const p = placementOf(layout, bookId)!;
  const positions = itemPositions(shelfItems(layout, p.shelfId), layout, books);
  for (const pos of positions) {
    if (centerX < pos.x || centerX > pos.x + pos.width) continue;
    if (pos.item.bookIds.includes(bookId)) return { kind: 'self' };
    const middle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (p.pose === 'horizontal' && middle && isHorizontalItem(pos.item, layout)) return { kind: 'stack', itemKey: pos.item.key };
    return { kind: 'swap', itemKey: pos.item.key };
  }
  const last = positions.at(-1);
  if (last && centerX > last.x + last.width) return { kind: 'end' };
  return { kind: 'self' };
}

export function applySwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, t: SwapTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (t.kind === 'self') return { ok: false, reason: 'no-change' };
  if (t.kind === 'stack') return moveBook(layout, books, bookId, { kind: 'stack', shelfId: p.shelfId, itemKey: t.itemKey });
  if (t.kind === 'end') {
    const count = shelfItems(detach(layout, bookId), p.shelfId).length;
    return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index: count });
  }
  return swapWith(layout, books, bookId, t.itemKey);
}
