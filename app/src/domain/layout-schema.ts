// 저장 형식·순서·그룹의 무결성만 담당한다. 위치/충돌 검증은 layout-engine.validate에서 더한다.
import { HOME_SHELF_COUNT, MAX_STACK } from './layout-rules';
import type { Book, BookPlacement, ShelfLayout, ShelfLayoutV1 } from './types';

export type BookMap = Record<string, Book>;

export type ShelfItem = {
  key: string; // 단권은 bookId, 그룹은 stackId
  shelfId: string;
  order: number;
  bookIds: string[]; // 아래에서 위 순서
  stacked: boolean;
};

export const stackIdFor = (bottomBookId: string) => `stack:${bottomBookId}`;

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

// 선반은 최소 min개(기본 3). 사용자가 더한 선반은 그대로 두고, 모자라면 빈 선반을 채운다(책이 있는 선반을 지우지 않는다).
export function ensureShelves(layout: ShelfLayout, min = HOME_SHELF_COUNT): ShelfLayout {
  const shelves = sortedShelves(layout);
  for (let n = 1; shelves.length < min; n++) {
    const id = `shelf-${n}`;
    if (!shelves.some((s) => s.id === id)) shelves.push({ id, order: shelves.length });
  }
  const kept = new Set(shelves.map((s) => s.id));
  const lost = layout.placements.filter((p) => !kept.has(p.shelfId)).map((p) => p.bookId);
  return normalize({ ...layout, shelves, placements: layout.placements.filter((p) => kept.has(p.shelfId)), drawer: [...layout.drawer, ...lost] });
}

// 빈 선반 정리: 책이 없는 선반만, 최소 min개는 남긴다(아래쪽 빈 선반부터)
export function pruneEmptyShelves(layout: ShelfLayout, min = HOME_SHELF_COUNT): ShelfLayout {
  let shelves = sortedShelves(layout);
  for (const s of [...shelves].reverse()) {
    if (shelves.length <= min) break;
    if (!layout.placements.some((p) => p.shelfId === s.id)) shelves = shelves.filter((x) => x.id !== s.id);
  }
  return normalize({ ...layout, shelves });
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

// 자리를 옮기거나 다시 매겨도 지키는 자세 값(그 자세에서만 뜻이 있는 것만). normalize·insertItem이 함께 쓴다:
// 한 곳에서 빠뜨리면 옮길 때 자세가 바뀐다(예: 눕힌 책의 머리 방향 flip이 빠지면 들어 올린 채 180° 구른다)
export function keptPose(p: Pick<BookPlacement, 'pose' | 'depth' | 'spin' | 'pitch' | 'wallLean' | 'flip'>, stacked: boolean): Partial<BookPlacement> {
  const out: Partial<BookPlacement> = {};
  if (p.depth !== undefined) out.depth = p.depth;
  if (p.spin && (p.pose === 'horizontal' || p.pose === 'front')) out.spin = p.spin;
  if (p.pose === 'horizontal' && p.flip) out.flip = true;
  if (p.pose === 'front' && !stacked) {
    if (p.pitch) out.pitch = p.pitch;
    else if (p.wallLean && p.pitch === undefined) out.wallLean = true; // 예전 저장본
  }
  return out;
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
        if (p.overhang && p.pose === 'horizontal' && !stackId) next.overhang = true;
        Object.assign(next, keptPose(p, !!stackId));
        if (stackId && stackOrder > 0) {
          if (p.stackDx) next.stackDx = p.stackDx;
          if (p.stackDz) next.stackDz = p.stackDz;
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

// 책과 선반의 참조·중복·순서·쌓기 구조를 검증한다(물리 공간은 제외).
export function validateStructure(layout: ShelfLayout, books: BookMap, expectedIds?: string[]): string[] {
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
  return errors;
}
