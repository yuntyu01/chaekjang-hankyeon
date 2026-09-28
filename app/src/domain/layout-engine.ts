// 순수 배치 계산. UI와 저장소는 여기서 검증된 레이아웃만 확정한다.
import {
  bookHeight,
  placementDepth,
  spunExtent,
  SHELF_DEPTH,
  SHELF_FRONT,
  MAX_SPIN,
  CAMERA,
  frontWidth,
  LYING_BACK_Z,
  defaultDepth,
  wallPitch,
  frontDims,
  frontExt,
  WALL_LEAN_ENTER,
  WALL_LEAN_MAX,
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
import { corners, fromPlaced, lowest } from './book3';
import { boxSize, type Placed } from './box';
import { pitchForWall, spinStep, tiltStep, unsupported, type FrontState } from './front-pose';
import { stackBoxes, stackSupported } from './support';
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
  | 'unsupported'
  | 'spin-only-lying'
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

const spinsOf = (item: ShelfItem, layout: ShelfLayout) => item.bookIds.map((id) => placementOf(layout, id)?.spin ?? 0);

// 쌓기 더미 구성원(아래 → 위): 받침 깊이는 맨 아래 책 것, 위 책은 사용자가 옮긴 어긋남(stackDx/Dz)을 함께
export function stackMembers(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  const base = placementOf(layout, item.bookIds[0]);
  return item.bookIds.map((id) => {
    const p = placementOf(layout, id);
    return { bookId: id, book: books[id], spin: p?.spin, depth: base?.depth, dx: p?.stackDx, dz: p?.stackDz };
  });
}

export function itemWidth(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  if (item.stacked) {
    // 실제 상자의 오른쪽 끝(더미 왼쪽 끝 = 0)
    let hi = 0;
    for (const box of stackBoxes(stackMembers(item, layout, books), 0)) for (const c of corners(fromPlaced(box))) hi = Math.max(hi, c.x);
    return hi;
  }
  const p = placementOf(layout, item.bookIds[0])!;
  return singleFootprint(books[p.bookId], p).width;
}

export function itemHeight(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  if (item.stacked) return stackFootprint(item.bookIds.map((id) => books[id]), spinsOf(item, layout)).height;
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

// 한 항목(책 또는 쌓기 더미)의 실제 상자들: 화면에 그리는 것과 같은 상자(쌓인 책은 아래 책 위 가운데).
// x는 항목 왼쪽 끝. 세운 책은 기대기 전(똑바로 선) 상자.
export function itemBoxes(item: ShelfItem, layout: ShelfLayout, books: BookMap, x = 0): Placed[] {
  if (item.stacked) return stackBoxes(stackMembers(item, layout, books), x);
  const p = placementOf(layout, item.bookIds[0])!;
  const b = books[p.bookId];
  const spin = p.pose === 'horizontal' || p.pose === 'front' ? p.spin : undefined;
  const z = p.depth ?? defaultDepth(b, p.pose);
  const pitch = p.pose === 'front' ? frontPitchOf(b, p, z) || undefined : undefined;
  return [{ bookId: p.bookId, pose: p.pose, size: boxSize(b, p.pose), x, y: 0, z, angle: 0, spin, pitch }];
}

// 한 항목이 차지하는 깊이 구간(선반 공간 z): 실제 상자 꼭짓점에서
export function itemDepth(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const box of itemBoxes(item, layout, books)) {
    for (const c of corners(fromPlaced(box))) {
      z0 = Math.min(z0, c.z);
      z1 = Math.max(z1, c.z);
    }
  }
  return { z0, z1 };
}

// 각 책 바닥 면 네 모서리(선반 공간). 경계 판정용.
export function itemBottomCorners(item: ShelfItem, layout: ShelfLayout, books: BookMap, x: number) {
  const out: { x: number; z: number }[] = [];
  for (const box of itemBoxes(item, layout, books, x)) {
    const b = fromPlaced(box);
    const lo = lowest(b);
    for (const c of corners(b)) if (c.y < lo + 0.01) out.push({ x: c.x, z: c.z });
  }
  return out;
}

function packedPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap) {
  // sep[j]: 이 항목이 앞 항목 j보다 최소 얼마나 오른쪽에 있어야 하는지(깊이가 겹치지 않으면 -Infinity)
  const packed: { item: ShelfItem; x: number; width: number; poly: XY[]; z: { z0: number; z1: number }; sep: number[] }[] = [];
  for (const item of items) {
    const z = itemDepth(item, layout, books);
    const width = itemWidth(item, layout, books), height = itemHeight(item, layout, books);
    const poly = item.stacked
      ? [{ x: 0, y: -height }, { x: width, y: -height }, { x: width, y: 0 }, { x: 0, y: 0 }]
      : visibleBookOutline(books[item.bookIds[0]], { ...placementOf(layout, item.bookIds[0])!, tilt: 0 });
    const sep: number[] = packed.map(() => -Infinity);
    const last = packed.length - 1;
    packed.forEach((prev, j) => {
      // 깊이가 겹치지 않는 책끼리는 정면에서 겹쳐 보여도 밀지 않는다
      if (prev.z.z1 <= z.z0 + 0.05 || z.z1 <= prev.z.z0 + 0.05) return;
      for (const y of [...prev.poly, ...poly].map((q) => q.y)) {
        const a = intervalAt(prev.poly, y), b = intervalAt(poly, y);
        if (a && b) sep[j] = Math.max(sep[j], a.right - b.left + SHELF.gap);
      }
    });
    // 눕힌 책(더미) 바로 뒤에는 오른쪽 끝면이 보일 만큼 띄운다(뒤에 놓여 옆 책 앞면에 가려지지 않게, 시안처럼)
    // (깊이가 겹치는 경우만: 앞뒤로 떨어져 있으면 끝면을 가릴 일이 없다)
    if (last >= 0 && sep[last] > -Infinity && isHorizontalItem(packed[last].item, layout)) sep[last] = Math.max(sep[last], packed[last].width + lyingEndGap(packed[last].item, books));
    let x = 0;
    packed.forEach((prev, j) => {
      if (sep[j] > -Infinity) x = Math.max(x, prev.x + sep[j]);
    });
    packed.push({ item, x, width, poly, z, sep });
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
function resolveXs(items: ShelfItem[], layout: ShelfLayout, packed: { x: number; width: number; sep: number[] }[], want: (i: number) => number | undefined) {
  const { lo, hi } = bounds(items, layout);
  const xs: number[] = [];
  items.forEach((_, i) => {
    const w = want(i);
    let min = lo;
    for (let j = 0; j < i; j++) if (packed[i].sep[j] > -Infinity) min = Math.max(min, xs[j] + packed[i].sep[j]);
    xs.push(w === undefined ? (i === 0 ? lo : Math.max(min, xs[i - 1] + (packed[i].sep[i - 1] > -Infinity ? packed[i].sep[i - 1] : 0))) : Math.max(w, min));
  });
  // 오른쪽 끝을 넘는 책이 있으면 왼쪽으로 되민다(깊이가 겹치는 앞 책도 함께)
  const n = items.length;
  for (let i = n - 1; i >= 0; i--) {
    let max = hi - packed[i].width;
    for (let k = i + 1; k < n; k++) if (packed[k].sep[i] > -Infinity) max = Math.min(max, xs[k] - packed[k].sep[i]);
    xs[i] = Math.min(xs[i], max);
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

// 선반 좌우 경계(책 줄의 사용 폭). 모든 자세 공통: 돌출 허용 없음.
function bounds(_items: ShelfItem[], _layout: ShelfLayout) {
  return { lo: SHELF.innerLeft, hi: SHELF.innerLeft + SHELF_USABLE_WIDTH };
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
// only: 그 선반만 다시 맞춘다(다른 선반은 그대로라 끄는 동안 미리보기가 가볍다)
export function settle(layout: ShelfLayout, books: BookMap, desired: Map<string, number>, only?: string): ShelfLayout {
  const posByBook = new Map<string, number>();
  for (const shelf of layout.shelves) {
    if (only && shelf.id !== only) continue;
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
        // 선반 공간 깊이·수직축 회전(눕힌 책만)은 그대로 보존
        if (p.depth !== undefined) next.depth = p.depth;
        if (p.spin && (p.pose === 'horizontal' || p.pose === 'front')) next.spin = p.spin;
        if (p.pose === 'front' && !stackId) {
          if (p.pitch) next.pitch = p.pitch;
          else if (p.wallLean && p.pitch === undefined) next.wallLean = true; // 예전 저장본
        }
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
  // 깊이·수직축 회전은 옮겨도 그대로(자리만 바뀐다)
  const kept: BookPlacement = { bookId: placement.bookId, pose: placement.pose, tilt: placement.tilt, shelfId, order: at };
  if (placement.depth !== undefined) kept.depth = placement.depth;
  if (placement.spin && (placement.pose === 'horizontal' || placement.pose === 'front')) kept.spin = placement.spin;
  if (placement.pose === 'front' && placement.pitch) kept.pitch = placement.pitch;
  placements.push(kept);
  const next = normalize({ ...layout, placements });
  if (!books) return next;
  // 다른 책은 제자리, 새 책은 x(없으면 앞 책 바로 뒤)에 두고 겹치면 민다.
  const desired = bookXs(layout, books);
  if (x !== undefined) desired.set(placement.bookId, x);
  else desired.delete(placement.bookId);
  return settle(next, books, desired);
}

// 여러 선반의 공간·무결성을 한 번에 확인한다: 좌우 끝, 앞뒤 깊이(선반 앞 끝~뒷벽), 쌓기 받침.
// 선반 밖으로 튀어나오는 배치는 허용하지 않는다: 모든 책(돌린 책·쌓인 책 포함)의 실제 바닥 네 모서리가
// 좌우 경계(0 ~ 사용 폭)와 깊이(앞 끝 -SHELF_FRONT ~ 벽 SHELF_DEPTH) 안에 있어야 한다.
export function checkSpace(layout: ShelfLayout, books: BookMap, only?: string): FailReason | null {
  for (const shelf of layout.shelves) {
    if (only && shelf.id !== only) continue;
    const items = shelfItems(layout, shelf.id);
    if (!items.length) continue;
    const pos = itemPositions(items, layout, books);
    const { lo, hi } = bounds(items, layout);
    for (const p of pos) {
      // 받침부터: 큰 책을 작은 책 위에 올린 경우는 자리 부족이 아니라 받침 문제로 알린다
      if (p.item.stacked) {
        if (!stackSupported(stackBoxes(stackMembers(p.item, layout, books), p.x))) return 'unsupported';
      }
      if (p.x < lo - 0.01 || p.x + p.width > hi + 0.01) return 'no-space';
      // 선반 윗면 전체(앞 끝 ~ 벽) 안: 책 기준선(z=0)은 세운 책이 서는 기본 자리일 뿐 경계가 아니다
      for (const c of itemBottomCorners(p.item, layout, books, p.x)) {
        if (c.x < lo - 0.01 || c.x > hi + 0.01) return 'no-space';
        if (c.z < -SHELF_FRONT - 0.01 || c.z > SHELF_DEPTH + 0.01) return 'no-space';
      }
    }
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
  if (target.kind === 'insert' && isStackBase(layout, bookId)) return moveStack(layout, books, bookId, target.shelfId, target.index, target.x);
  const base = detach(layout, bookId, books);
  if (target.kind === 'insert') {
    // 더미에서 빠져나오는 위 책: 지금 놓인 깊이 그대로 바닥에 내린다
    const depth = p.stackId ? boxOf(layout, books, bookId)?.z ?? p.depth : p.depth;
    return finish(layout, insertItem(base, { ...p, stackId: undefined, depth }, target.shelfId, target.index, books, target.x), books);
  }
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
  const book = books[bookId];
  // 새 자세의 깊이: 사용자가 둔 깊이(더미에서 나오면 지금 놓인 깊이)는 자세를 바꿔도 지키고 선반 안으로만 맞춘다.
  // 처음 표지 전시하는 책(깊이 기록 없음)은 뒤쪽(벽 앞)에 세워 본다.
  const kept = p.stackId ? boxOf(layout, books, bookId)?.z : p.depth;
  const d = placementDepth(book, { pose, depth: 0 }).z1;
  const fit = (z: number) => round2(Math.max(-SHELF_FRONT, Math.min(SHELF_DEPTH - d, z)));
  const tries: (number | undefined)[] = kept !== undefined ? [fit(kept)] : pose === 'front' ? [fit(SHELF_DEPTH - d - 1), undefined] : [undefined];
  let last: Result = { ok: false, reason: 'no-space' };
  for (const depth of tries) {
    if (p.stackId) {
      // 그룹에서 빠져 바로 오른쪽 자리로 나온다.
      const base = detach(layout, bookId, books);
      last = finish(layout, insertItem(base, { bookId, pose, tilt: 0, depth }, p.shelfId, index + 1, books), books);
    } else {
      const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, pose, tilt: 0 as Tilt, depth, spin: undefined, pitch: undefined, wallLean: undefined } : q));
      last = finish(layout, settle(normalize({ ...layout, placements }), books, bookXs(layout, books)), books);
    }
    if (last.ok) return last;
  }
  return last;
}


// ---------- 쌓기 더미 통째로 옮기기·위 책 어긋남 ----------

export function isStackBase(layout: ShelfLayout, bookId: string) {
  const p = placementOf(layout, bookId);
  return !!p?.stackId && (p.stackOrder ?? 0) === 0 && layout.placements.some((q) => q.stackId === p.stackId && q.bookId !== bookId);
}

// 이 책의 지금 상자(선반 공간, 기대기 전)
export function boxOf(layout: ShelfLayout, books: BookMap, bookId: string): Placed | undefined {
  const p = placementOf(layout, bookId);
  if (!p) return undefined;
  const items = shelfItems(layout, p.shelfId);
  const pos = itemPositions(items, layout, books).find((q) => q.item.bookIds.includes(bookId));
  if (!pos) return undefined;
  return itemBoxes(pos.item, layout, books, pos.x).find((b) => b.bookId === bookId);
}

// 받치는 책을 옮기면 위 책들도 함께(순서·어긋남·회전 그대로). 다른 선반으로도.
function moveStack(layout: ShelfLayout, books: BookMap, baseId: string, shelfId: string, index: number, x?: number): Result {
  const p = placementOf(layout, baseId)!;
  const members = layout.placements.filter((q) => q.stackId === p.stackId).sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0));
  const ids = new Set(members.map((q) => q.bookId));
  const removed = settle(normalize({ ...layout, placements: layout.placements.filter((q) => !ids.has(q.bookId)) }), books, bookXs(layout, books));
  const withBase = insertItem(removed, { ...p, stackId: undefined }, shelfId, index);
  const baseP = placementOf(withBase, baseId)!;
  const stackId = stackIdFor(baseId);
  const placements = withBase.placements.map((q) => (q.bookId === baseId ? { ...q, stackId, stackOrder: 0 } : q));
  members.slice(1).forEach((m, i) => placements.push({ ...m, shelfId, order: baseP.order, stackId, stackOrder: i + 1 }));
  const desired = bookXs(removed, books);
  if (x !== undefined) for (const m of members) desired.set(m.bookId, x);
  return finish(layout, settle(normalize({ ...removed, placements }), books, desired), books);
}

// 둘 중 가능한 쪽으로 좁혀 가는 이분 탐색: f(1)이 되면 그대로, 안 되면 f(0)(지금)에서 가장 멀리 되는 곳
function farthest(tryAt: (k: number) => ShelfLayout | null): { layout: ShelfLayout; k: number } | null {
  const full = tryAt(1);
  if (full) return { layout: full, k: 1 };
  let ok = 0;
  let bad = 1;
  let best: ShelfLayout | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (ok + bad) / 2;
    const r = tryAt(mid);
    if (r) {
      ok = mid;
      best = r;
    } else bad = mid;
  }
  return best ? { layout: best, k: ok } : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// 쌓인 위 책을 아래 책 위에서 옆으로(dx) 옮긴다. 받침(바닥이 아래 책 윗면 안)을 벗어나면 가능한 데까지만.
export function shiftOnStack(layout: ShelfLayout, books: BookMap, bookId: string, dx: number): Result {
  const p = placementOf(layout, bookId);
  if (!p?.stackId || !(p.stackOrder ?? 0)) return { ok: false, reason: 'no-change' };
  const from = p.stackDx ?? 0;
  const r = farthest((k) => {
    const v = round2(from + dx * k);
    const next = { ...layout, placements: layout.placements.map((q) => (q.bookId === bookId ? { ...q, stackDx: v || undefined } : q)) };
    return checkSpace(next, books, p.shelfId) || !sameXs(layout, next, books, p.shelfId) ? null : next;
  });
  if (!r || r.k === 0) return { ok: false, reason: 'no-change' };
  return finish(layout, r.layout, books);
}

// 이 선반 책들의 가로 자리가 그대로인지(앞뒤로 옮기다 옆 책을 밀었는지)
function sameXs(a: ShelfLayout, b: ShelfLayout, books: BookMap, shelfId: string) {
  const xa = bookXs(a, books);
  const xb = bookXs(b, books);
  return b.placements.filter((q) => q.shelfId === shelfId).every((q) => Math.abs((xa.get(q.bookId) ?? 0) - (xb.get(q.bookId) ?? 0)) < 0.05);
}

// 앞뒤(깊이) 옮기기: z = 책 상자의 앞면 깊이(선반 공간, 앞 끝 -SHELF_FRONT ~ 벽 SHELF_DEPTH).
// 다른 책은 밀지 않는다: 옆 책·벽·받침에 닿으면 가능한 데까지만 간다. 받치는 책이면 위 책들도 함께, 위 책이면 아래 책 위에서만.
// prevLean: 끄는 도중이면 직전 미리보기의 벽 기대기 상태(들어가고 풀리는 경계를 다르게 두는 데 쓴다). 없으면 저장된 상태.
export function setDepth(layout: ShelfLayout, books: BookMap, bookId: string, z: number, prevLean?: boolean): Result {
  const p = placementOf(layout, bookId);
  const box = boxOf(layout, books, bookId);
  if (!p || !box) return { ok: false, reason: 'unknown-book' };
  if (p.pose === 'front' && !p.stackId) return setFrontDepth(layout, books, bookId, z, prevLean);
  const upper = !!p.stackId && (p.stackOrder ?? 0) > 0;
  const base = p.stackId ? placementOf(layout, layout.placements.find((q) => q.stackId === p.stackId && !q.stackOrder)!.bookId)! : p;
  const baseBox = boxOf(layout, books, base.bookId)!;
  // 선반 앞 끝·벽까지는 바로 자르고(계산 없이), 옆 책·받침에 막히는 것만 찾아 좁힌다
  const range = depthRange(layout, books, upper ? bookId : base.bookId);
  const dz = Math.max(range.lo, Math.min(range.hi, z + (upper ? 0 : baseBox.z - box.z))) - (upper ? box.z : baseBox.z);
  if (Math.abs(dz) < 0.01) return { ok: false, reason: 'no-change' };
  const desired = bookXs(layout, books);
  const r = farthest((k) => {
    const placements = layout.placements.map((q) => {
      if (upper && q.bookId === bookId) return { ...q, stackDz: round2((q.stackDz ?? 0) + dz * k) || undefined };
      if (!upper && q.bookId === base.bookId) {
        return { ...q, depth: round2(baseBox.z + dz * k) };
      }
      return q;
    });
    const next = settle({ ...layout, placements }, books, desired, p.shelfId);
    return checkSpace(next, books, p.shelfId) || !sameXs(layout, next, books, p.shelfId) ? null : next;
  });
  if (!r || r.k === 0) return { ok: false, reason: 'no-space' };
  return finish(layout, r.layout, books);
}

// 앞뒤로 갈 수 있는 범위(상자 앞면 z): 선반 앞 끝 ~ 벽(상자 깊이만큼 뺀 곳)
export function depthRange(layout: ShelfLayout, books: BookMap, bookId: string) {
  const box = boxOf(layout, books, bookId);
  if (!box) return { lo: -SHELF_FRONT, hi: SHELF_DEPTH, z: 0 };
  // 표지 책: 기대도 바닥 자리(뒤쪽 아래 모서리)는 그대로이므로, 똑바로 섰을 때 기준(앞 끝 ~ 벽에 뒷면이 닿을 때)
  if (box.pose === 'front' && !placementOf(layout, bookId)?.stackId) {
    const e = frontExt(books[bookId], { spin: box.spin });
    return { lo: -SHELF_FRONT - e.z0, hi: SHELF_DEPTH - e.z1, z: box.z };
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(fromPlaced(box))) {
    lo = Math.min(lo, c.z);
    hi = Math.max(hi, c.z);
  }
  return { lo: -SHELF_FRONT + (box.z - lo), hi: SHELF_DEPTH - (hi - box.z), z: box.z };
}


// ---------- 표지 전시 책: 뒤로 젖힘·좌우 돌리기·앞뒤(domain/front-pose) ----------

// 저장된 젖힘(예전 저장본의 wallLean은 거리로 계산)
function frontPitchOf(b: Book, p: BookPlacement, depth: number) {
  if (p.pitch !== undefined) return p.pitch;
  return p.wallLean ? wallPitch(b, depth, true) : 0;
}

// 지금 자세와 돌리기 축의 x
export function frontStateOf(layout: ShelfLayout, books: BookMap, bookId: string): { state: FrontState; qx: number } | null {
  const p = placementOf(layout, bookId);
  const box = boxOf(layout, books, bookId);
  if (!p || !box || p.pose !== 'front' || p.stackId) return null;
  const state = { depth: box.z, pitch: box.pitch ?? 0, spin: box.spin ?? 0 };
  return { state, qx: box.x - frontExt(books[bookId], state).x0 };
}

// 이 자세로 놓는다: 돌리기 축(qx)은 그대로, 다른 책은 밀지 않는다. 안 되면 null.
export function applyFront(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, st: FrontState): ShelfLayout | null {
  const p = placementOf(layout, bookId)!;
  const e = frontExt(books[bookId], st);
  const pos = round2(qx + e.x0);
  const placements = layout.placements.map((q) =>
    q.bookId === bookId ? { ...q, depth: round2(st.depth), pitch: round2(st.pitch) || undefined, spin: round2(st.spin) || undefined, wallLean: undefined, pos } : q,
  );
  const desired = bookXs(layout, books);
  desired.set(bookId, pos);
  const next = settle({ ...layout, placements }, books, desired, p.shelfId);
  if (checkSpace(next, books, p.shelfId)) return null;
  const xa = bookXs(layout, books);
  const xb = bookXs(next, books);
  for (const q of next.placements) {
    if (q.shelfId !== p.shelfId) continue;
    const want = q.bookId === bookId ? pos : xa.get(q.bookId) ?? 0;
    if (Math.abs((xb.get(q.bookId) ?? 0) - want) > 0.05) return null;
  }
  return next;
}

// from → to 사이에서 되는 곳까지(막히면 그 직전, 큰 점프 없이)
function reach(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, at: (k: number) => FrontState) {
  const r = farthest((k) => applyFront(layout, books, bookId, qx, at(k)));
  return r ? { layout: r.layout, state: at(r.k) } : null;
}

// 머리를 잡고 젖히기(끄는 동안 한 걸음씩): cur에서 목표 각까지. 결과 레이아웃과 실제로 된 자세.
export function frontTilt(layout: ShelfLayout, books: BookMap, bookId: string, cur: FrontState, qx: number, pitch: number) {
  const dims = frontDims(books[bookId]);
  return reach(layout, books, bookId, qx, (k) => tiltStep(dims, cur, cur.pitch + (pitch - cur.pitch) * k, SHELF_DEPTH));
}

// 머리를 잡고 좌우로 돌리기(0 근처는 살짝 붙는다)
export function frontSpin(layout: ShelfLayout, books: BookMap, bookId: string, cur: FrontState, qx: number, spin: number) {
  const dims = frontDims(books[bookId]);
  const want = Math.abs(spin) < 0.8 ? 0 : spin;
  return reach(layout, books, bookId, qx, (k) => spinStep(dims, cur, cur.spin + (want - cur.spin) * k, SHELF_DEPTH, MAX_SPIN));
}

// 손을 놓을 때: 벽에 기대 있으면 그대로, 받침 없이 기울어 있으면 제자리에서 세운다(안 되면 null = 조작 전으로).
export function frontRelease(layout: ShelfLayout, books: BookMap, bookId: string, cur: FrontState, qx: number): ShelfLayout | null {
  const dims = frontDims(books[bookId]);
  if (!unsupported(dims, cur, SHELF_DEPTH)) return applyFront(layout, books, bookId, qx, cur);
  return applyFront(layout, books, bookId, qx, { ...cur, pitch: 0 });
}

// 앞뒤 막대(보조): 바닥 자리를 옮긴다. 벽 가까이면 머리가 벽에 닿는 각으로 기대고(회전한 상자로 계산),
// 기대기 시작은 WALL_LEAN_ENTER 안쪽, 풀림은 WALL_LEAN_MAX 바깥(끄는 동안은 prevLean을 이어받는다).
function setFrontDepth(layout: ShelfLayout, books: BookMap, bookId: string, z: number, prevLean?: boolean): Result {
  const f = frontStateOf(layout, books, bookId)!;
  const dims = frontDims(books[bookId]);
  const range = depthRange(layout, books, bookId);
  const target = Math.max(range.lo, Math.min(range.hi, z));
  if (Math.abs(target - f.state.depth) < 0.01) return { ok: false, reason: 'no-change' };
  const was = prevLean ?? f.state.pitch > 0;
  const at = (k: number): FrontState => {
    const depth = f.state.depth + (target - f.state.depth) * k;
    const need = pitchForWall(dims, depth, f.state.spin, SHELF_DEPTH);
    const lean = need !== null && need <= (was ? WALL_LEAN_MAX : WALL_LEAN_ENTER);
    return { depth, pitch: lean ? need! : 0, spin: f.state.spin };
  };
  const r = reach(layout, books, bookId, f.qx, at);
  if (!r) return { ok: false, reason: 'no-space' };
  return finish(layout, r.layout, books);
}

// 좌우 돌리기 한 단계(다이얼처럼): 눕힘 ← 왼쪽 기울임 ← 똑바로 → 오른쪽 기울임.
// 눕힘은 왼쪽으로만(앞표지가 위, 뒤표지가 받침이 되는 방향). 표지 책은 먼저 세운다. 끝에서 더 돌리면 no-change.
export function rotateStep(layout: ShelfLayout, books: BookMap, bookId: string, dir: -1 | 1): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.pose === 'front') return setPose(layout, books, bookId, 'spine');
  if (p.pose === 'horizontal') return dir > 0 ? setPose(layout, books, bookId, 'spine') : { ok: false, reason: 'no-change' };
  const side = Math.sign(p.tilt);
  if (side === -dir) return setTilt(layout, books, bookId, 0);
  if (side === 0) return setTilt(layout, books, bookId, (dir * 7) as Tilt);
  if (dir > 0) return { ok: false, reason: 'no-change' };
  return setPose(layout, books, bookId, 'horizontal');
}

// 눕힌 책을 선반 위에서 비스듬히(수직축 회전). 원하는 각도가 안 되면(선반 끝·깊이·받침) 0 쪽으로 좁혀 가능한 가장 가까운 각도.
// 다른 책은 제자리에 두고, 넓어진 만큼만 기존 규칙대로 민다. 결과 각도는 result.layout의 spin에 들어 있다.
export function setSpin(layout: ShelfLayout, books: BookMap, bookId: string, deg: number): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (p.pose !== 'horizontal') return { ok: false, reason: 'spin-only-lying' };
  const want = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, Math.abs(deg) < 1 ? 0 : deg));
  const desired = bookXs(layout, books);
  const book = books[bookId];
  const z0 = placementDepth(book, p);
  const center = (z0.z0 + z0.z1) / 2; // 가운데를 축으로 돈다: 깊이 가운데는 그대로(선반 앞선·뒷벽 안으로만)
  const tryAt = (a: number): ShelfLayout | null => {
    const spin = Math.round(a * 100) / 100 || undefined;
    const d = spunExtent(book, spin).d;
    const depth = Math.round(Math.max(-SHELF_FRONT, Math.min(SHELF_DEPTH - d, center - d / 2)) * 100) / 100;
    const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, spin, depth: p.stackId ? q.depth : depth } : q));
    const next = settle({ ...layout, placements }, books, desired, p.shelfId);
    return checkSpace(next, books, p.shelfId) ? null : next;
  };
  let best = tryAt(want);
  if (!best) {
    // 0 쪽으로 이분 탐색(12° 기준 0.2° 안쪽까지)
    let ok = 0;
    let bad = want;
    for (let i = 0; i < 6; i++) {
      const mid = (ok + bad) / 2;
      if (tryAt(mid)) ok = mid;
      else bad = mid;
    }
    best = tryAt(ok);
  }
  if (!best) return { ok: false, reason: 'no-space' };
  return finish(layout, best, books);
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
// 눕힌 책/그룹의 가운데 절반 위에 가져가면 쌓기(세운 책은 눕혀서), 그 밖은 나란히 놓기.
export function findDropTarget(
  detached: ShelfLayout,
  books: BookMap,
  shelfId: string,
  centerX: number,
  draggedPose: Pose,
  draggedWidth = 0,
): DropTarget {
  const positions = itemPositions(shelfItems(detached, shelfId), detached, books);
  // 세운 책도 눕힌 책 가운데 위에 놓으면 그 위에 눕혀 쌓는다(바닥 자리가 없어도 쌓을 수 있게)
  void draggedPose;
  for (const pos of positions) {
    const inMiddle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (inMiddle && isHorizontalItem(pos.item, detached)) {
      return { kind: 'stack', shelfId, itemKey: pos.item.key };
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

// 저장본을 지금 선반 경계에 맞춘다(예: 깊이 300mm·눕힌 책 20DU 돌출을 허용하던 시절 저장본).
// 필요한 책만 최소로 옮긴다: ① 깊이가 벗어난 항목만 안쪽으로 당기고 ② 좌우는 지금 자리를 원하는 위치로 두고 다시 맞추고
// ③ 그래도 안 되면 그 선반 눕힌 책의 회전만 줄이고 ④ 마지막으로 선반에 들어가지 않는 오른쪽 끝 책부터 서랍에 넣는다(moved로 알린다).
// 책 정보·독서 기록은 건드리지 않는다(배치만).
export function fitToShelf(layout: ShelfLayout, books: BookMap): { layout: ShelfLayout; moved: string[]; changed: boolean } {
  let l = layout;
  const moved: string[] = [];
  for (const shelf of sortedShelves(layout)) {
    const items = shelfItems(l, shelf.id);
    if (!items.length || !checkSpace(l, books, shelf.id)) continue; // 이미 맞는 선반은 그대로(저장본을 다시 쓰지 않는다)
    // ① 깊이
    const shifts = new Map<string, number>();
    for (const item of items) {
      const z = itemDepth(item, l, books);
      const dz = z.z1 > SHELF_DEPTH ? SHELF_DEPTH - z.z1 : z.z0 < -SHELF_FRONT ? -SHELF_FRONT - z.z0 : 0;
      if (Math.abs(dz) > 1e-6) shifts.set(item.bookIds[0], dz);
    }
    if (shifts.size) {
      l = {
        ...l,
        placements: l.placements.map((p) => {
          const dz = shifts.get(p.bookId);
          if (dz === undefined) return p;
          const b = books[p.bookId];
          return { ...p, depth: Math.round(((p.depth ?? defaultDepth(b, p.pose)) + dz) * 100) / 100 };
        }),
      };
    }
    // ② 좌우: 지금 보이는 자리를 원하는 위치로 다시 맞춘다(경계 안으로, 겹치면 최소로 민다)
    l = settle(l, books, bookXs(l, books), shelf.id);
    if (!checkSpace(l, books, shelf.id)) continue;
    // ③ 회전 줄이기: 먼저 전부 0으로 해 보고, 되면 책마다 가능한 만큼 다시 돌린다
    const spun = l.placements.filter((p) => p.shelfId === shelf.id && p.spin);
    if (spun.length) {
      const flat = settle({ ...l, placements: l.placements.map((p) => (p.shelfId === shelf.id && p.spin ? { ...p, spin: undefined } : p)) }, books, bookXs(l, books), shelf.id);
      if (!checkSpace(flat, books, shelf.id)) {
        l = flat;
        for (const p of spun) {
          const r = setSpin(l, books, p.bookId, p.spin!);
          if (r.ok) l = r.layout;
        }
        continue;
      }
      l = flat;
    }
    // ④ 오른쪽 끝부터 서랍으로
    while (checkSpace(l, books, shelf.id)) {
      const its = shelfItems(l, shelf.id);
      if (!its.length) break;
      const last = its[its.length - 1];
      for (const id of [...last.bookIds].reverse()) {
        const r = moveToDrawer(l, id, books);
        if (r.ok) l = r.layout;
        moved.push(id);
      }
      l = settle(l, books, bookXs(l, books), shelf.id);
    }
  }
  const changed = JSON.stringify(l.placements) !== JSON.stringify(layout.placements) || l.drawer.length !== layout.drawer.length;
  return { layout: changed ? normalize(l) : layout, moved, changed };
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
// 눕힌 책/그룹의 가운데 절반 위에 놓으면 쌓기(세운 책은 눕혀서).
export type SwapTarget =
  | { kind: 'swap'; itemKey: string }
  | { kind: 'stack'; itemKey: string }
  | { kind: 'place'; x: number } // 그 자리에 놓기(x: 책 왼쪽 끝). 제자리에서 조금 옮기는 것도 이것
  | { kind: 'shift'; dx: number } // 쌓인 위 책을 아래 책 위에서 옆으로
  | { kind: 'self' };

export function findSwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, centerX: number): SwapTarget {
  const p = placementOf(layout, bookId)!;
  const positions = itemPositions(shelfItems(layout, p.shelfId), layout, books);
  const mine = positions.find((pos) => pos.item.bookIds.includes(bookId))!;
  const box = itemBoxes(mine.item, layout, books, mine.x).find((b) => b.bookId === bookId)!;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of corners(fromPlaced(box))) {
    lo = Math.min(lo, c.x);
    hi = Math.max(hi, c.x);
  }
  const cur = (lo + hi) / 2;
  const upper = !!p.stackId && (p.stackOrder ?? 0) > 0;
  const base = isStackBase(layout, bookId);
  for (const pos of positions) {
    if (centerX < pos.x || centerX > pos.x + pos.width) continue;
    if (pos === mine) {
      // 제자리 위: 끈 만큼 그대로 옮긴다(위 책은 아래 책 위에서만)
      if (Math.abs(centerX - cur) < 0.5) return { kind: 'self' };
      if (upper) return { kind: 'shift', dx: Math.round((centerX - cur) * 2) / 2 };
      return { kind: 'place', x: Math.round(lo + (centerX - cur)) };
    }
    const middle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (!base && middle && isHorizontalItem(pos.item, layout)) return { kind: 'stack', itemKey: pos.item.key };
    break; // 다른 책 위: 그 자리에 끼워 넣고 옆 책들을 민다(자리 바꾸기 대신). 깊이가 떨어져 있으면 겹쳐 놓인다
  }
  // 빈 곳·다른 책 위: 끄는 책이 지금 자리에서 옮겨 간 만큼(더미째 옮기면 더미 왼쪽 끝 기준)
  return { kind: 'place', x: Math.round(lo + (centerX - cur)) };
}

export function applySwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, t: SwapTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (t.kind === 'self') return { ok: false, reason: 'no-change' };
  if (t.kind === 'shift') return shiftOnStack(layout, books, bookId, t.dx);
  if (t.kind === 'stack') return moveBook(layout, books, bookId, { kind: 'stack', shelfId: p.shelfId, itemKey: t.itemKey });
  if (t.kind === 'place') {
    // 끼울 순서: 지금 화면의 위치(빼기 전)에서 끄는 책(더미)의 가운데보다 가운데가 왼쪽인 책 수
    const all = itemPositions(shelfItems(layout, p.shelfId), layout, books);
    const mine = all.find((pos) => pos.item.bookIds.includes(bookId));
    // 위 책이 더미를 떠날 때는 그 책 폭, 아니면 자리 폭
    const w = mine && p.stackId && !isStackBase(layout, bookId) ? boxOf(layout, books, bookId)?.size.w ?? mine.width : mine?.width ?? 0;
    const center = t.x + w / 2;
    const index = all.filter((pos) => pos !== mine && pos.x + pos.width / 2 < center).length;
    return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index, x: t.x });
  }
  return swapWith(layout, books, bookId, t.itemKey);
}
