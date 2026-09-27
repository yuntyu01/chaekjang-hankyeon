// 순수 배치 계산. UI와 저장소는 여기서 검증된 레이아웃만 확정한다.
import {
  MAX_STACK,
  SHELF,
  SHELF_USABLE_WIDTH,
  singleFootprint,
  stackFootprint,
} from './geometry';
import type { Book, BookPlacement, Pose, ShelfLayout, Tilt } from './types';

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

// 선반 안 자리들의 x(설계 단위, 선반 판 안쪽 기준). 빈 공간은 오른쪽에 남긴다.
export function itemPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  let x = SHELF.innerPadding;
  return items.map((it) => {
    const width = itemWidth(it, layout, books);
    const pos = { item: it, x, width };
    x += width + SHELF.gap;
    return pos;
  });
}

export function usedWidth(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  if (items.length === 0) return 0;
  return items.reduce((s, it) => s + itemWidth(it, layout, books), 0) + SHELF.gap * (items.length - 1);
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
  return { version: 1, shelves, placements };
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
  if (!p) return { ok: false, reason: 'unknown-book' };
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
