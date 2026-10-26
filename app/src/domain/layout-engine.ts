// 순수 배치 계산. UI와 저장소는 여기서 검증된 레이아웃만 확정한다.
import {
  bookHeight,
  bookThickness,
  placementDepth,
  spunExtent,
  SHELF_DEPTH,
  SHELF_FRONT,
  MAX_FRONT_SPIN,
  MAX_SPIN,
  frontWidth,
  LYING_BACK_Z,
  defaultDepth,
  WALL_GAP,
  wallPitch,
  frontDims,
  frontExt,
  MAX_STACK,
  SHELF,
  SHELF_USABLE_WIDTH,
  singleFootprint,
  HOME_SHELF_COUNT,
} from './geometry';
import { corners, frontBook3, fromPlaced, gap, lowest, xRange, type Book3 } from './book3';
import { boxSize, type Placed } from './box';
import { frontFall2, frontLean, frontLeaner2, frontSupport2, pitchForWall, releasedPitch, spinStep, tiltStep, type FrontState } from './front-pose';
import { leanContact } from './lean';
import { LEAN_MENU_MAX, menuLeanAngle, penetration2, wallLeanRest } from './statics';
import { stackBoxes, stackSupported } from './support';
import { tiltToward, type Book, type BookPlacement, type Pose, type ShelfLayout, type ShelfLayoutV1, type Tilt } from './types';

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
  | 'cannot-lean'
  | 'no-change';

export type Result = { ok: true; layout: ShelfLayout } | { ok: false; reason: FailReason };

export type DropTarget =
  | { kind: 'insert'; shelfId: string; index: number; x?: number } // index는 끌고 있는 책을 뺀 뒤의 자리, x는 빈 공간에 놓을 때 왼쪽 끝
  | { kind: 'stack'; shelfId: string; itemKey: string };

const stackIdFor = (bottomBookId: string) => `stack:${bottomBookId}`;
const round2 = (v: number) => Math.round(v * 100) / 100;

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


// 쌓기 더미 구성원(아래 → 위): 받침 깊이는 맨 아래 책 것, 위 책은 사용자가 옮긴 어긋남(stackDx/Dz)을 함께
export function stackMembers(item: ShelfItem, layout: ShelfLayout, books: BookMap) {
  const base = placementOf(layout, item.bookIds[0]);
  return item.bookIds.map((id) => {
    const p = placementOf(layout, id);
    return { bookId: id, book: books[id], spin: p?.spin, depth: base?.depth, dx: p?.stackDx, dz: p?.stackDz, flip: p?.flip };
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

// 눕힌 책(더미) 바로 뒤에 두는 틈(DU): 뒤에 놓인 더미의 오른쪽 끝면이 옆 책에 가리지 않게, 더미 깊이에 비례해 조금 띄운다.
// (예전에는 카메라 kx로 계산했다. 같은 값을 카메라와 상관없는 배치 규칙으로 고정: 보기 각을 바꿔도 책 자리가 바뀌지 않는다)
const LYING_END_GAP_PER_DU = 0.012;
function lyingEndGap(item: ShelfItem, books: BookMap) {
  const depth = Math.max(...item.bookIds.map((id) => frontWidth(books[id])));
  return (LYING_BACK_Z + depth) * LYING_END_GAP_PER_DU;
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
  const flip = p.pose === 'horizontal' && p.flip ? true : undefined;
  return [{ bookId: p.bookId, pose: p.pose, size: boxSize(b, p.pose), x, y: 0, z, angle: 0, spin, pitch, flip }];
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

// 두 항목 사이 최소 간격(실제 3D 상자): 뒤 항목(b)을 오른쪽으로 s만큼 옮겼을 때 앞 항목(a)의 어떤 상자와도 겹치지 않는 가장 작은 s.
// a·b는 둘 다 왼쪽 끝 x=0 기준 상자. 어느 s에서도 겹치지 않으면(앞뒤로 떨어져 있으면) -Infinity.
// 화면 윤곽이 겹쳐 보이는 것과 무관하게 상자끼리 실제로 부딪히는지만 본다(돌린 책은 꼭짓점끼리 비껴 설 수 있다).
const TOUCH = 0.01; // 이만큼 파고드는 것까지는 닿은 것으로 본다
const sepCache = new Map<string, number>();
function boxKeyOf(list: Placed[]) {
  return list.map((p) => [p.pose, p.size.w, p.size.h, p.size.d, round2(p.x), round2(p.y), round2(p.z), p.angle, p.spin ?? 0, p.pitch ?? 0].join(',')).join(';');
}
function minSeparation(a: Placed[], b: Placed[]): number {
  const key = `${boxKeyOf(a)}|${boxKeyOf(b)}`;
  const hit = sepCache.get(key);
  if (hit !== undefined) return hit;
  const A = a.map(fromPlaced);
  const B = b.map(fromPlaced);
  const xs = (list: Book3[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of list) for (const c of corners(q)) {
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
    }
    return { lo, hi };
  };
  const ax = xs(A);
  const bx = xs(B);
  const hits = (s: number) => {
    for (const q of B) {
      const moved = { ...q, t: { x: q.t.x + s, y: q.t.y, z: q.t.z } };
      for (const r of A) if (gap(r, moved) < -TOUCH) return true;
    }
    return false;
  };
  // 겹칠 수 있는 s는 x 범위가 겹치는 구간 안뿐: 그 안을 훑어 가장 오른쪽 충돌을 찾고, 그 오른쪽 경계를 이분 탐색
  const sMin = ax.lo - bx.hi;
  const sMax = ax.hi - bx.lo;
  let found = NaN;
  const N = 32;
  for (let k = N; k >= 0; k--) {
    const v = sMin + ((sMax - sMin) * k) / N;
    if (hits(v)) {
      found = v;
      break;
    }
  }
  let out = -Infinity;
  if (!Number.isNaN(found)) {
    let lo = found;
    let hi = sMax;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (hits(mid)) lo = mid;
      else hi = mid;
    }
    out = hi;
  }
  if (sepCache.size > 5000) sepCache.clear();
  sepCache.set(key, out);
  return out;
}

function packedPositions(items: ShelfItem[], layout: ShelfLayout, books: BookMap, airy = true) {
  // sep[j]: 이 항목이 앞 항목 j보다 최소 얼마나 오른쪽에 있어야 하는지(실제 상자가 부딪히지 않으면 -Infinity)
  const packed: { item: ShelfItem; x: number; width: number; boxes: Placed[]; z: { z0: number; z1: number }; sep: number[] }[] = [];
  for (const item of items) {
    const z = itemDepth(item, layout, books);
    const width = itemWidth(item, layout, books);
    const boxes = itemBoxes(item, layout, books, 0);
    const sep: number[] = packed.map(() => -Infinity);
    const last = packed.length - 1;
    packed.forEach((prev, j) => {
      // 깊이가 겹치지 않는 책끼리는 정면에서 겹쳐 보여도 밀지 않는다
      if (prev.z.z1 <= z.z0 + 0.05 || z.z1 <= prev.z.z0 + 0.05) return;
      const d = minSeparation(prev.boxes, boxes);
      // 기대는 책은 옆 책에 닿아야 한다. 서 있는 책들만 작은 틈을 둔다.
      const current = placementOf(layout, item.bookIds[0]);
      const previous = placementOf(layout, prev.item.bookIds[0]);
      const leaningTogether = (current?.pose === 'spine' && current.tilt < 0) || (previous?.pose === 'spine' && previous.tilt > 0);
      const air = previous?.pose === 'front' || current?.pose === 'front' ? 0 : SHELF.gap;
      if (d > -Infinity) sep[j] = d + (leaningTogether || !airy ? 0 : air);
    });
    // 눕힌 책(더미) 바로 뒤에는 오른쪽 끝면이 보일 만큼 띄운다(뒤에 놓여 옆 책 앞면에 가려지지 않게, 시안처럼)
    // (깊이가 겹치는 경우만: 앞뒤로 떨어져 있으면 끝면을 가릴 일이 없다)
    if (last >= 0 && sep[last] > -Infinity && isHorizontalItem(packed[last].item, layout)) sep[last] = Math.max(sep[last], packed[last].width + lyingEndGap(packed[last].item, books));
    let x = 0;
    packed.forEach((prev, j) => {
      if (sep[j] > -Infinity) x = Math.max(x, prev.x + sep[j]);
    });
    packed.push({ item, x, width, boxes, z, sep });
  }
  // 이미 꽉 찬 책장은 미세 여백 때문에 책을 서랍으로 밀어내지 않는다.
  if (airy && packed.some((p) => p.x + p.width > SHELF_USABLE_WIDTH)) return packedPositions(items, layout, books, false);
  return packed;
}

// ---------- 빈틈과 위치 ----------
// 책은 윤곽대로 붙인 위치(packed) + 앞쪽 빈틈의 누적에 선다. 기울기는 빈틈 안에서만 생기므로 점유 폭은 늘지 않는다.

function posOf(layout: ShelfLayout, item: ShelfItem) {
  return placementOf(layout, item.bookIds[0])?.pos;
}

// 기울인 책(items[i])이 옆 항목에 처음 닿는 각이 want°가 되는 두 항목의 왼쪽 끝 사이 거리(실제 3D 상자, 두 권만 놓고 계산).
// 기울기는 그 틈 안에서 생긴다. 닿을 수 없으면(옆 항목이 너무 낮거나 깊이가 달라 닿지 않음) null.
const spacingCache = new Map<string, number | null>();
export function leanSpacing(items: ShelfItem[], layout: ShelfLayout, books: BookMap, i: number, dir: -1 | 1, want: number): number | null {
  const nb = items[i + dir];
  if (!nb) return null;
  const me = itemBoxes(items[i], layout, books, 0)[0];
  const other = itemBoxes(nb, layout, books, 0);
  const key = `${boxKeyOf([me])}|${boxKeyOf(other)}|${dir}|${want.toFixed(3)}`;
  if (spacingCache.has(key)) return spacingCache.get(key)!;
  const wide = { min: -1e9, max: 1e9 };
  // s = 오른쪽 항목 왼쪽 끝 - 왼쪽 항목 왼쪽 끝
  const angleAt = (s: number) => {
    const others = other.map((o) => ({ ...o, x: o.x + (dir < 0 ? -s : s) }));
    const c = leanContact(me, dir, others, wide, 0, LEAN_MENU_MAX + 10);
    return c.found ? c.angle : Infinity;
  };
  const touch = minSeparation(dir < 0 ? other : [me], dir < 0 ? [me] : other);
  let lo = Number.isFinite(touch) ? touch : 0;
  let hi = lo + me.size.h;
  let out: number | null = null;
  if (angleAt(hi) >= want) {
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (angleAt(mid) >= want) hi = mid;
      else lo = mid;
    }
    out = hi;
  }
  if (spacingCache.size > 2000) spacingCache.clear();
  spacingCache.set(key, out);
  return out;
}

// 메뉴로 기울일 때 노리는 각(넘어짐 한계 + 여유, 한도 넘으면 null)
function leanTarget(book: Book) {
  return menuLeanAngle(bookThickness(book), bookHeight(book));
}

// 위치 값이 하나도 없는 예전 저장본: 가운데 정렬 + 기울인 책이 버틸 수 있는 각(넘어짐 한계 + 여유)으로 기댈 만큼의 빈틈을 만들어 준다.
function legacyXs(items: ShelfItem[], layout: ShelfLayout, books: BookMap, packed: { x: number; width: number }[]) {
  const gaps = items.map(() => 0);
  items.forEach((item, i) => {
    if (item.stacked) return;
    const p = placementOf(layout, item.bookIds[0])!;
    if (p.pose !== 'spine' || p.tilt === 0) return;
    const dir = p.tilt < 0 ? -1 : 1;
    const want = leanTarget(books[p.bookId]);
    const [l, r] = dir < 0 ? [i - 1, i] : [i, i + 1];
    if (want === null || l < 0 || r >= items.length) return;
    const s = leanSpacing(items, layout, books, i, dir, want);
    if (s !== null) gaps[r] += Math.max(0, s - (packed[r].x - packed[l].x));
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
function keptPose(p: Pick<BookPlacement, 'pose' | 'depth' | 'spin' | 'pitch' | 'wallLean' | 'flip'>, stacked: boolean): Partial<BookPlacement> {
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

// 책을 자리에서 빼낸다. 옆 책들은 제자리에 남고 빈자리가 생긴다(books가 없으면 위치 보존 없이 뺀다).
// 그룹에서 빼면 나머지는 빈틈 없이 내려앉는다. 다시 맞추는 것은 그 책이 있던 줄뿐이다: 다른 줄까지 맞추면 저장 위치가 없던 줄
// (예시 배치·옛 저장본)에 반올림한 위치가 붙어, 끄는 동안 상관없는 줄의 자세가 미세하게 바뀌고 경로를 다시 짜게 된다.
export function detach(layout: ShelfLayout, bookId: string, books?: BookMap): ShelfLayout {
  const from = layout.placements.find((p) => p.bookId === bookId)?.shelfId;
  const removed = normalize({ ...layout, placements: layout.placements.filter((p) => p.bookId !== bookId) });
  return books ? settle(removed, books, bookXs(layout, books), from) : removed;
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
  // 깊이·수직축 회전·젖힘·머리 방향은 옮겨도 그대로(자리만 바뀐다)
  placements.push({ bookId: placement.bookId, pose: placement.pose, tilt: placement.tilt, shelfId, order: at, ...keptPose(placement, false) });
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

// ---------- 끼워 넣을 때 옆 책 비키기(한쪽 우선) ----------
// 옮긴 항목을 가리킨 자리 x(깊이·자세 그대로)에 고정하고, 실제 3D 상자가 부딪히는 이웃을 모두 한쪽으로 필요한 만큼만 비킨다.
// 먼저 왼쪽: 부딪히는 이웃을 모두 옮긴 항목 왼쪽에 두고 왼쪽으로 연쇄해 민다. 왼쪽 공간이 모자라면 드래그 시작 배치에서
// 다시 오른쪽 후보를 계산한다(왼쪽 결과에 덧붙이지 않는다). 둘 다 안 되면 마지막으로 양쪽 이웃을 각자 바깥으로 나눠 비키고,
// 그것도 안 되면 null. 옮긴 항목은 옆이나 앞으로 옮겨 끼우지 않는다.
// 부딪히지 않는 책(앞뒤로 떨어진 책 포함)과 빈틈은 그대로, 쌓기 더미는 한 항목이라 통째로, 기대는 책은 받치는 책과 함께.
// base: 옮긴 책을 뺀 드래그 시작 배치. want: 그 배치의 항목 자리.
export function pushOneSide(
  base: ShelfLayout,
  books: BookMap,
  shelfId: string,
  insertAt: (index: number) => ShelfLayout,
  movedKey: string,
  x: number,
  want: Map<string, number>,
): { layout: ShelfLayout; side: 'left' | 'right' | 'split' | 'none' } | null {
  const baseItems = shelfItems(base, shelfId);
  const n0 = baseItems.length;
  // 부딪힘·좌우 판정: 옮긴 항목과 각 항목을 두 순서로 두어 필요한 간격(sep)을 잰다
  const probe = insertAt(n0);
  const moved = shelfItems(probe, shelfId).find((it) => it.key === movedKey);
  if (!moved) return null;
  const mw = itemWidth(moved, probe, books);
  const probeItems = shelfItems(probe, shelfId);
  const sepPair = (a: ShelfItem, b: ShelfItem) => packedPositions([a, b], probe, books)[1].sep[0];
  const side = baseItems.map((it0) => {
    const it = probeItems.find((q) => q.key === it0.key)!;
    const xi = want.get(it.key) ?? 0;
    const sl = sepPair(it, moved); // it이 왼쪽일 때 필요한 간격
    const sr = sepPair(moved, it); // it이 오른쪽일 때
    const leftOk = sl === -Infinity || x >= xi + sl - 0.01;
    const rightOk = sr === -Infinity || xi >= x + sr - 0.01;
    const center = xi + itemWidth(it, probe, books) / 2;
    return { collide: !leftOk && !rightOk, left: center < x + mw / 2 };
  });
  // 나눠 비키기(마지막 대안)는 각 항목이 실제로 있던 쪽으로: 기대는 쌍 사이에 끼우면 기댄 책은 확정 때 새 이웃에 다시 기댄다
  const natural = side.map((q) => q.left);
  // 기대는 책과 받치는 책은 같은 쪽으로(둘 중 하나라도 부딪히면 묶음째)
  const leansOnBase = (a: ShelfItem, b: ShelfItem) => !a.stacked && b.bookIds.includes(placementOf(base, a.bookIds[0])?.lean?.on ?? '');
  for (let i = 0; i + 1 < n0; i++) {
    if (!(leansOnBase(baseItems[i], baseItems[i + 1]) || leansOnBase(baseItems[i + 1], baseItems[i]))) continue;
    const c = side[i].collide || side[i + 1].collide;
    const l = side[i].left && side[i + 1].left ? true : !side[i].left && !side[i + 1].left ? false : side[i].left;
    side[i] = { collide: c, left: l };
    side[i + 1] = { collide: c, left: l };
  }
  const { lo, hi } = bounds(baseItems, base);
  const leansOn = (l: ShelfLayout, a: ShelfItem, b: ShelfItem) => !a.stacked && b.bookIds.includes(placementOf(l, a.bookIds[0])?.lean?.on ?? '');
  // dir: 'left' 옮긴 항목 왼쪽 것만 왼쪽으로 연쇄, 'right' 오른쪽 것만 오른쪽으로, 'split' 양쪽을 각자 바깥으로(index가 나누는 자리)
  const tryAt = (index: number, dir: 'left' | 'right' | 'split'): ShelfLayout | null => {
    const next = insertAt(index);
    const items = shelfItems(next, shelfId);
    const m = items.findIndex((it) => it.key === movedKey);
    const packed = packedPositions(items, next, books);
    const n = items.length;
    const base0 = items.map((it, i) => (i === m ? x : want.get(it.key) ?? packed[i].x));
    const link = items.map((it, i) => i + 1 < n && i !== m && i + 1 !== m && (leansOn(next, it, items[i + 1]) || leansOn(next, items[i + 1], it)));
    const xs = [...base0];
    if (dir !== 'right') {
      for (let round = 0; round < 3; round++) {
        for (let j = m - 1; j >= 0; j--) {
          let v = xs[j];
          for (let k = j + 1; k <= m; k++) if (packed[k].sep[j] > -Infinity) v = Math.min(v, xs[k] - packed[k].sep[j]);
          if (link[j] && j + 1 < m) v = Math.min(v, xs[j + 1] - (base0[j + 1] - base0[j]));
          xs[j] = v;
        }
        for (let j = 0; j < m - 1; j++) if (link[j]) xs[j + 1] = Math.min(xs[j + 1], xs[j] + (base0[j + 1] - base0[j]));
      }
    }
    if (dir !== 'left') {
      for (let round = 0; round < 3; round++) {
        for (let i = m + 1; i < n; i++) {
          let v = xs[i];
          for (let j = m; j < i; j++) if (packed[i].sep[j] > -Infinity) v = Math.max(v, xs[j] + packed[i].sep[j]);
          if (link[i - 1] && i - 1 > m) v = Math.max(v, xs[i - 1] + (base0[i] - base0[i - 1]));
          xs[i] = v;
        }
        for (let i = n - 1; i > m + 1; i--) if (link[i - 1]) xs[i - 1] = Math.max(xs[i - 1], xs[i] - (base0[i] - base0[i - 1]));
      }
    }
    // 모든 쌍이 부딪히지 않아야(한쪽만 밀었으니 반대쪽에 부딪힘이 남으면 이 후보는 안 된다) + 선반 안
    for (let i = 0; i < n; i++) {
      if (xs[i] < lo - 0.01 || xs[i] + packed[i].width > hi + 0.01) return null;
      for (let j = 0; j < i; j++) if (packed[i].sep[j] > -Infinity && xs[i] < xs[j] + packed[i].sep[j] - 0.01) return null;
    }
    return withItemXs(next, shelfId, new Map(items.map((it, i) => [it.key, round2(xs[i])])));
  };
  const collides = side.some((q) => q.collide);
  // 끼울 순서: 왼쪽 후보는 부딪히는 이웃을 모두 왼쪽에, 오른쪽 후보는 모두 오른쪽에
  const lastLeft = side.reduce((acc, q, i) => (q.left || q.collide ? i : acc), -1);
  const firstRight = side.findIndex((q) => !q.left || q.collide);
  if (!collides) {
    const r = tryAt(lastLeft + 1, 'left');
    return r ? { layout: r, side: 'none' } : null;
  }
  const left = tryAt(lastLeft + 1, 'left');
  if (left) return { layout: left, side: 'left' };
  const right = tryAt(firstRight < 0 ? n0 : firstRight, 'right');
  if (right) return { layout: right, side: 'right' };
  // 마지막 대안: 두 책 경계처럼 양쪽 이웃과 함께 부딪혀 한쪽으로 모두 넘길 수 없을 때, 옮긴 항목 왼쪽에 있던 이웃은 왼쪽으로,
  // 오른쪽에 있던 이웃은 오른쪽으로 나눠 비킨다(옮긴 항목 자리는 그대로, 부딪히는 이웃만)
  const split = natural.findIndex((l) => !l);
  const both = tryAt(split < 0 ? n0 : split, 'split');
  if (both) return { layout: both, side: 'split' };
  return null;
}

// 항목 자리(pushAside 결과)를 저장 위치(pos)로
function withItemXs(layout: ShelfLayout, shelfId: string, xs: Map<string, number>): ShelfLayout {
  const byBook = new Map<string, number>();
  for (const it of shelfItems(layout, shelfId)) {
    const v = xs.get(it.key);
    if (v !== undefined) it.bookIds.forEach((id) => byBook.set(id, v));
  }
  return { ...layout, placements: layout.placements.map((p) => (byBook.has(p.bookId) ? { ...p, pos: byBook.get(p.bookId) } : p)) };
}

// 끼워 넣을 순서(메뉴·서랍처럼 자리를 가리키지 않는 이동용): 가운데가 center보다 왼쪽인 항목 수
function insertIndex(positions: { x: number; width: number }[], center: number) {
  return positions.filter((q) => q.x + q.width / 2 < center).length;
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
    const placement = { ...p, stackId: undefined, depth };
    if (target.x === undefined) return finish(layout, insertItem(base, placement, target.shelfId, target.index, books), books);
    // 놓을 자리가 정해졌으면: 그 자리(선반 안으로만 맞춤)에 깊이·자세 그대로 두고, 부딪히는 옆 책을 한쪽으로 비킨다(드래그 시작 배치 기준)
    const x = clampX(base, books, target.shelfId, insertItem(base, placement, target.shelfId, 0), bookId, target.x);
    const r = pushOneSide(base, books, target.shelfId, (i) => insertItem(base, placement, target.shelfId, i), bookId, x, itemXs(base, books, target.shelfId));
    if (!r) return { ok: false, reason: 'no-space' };
    return finish(layout, r.layout, books);
  }
  const item = shelfItems(base, target.shelfId).find((it) => it.key === target.itemKey);
  if (!item || !isHorizontalItem(item, base)) return { ok: false, reason: 'not-stackable' };
  if (item.bookIds.length >= MAX_STACK) return { ok: false, reason: 'stack-full' };
  const stackId = stackIdFor(item.bookIds[0]);
  const placements = base.placements.map((q) =>
    item.bookIds.includes(q.bookId) ? { ...q, stackId, stackOrder: item.bookIds.indexOf(q.bookId) } : q,
  );
  // 눕힌 책을 그대로 얹을 때는 머리 방향(flip)도 그대로(빠지면 들어 올린 채 180° 구른다)
  placements.push({
    bookId,
    shelfId: target.shelfId,
    order: item.order,
    pose: 'horizontal',
    tilt: 0,
    stackId,
    stackOrder: item.bookIds.length,
    ...(p.pose === 'horizontal' && p.flip ? { flip: true } : null),
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
  if (found.pose === pose && !(pose === 'front' && (found.pitch ?? 0) >= 89.95)) return { ok: false, reason: 'no-change' };
  const { p, index } = itemIndexOf(layout, bookId);
  const book = books[bookId];
  // 새 자세의 깊이: 사용자가 둔 깊이(더미에서 나오면 지금 놓인 깊이)는 자세를 바꿔도 지키고 선반 안으로만 맞춘다.
  // 처음 표지 전시하는 책(깊이 기록 없음)은 뒤쪽(벽에서 WALL_GAP 앞)에 세워 본다.
  const kept = p.stackId ? boxOf(layout, books, bookId)?.z : p.depth;
  const d = placementDepth(book, { pose, depth: 0 }).z1;
  const fit = (z: number) => round2(Math.max(-SHELF_FRONT, Math.min(SHELF_DEPTH - d, z)));
  const tries: (number | undefined)[] = kept !== undefined ? [fit(kept)] : pose === 'front' ? [fit(SHELF_DEPTH - WALL_GAP - d), undefined] : [undefined];
  let last: Result = { ok: false, reason: 'no-space' };
  for (const depth of tries) {
    if (p.stackId) {
      // 그룹에서 빠져 바로 오른쪽 자리로 나온다.
      const base = detach(layout, bookId, books);
      last = finish(layout, insertItem(base, { bookId, pose, tilt: 0, depth }, p.shelfId, index + 1, books), books);
    } else {
      const placements = layout.placements.map((q) => (q.bookId === bookId ? { ...q, pose, tilt: 0 as Tilt, depth, spin: undefined, pitch: undefined, wallLean: undefined, flip: undefined } : q));
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
  const joined = normalize({ ...removed, placements });
  if (x !== undefined) {
    // 더미를 index 자리에 다시 쌓은 배치
    const at = (i: number) => {
      const wb = insertItem(removed, { ...p, stackId: undefined }, shelfId, i);
      const bo = placementOf(wb, baseId)!.order;
      const pl = wb.placements.map((q) => (q.bookId === baseId ? { ...q, stackId, stackOrder: 0 } : q));
      members.slice(1).forEach((mm, k) => pl.push({ ...mm, shelfId, order: bo, stackId, stackOrder: k + 1 }));
      return normalize({ ...removed, placements: pl });
    };
    const r = pushOneSide(removed, books, shelfId, at, stackId, clampX(removed, books, shelfId, at(0), stackId, x), itemXs(removed, books, shelfId));
    if (!r) return { ok: false, reason: 'no-space' };
    return finish(layout, r.layout, books);
  }
  return finish(layout, settle(joined, books, bookXs(removed, books)), books);
}

// 한 선반 항목들의 지금 자리(항목 키 → 왼쪽 끝)
function itemXs(layout: ShelfLayout, books: BookMap, shelfId: string) {
  return new Map(itemPositions(shelfItems(layout, shelfId), layout, books).map((q) => [q.item.key, q.x]));
}

// 가리킨 자리를 선반 좌우 끝 안으로만 맞춘다(끝을 넘겨 끌어도 끝에 놓이게. 다른 책을 피하려고 옮기지는 않는다)
function clampX(base: ShelfLayout, books: BookMap, shelfId: string, withMoved: ShelfLayout, movedKey: string, x: number) {
  const item = shelfItems(withMoved, shelfId).find((it) => it.key === movedKey);
  if (!item) return x;
  const { lo, hi } = bounds(shelfItems(base, shelfId), base);
  return Math.max(lo, Math.min(hi - itemWidth(item, withMoved, books), x));
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
    const e = frontExt(books[bookId], { spin: box.spin, pitch: (box.pitch ?? 0) >= 89.95 ? 90 : 0 });
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

// 저장된 젖힘(예전 저장본의 wallLean은 거리로 계산하고, 버티지 못하는 각이면 서거나 눕힌다: statics.ts)
function frontPitchOf(b: Book, p: BookPlacement, depth: number) {
  if (p.pitch !== undefined) return p.pitch;
  return p.wallLean ? wallLeanRest(bookThickness(b), bookHeight(b), wallPitch(b, depth, true)) : 0;
}

// 지금 자세와 돌리기 축의 x
export function frontStateOf(layout: ShelfLayout, books: BookMap, bookId: string): { state: FrontState; qx: number } | null {
  const p = placementOf(layout, bookId);
  const box = boxOf(layout, books, bookId);
  if (!p || !box || p.pose !== 'front' || p.stackId) return null;
  const state = { depth: box.z, pitch: box.pitch ?? 0, spin: box.spin ?? 0 };
  return { state, qx: box.x - frontExt(books[bookId], state).x0 };
}

// 이 책 자리(pos)는 그대로 두고, 부딪히는 왼쪽 책은 왼쪽으로·오른쪽 책은 오른쪽으로 필요한 만큼만 민다(돌리면 모서리가 양옆으로 나온다).
// 서로 기댄 쌍은 함께 움직인다(받침이 비켜도 기댄 책이 따라간다). 기준 자리는 base(돌리기 전) 그대로라, 다시 좁아지면 옆 책도 제자리로 돌아온다.
// 선반 끝을 넘으면 null
function spreadAround(base: ShelfLayout, placed: ShelfLayout, books: BookMap, shelfId: string, bookId: string, pos: number): ShelfLayout | null {
  const items = shelfItems(placed, shelfId);
  const m = items.findIndex((it) => it.bookIds.includes(bookId));
  if (m < 0) return null;
  const packed = packedPositions(items, placed, books);
  const was = itemXs(base, books, shelfId);
  const n = items.length;
  const base0 = items.map((it, i) => (i === m ? pos : was.get(it.key) ?? packed[i].x));
  const leansOn = (a: ShelfItem, b: ShelfItem) => !a.stacked && b.bookIds.includes(placementOf(placed, a.bookIds[0])?.lean?.on ?? '');
  const link = items.map((it, i) => i + 1 < n && i !== m && i + 1 !== m && (leansOn(it, items[i + 1]) || leansOn(items[i + 1], it)));
  const xs = [...base0];
  for (let round = 0; round < 3; round++) {
    for (let j = m - 1; j >= 0; j--) {
      let v = xs[j];
      for (let k = j + 1; k <= m; k++) if (packed[k].sep[j] > -Infinity) v = Math.min(v, xs[k] - packed[k].sep[j]);
      if (link[j] && j + 1 < m) v = Math.min(v, xs[j + 1] - (base0[j + 1] - base0[j]));
      xs[j] = v;
    }
    for (let j = 0; j < m - 1; j++) if (link[j]) xs[j + 1] = Math.min(xs[j + 1], xs[j] + (base0[j + 1] - base0[j]));
    for (let i = m + 1; i < n; i++) {
      let v = xs[i];
      for (let j = m; j < i; j++) if (packed[i].sep[j] > -Infinity) v = Math.max(v, xs[j] + packed[i].sep[j]);
      if (link[i - 1] && i - 1 > m) v = Math.max(v, xs[i - 1] + (base0[i] - base0[i - 1]));
      xs[i] = v;
    }
    for (let i = n - 1; i > m + 1; i--) if (link[i - 1]) xs[i - 1] = Math.max(xs[i - 1], xs[i] - (base0[i] - base0[i - 1]));
  }
  const { lo, hi } = bounds(items, placed);
  for (let i = 0; i < n; i++) {
    if (xs[i] < lo - 0.01 || xs[i] + packed[i].width > hi + 0.01) return null;
    for (let j = 0; j < i; j++) if (packed[i].sep[j] > -Infinity && xs[i] < xs[j] + packed[i].sep[j] - 0.01) return null;
  }
  return withItemXs(placed, shelfId, new Map(items.map((it, i) => [it.key, round2(xs[i])])));
}

// 이 자세로 놓을 때 저장하는 값: 반올림하고, 반올림한 각으로 머리가 벽을 뚫지 않게 바닥을 앞으로 맞춘다.
// pos = 상자 왼쪽 끝(배치가 보는 자리), e = 축 기준 상자 범위. 넘어질 곳을 3D로 찾을 때도 이 값으로 상자를 만들어, 찾은 자세가 그대로 놓인다.
function frontPose(book: Book, qx: number, st: FrontState) {
  const s = { depth: round2(st.depth), pitch: round2(st.pitch), spin: round2(st.spin) };
  const e = frontExt(book, s);
  s.depth = Math.min(s.depth, Math.floor((SHELF_DEPTH - e.z1) * 100) / 100);
  return { st: s, pos: round2(qx + e.x0), e };
}
type FrontPose = ReturnType<typeof frontPose>;

function withFront(placements: BookPlacement[], bookId: string, f: FrontPose): BookPlacement[] {
  return placements.map((q) =>
    q.bookId === bookId ? { ...q, depth: f.st.depth, pitch: f.st.pitch || undefined, spin: f.st.spin || undefined, wallLean: undefined, pos: f.pos } : q,
  );
}

// 이 줄 책들의 지금 자리(책 → 항목 왼쪽 끝)
function rowXs(layout: ShelfLayout, books: BookMap, shelfId: string) {
  const xs = new Map<string, number>();
  for (const pos of itemPositions(shelfItems(layout, shelfId), layout, books)) for (const id of pos.item.bookIds) xs.set(id, pos.x);
  return xs;
}

// 다른 책은 밀지 않고 놓는다: 옮긴 책은 pos, 나머지는 지금 자리 그대로여야 한다(배치가 하나라도 밀면 null).
// order: 이 줄 항목 순서를 바꿔 놓아 볼 때(reorderFront)
function settleFront(layout: ShelfLayout, books: BookMap, bookId: string, f: FrontPose, order?: ShelfItem[]): ShelfLayout | null {
  const shelfId = placementOf(layout, bookId)!.shelfId;
  const placements = withFront(order ? withOrders(layout, shelfId, order) : layout.placements, bookId, f);
  const xa = rowXs(layout, books, shelfId);
  const next = settle({ ...layout, placements }, books, new Map(xa).set(bookId, f.pos), shelfId);
  if (checkSpace(next, books, shelfId)) return null;
  for (const [id, x] of rowXs(next, books, shelfId)) if (Math.abs(x - (id === bookId ? f.pos : xa.get(id) ?? 0)) > 0.05) return null;
  return next;
}

// 이 자세로 놓는다: 돌리기 축(qx)은 그대로, 다른 책은 밀지 않는다. 안 되면 null.
// push: 넓어진 만큼 옆 책을 양옆으로 비킨다(좌우 돌리기만: 2026-10-10 사용자 '표지 상태 돌리기는 자유로워야',
// 붙어 선 책 사이에서는 옆 책을 밀어야 돌 수 있다. 돌린 모서리는 16° 안팎에서 양옆으로 가장 많이 나온다). 넘어지는 책은 받침을 밀지 않고 거기서 멈춘다.
export function applyFront(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, st: FrontState, push = false): ShelfLayout | null {
  const f = frontPose(books[bookId], qx, st);
  if (!push) return settleFront(layout, books, bookId, f);
  const shelfId = placementOf(layout, bookId)!.shelfId;
  const spread = spreadAround(layout, { ...layout, placements: withFront(layout.placements, bookId, f) }, books, shelfId, bookId, f.pos);
  return spread && !checkSpace(spread, books, shelfId) ? spread : null;
}

// from → to 사이에서 되는 곳까지(막히면 그 직전, 큰 점프 없이)
function reach(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, at: (k: number) => FrontState, push = false) {
  const r = farthest((k) => applyFront(layout, books, bookId, qx, at(k), push));
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
  return reach(layout, books, bookId, qx, (k) => spinStep(dims, cur, cur.spin + (want - cur.spin) * k, SHELF_DEPTH, MAX_FRONT_SPIN, -SHELF_FRONT), true);
}

// ---------- 손을 놓았을 때: 넘어질 곳은 3D 상자로 찾고, 멈춘 자세만 놓는다 ----------
// 넘어지는 동안의 자세는 저장하지 않으므로 하나하나 배치(settle)로 놓아 볼 필요가 없다: 이 줄 다른 책들의 지금 상자에 회전한 상자가
// 파고드는지(book3 gap)와 줄 좌우 끝·선반 앞 끝만 보고(frontHit), 멈춘 자세를 한 번 놓는다(placeFront).
// 배치(packing)는 앞 항목부터 x로 훑어 겹칠 수 있는 자리를 모두 피하므로(minSeparation), 돌린 책이 뒤에 놓인 책 쪽으로 비껴 넘어지면
// 실제 상자는 떨어져 있어도 옆 책을 밀어야 한다고 본다. 예전에는 걸음마다 applyFront로 놓아 보아(1°마다 settle) 느렸고, 그런 자세를
// 막힌 것으로 보아 받침 없이 공중에서 멈췄다.

const FALL_BISECT = 8; // 1° 걸음 사이를 이분하는 횟수(1/256°: 저장하는 젖힘 0.01°보다 잘게)

type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
function box3(cs: { x: number; y: number; z: number }[]): Box3 {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const c of cs) {
    b.x0 = Math.min(b.x0, c.x);
    b.x1 = Math.max(b.x1, c.x);
    b.y0 = Math.min(b.y0, c.y);
    b.y1 = Math.max(b.y1, c.y);
    b.z0 = Math.min(b.z0, c.z);
    b.z1 = Math.max(b.z1, c.z);
  }
  return b;
}
// 축 정렬 범위가 떨어져 있으면 두 상자도 떨어져 있다(gap > 0): gap을 계산하지 않고 넘긴다
const apart = (a: Box3, b: Box3) => a.x0 > b.x1 || b.x0 > a.x1 || a.y0 > b.y1 || b.y0 > a.y1 || a.z0 > b.z1 || b.z0 > a.z1;

// 이 선반의 다른 상자들(3D, 지금 자리)
function shelfBodies(layout: ShelfLayout, books: BookMap, shelfId: string, except: string): Book3[] {
  const out: Book3[] = [];
  for (const pos of itemPositions(shelfItems(layout, shelfId), layout, books))
    for (const box of itemBoxes(pos.item, layout, books, pos.x)) if (box.bookId !== except) out.push(fromPlaced(box));
  return out;
}

// 넘어지는 책 주변: 이 줄 다른 책들의 지금 상자(꼭짓점·축 정렬 범위)와 줄 좌우 끝. limit0: 손을 놓은 자세에서 맞닿아 있던 상자(startLimits)
type Body = { b: Book3; cs: { x: number; y: number; z: number }[]; box: Box3 };
type FrontWorld = {
  book: Book;
  bookId: string;
  dims: { T: number; H: number; W: number };
  qx: number;
  row: { lo: number; hi: number };
  bodies: Body[];
  limit0: Map<Book3, number>;
};
function frontWorld(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, cur: FrontState): FrontWorld {
  const shelfId = placementOf(layout, bookId)!.shelfId;
  const bodies = shelfBodies(layout, books, shelfId, bookId).map((b) => {
    const cs = corners(b);
    return { b, cs, box: box3(cs) };
  });
  const w = { book: books[bookId], bookId, dims: frontDims(books[bookId]), qx, row: bounds(shelfItems(layout, shelfId), layout), bodies, limit0: new Map() };
  w.limit0 = startLimits(w, frontPose(w.book, qx, cur));
  return w;
}

// 옆에 붙어 선 책: 이 책 폭 띠(돌리기 축 qx·바닥 가운데 깊이 depth + T/2 둘레로 되돌린 틀에서 |x| ≤ W/2, frontSupport2와 같은 틀)에
// SIDE_TOUCH 이하로만 걸친 상자. 젖힘은 이 책을 그 틀의 x축 둘레로 돌릴 뿐이라 옆면은 제 평면에 머문다: 그런 책은 옆면을 스칠 뿐
// 막지도 받치지도 않는다(배치가 TOUCH까지 붙여 두고, 젖힐 때마다 반올림되는 자리 pos로 상자가 x로 0.005까지 흔들린다).
const SIDE_TOUCH = 2 * TOUCH;
function beside(w: FrontWorld, qx: number, depth: number, spin: number, o: Body) {
  const r = (spin * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const qz = depth + w.dims.T / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of o.cs) {
    const x = (p.x - qx) * c + (p.z - qz) * sn;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return Math.min(hi, w.dims.W / 2) - Math.max(lo, -w.dims.W / 2) <= SIDE_TOUCH;
}

// 막은 것: 책 상자 / 줄 좌우 끝(옆판, 'side') / 선반 앞 끝('front') / 없음
type Hit = Book3 | 'side' | 'front' | null;

// 넘어지는 동안 볼 상자: 놓을 자세 값(반올림한 깊이·각)이되 돌리기 축은 반올림 전 qx. 놓을 때 자리(pos)는 0.01로 반올림되어 각마다
// 상자가 x로 0.005까지 흔들리는데, 그 흔들림으로 붙어 선 책에 걸리지 않게 한다(놓인 상자가 그만큼 더 파고들면 배치가 그만큼만
// 되밀고, settleFront는 0.05까지를 제자리로 본다)
function frontBox(w: FrontWorld, f: FrontPose) {
  return frontBook3(w.bookId, w.dims, w.qx, f.st.depth, f.st.pitch, f.st.spin);
}

// 이 자세(frontPose 값)를 막는 것: 이 줄 책 상자에 TOUCH보다 깊이 파고들거나(배치와 같은 기준, 여럿이면 가장 깊은 것. 옆에 붙어
// 선 책은 빼고), 줄 좌우 끝·선반 앞 끝을 넘는다(checkSpace와 같은 기준: 상자 폭과 바닥 모서리). limit: 상자별로 이보다 더 파고들어야
// 막힌 것(넘어지기 시작할 때 이미 붙어 있던 책). front = false면 선반 앞 끝은 보지 않는다(앞으로 튀어나오게 눕혀 볼 때).
function frontHit(w: FrontWorld, f: FrontPose, limit?: Map<Book3, number>, front = true): Hit {
  const box = frontBox(w, f);
  const cs = corners(box);
  const bb = box3(cs);
  let hit: Book3 | null = null;
  let least = Infinity;
  for (const o of w.bodies) {
    if (apart(bb, o.box) || beside(w, w.qx, f.st.depth, f.st.spin, o)) continue;
    const g = gap(box, o.b);
    if (g < (limit?.get(o.b) ?? -TOUCH) && g < least) {
      least = g;
      hit = o.b;
    }
  }
  if (hit) return hit;
  // 줄 끝을 조금 넘는 상자는 배치가 안으로 밀어 넣고(resolveXs), 그 밀림이 settleFront가 제자리로 보는 0.05 안이면 놓인다
  const { lo, hi } = w.row;
  if (f.pos < lo - 0.05 || f.pos + f.e.x1 - f.e.x0 > hi + 0.05) return 'side';
  for (const c of cs) {
    if (c.y >= bb.y0 + 0.01) continue;
    if (c.z > SHELF_DEPTH + 0.01) return 'side';
    if (front && c.z < -SHELF_FRONT - 0.01) return 'front';
  }
  return null;
}

// 시작 자세에서 이미 맞닿아 있던 상자: 배치는 TOUCH까지 붙여 두고 frontBox는 놓인 상자와 x로 0.005까지 어긋나므로, 그보다
// FALL_SLACK 넘게 더 파고들 때만 막는다
const FALL_SLACK = 0.006;
function startLimits(w: FrontWorld, f: FrontPose) {
  const box = frontBox(w, f);
  const bb = box3(corners(box));
  const out = new Map<Book3, number>();
  for (const o of w.bodies) {
    if (apart(bb, o.box)) continue;
    const g = gap(box, o.b);
    if (g < -TOUCH + FALL_SLACK) out.set(o.b, Math.min(g, -TOUCH) - FALL_SLACK);
  }
  return out;
}

type Fall = { pose: FrontPose; hit: Hit; free0: boolean };

// 바닥 축을 고정하고(머리가 벽에 닿으면 frontPose가 바닥을 앞으로 맞춘다: 벽을 타고 내려온다) from.pitch → target으로 넘어질 때
// 처음 막히는 곳: 1° 걸음, 막히면 그 사이를 이분. pose = 막히기 직전 자세(놓을 값), hit = 막은 것(null이면 target까지 갔다),
// free0 = 시작 자세가 비어 있었는지(아니면 pose는 시작 자세).
function fall3(w: FrontWorld, from: FrontState, target: number): Fall {
  const at = (pitch: number) => frontPose(w.book, w.qx, { ...from, pitch });
  const start = at(from.pitch);
  const limit = startLimits(w, start);
  const first = frontHit(w, start, limit);
  if (first) return { pose: start, hit: first, free0: false };
  const count = Math.ceil(Math.abs(target - from.pitch));
  let prev = from.pitch;
  let last = start;
  for (let i = 1; i <= count; i++) {
    const pitch = from.pitch + ((target - from.pitch) * i) / count;
    const f = at(pitch);
    let hit = frontHit(w, f, limit);
    if (!hit) {
      prev = pitch;
      last = f;
      continue;
    }
    let lo = prev;
    let hi = pitch;
    for (let k = 0; k < FALL_BISECT; k++) {
      const mid = (lo + hi) / 2;
      const g = at(mid);
      const h = frontHit(w, g, limit);
      if (h) {
        hi = mid;
        hit = h;
      } else {
        lo = mid;
        last = g;
      }
    }
    return { pose: last, hit, free0: true };
  }
  return { pose: last, hit: null, free0: true };
}

// 볼록 다각형 넓이(받침 외곽이 폭 경계에 면으로만 닿아 선이 되었는지)
function areaOf(poly: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// 손을 놓은 책이 머무는 곳: 자세(놓을 값) / 선반에서 떨어져 서랍 / 처음 바닥 자리에서 다시 선다
type FrontRest = { kind: 'pose'; st: FrontState } | { kind: 'drawer' } | { kind: 'stand' };
const restPose = (f: FrontPose): FrontRest => ({ kind: 'pose', st: f.st });

// 넘어져 멈춘 곳(fall3)에서: 막은 것이 없으면(벽에 기대거나 눕는다: releasedPitch) 거기, 받침에 기대 버티면 거기,
// 받침을 밀지 않으면(tip) 다시 서고, 바닥 마찰이 못 버티면 'slip'(바닥이 앞으로 미끄러진다: slideRest).
// 벽을 타고 내려오던 바닥이 선반 앞 끝에 닿으면 더 넘어진다(edgeRest). 젖힘 평면의 2D 평형으로 볼 수 없는 곳은 거기 둔다:
// 줄 좌우 끝(옆판: 받치는 힘이 젖힘 평면 밖)과, 받침이 이 책 폭 경계에 면으로만 닿아 2D 외곽이 생기지 않는 경우(드묾).
function restAt(w: FrontWorld, fell: Fall): FrontRest | 'slip' {
  if (!fell.hit || fell.hit === 'side') return restPose(fell.pose);
  if (fell.hit === 'front') return edgeRest(w, fell.pose.st.spin);
  const s = fell.pose.st;
  const hull = frontSupport2(w.dims, s, fell.pose.pos - fell.pose.e.x0, fell.hit); // 놓인 배치에서 다시 볼 때와 같은 축(frontStateOf)
  if (hull.length < 3 || areaOf(hull) < 0.01) return restPose(fell.pose);
  const v = frontLean(w.dims, s, hull);
  if (v.ok) return restPose(fell.pose);
  return v.reason === 'tip' ? { kind: 'stand' } : 'slip';
}

// 바닥이 선반 앞 끝까지 미끄러져도 버티지 못하면 더 넘어진다: 바닥을 앞 끝에 두고 눕힐 자리(뒤표지가 아래)가 비어 있으면 거기 눕는다.
// 비어 있지 않으면(받침·벽에 걸린다) 받침에 걸치거나 판 앞으로 튀어나오게 누워야 하는데, 이 모델은 그런 자세를 놓을 수 없다
// (겹침 없이, 판 안에만). 받침·벽을 피하도록 앞으로 밀어 눕힌 자리의 무게중심이 판 앞 끝 밖이면 선반에서 떨어져 서랍으로 가고
// (받침을 잃은 세운 책과 같이: shelf-scene layFallen), 판 위면(걸쳐 버틸 자세) 처음 바닥 자리에서 다시 세운다.
function edgeRest(w: FrontWorld, spin: number): FrontRest {
  const at = (depth: number) => frontPose(w.book, w.qx, { depth, pitch: 90, spin });
  const flat = at(Math.ceil((-SHELF_FRONT - frontExt(w.book, { pitch: 90, spin }).z0) * 100) / 100);
  if (!frontHit(w, flat, w.limit0)) return restPose(flat);
  let blocked = flat.st.depth;
  let free: number | null = null;
  for (let d = blocked - 1; d > flat.st.depth - w.dims.H - w.dims.T - 2; d -= 1) {
    if (!frontHit(w, at(d), w.limit0, false)) {
      free = d;
      break;
    }
    blocked = d;
  }
  if (free === null) return { kind: 'stand' };
  let ok: number = free;
  for (let k = 0; k < 8; k++) {
    const mid = (ok + blocked) / 2;
    if (frontHit(w, at(mid), w.limit0, false)) blocked = mid;
    else ok = mid;
  }
  const f = at(ok);
  return f.st.depth + (f.e.z0 + f.e.z1) / 2 < -SHELF_FRONT ? { kind: 'drawer' } : { kind: 'stand' };
}

const SLIDE_STEP = 0.5; // 바닥이 미끄러질 때 멈출 자리를 찾는 걸음(DU)
const SLIDE_COARSE = 2; // 굵은 걸음: 멈출 만한 곳을 지나치면 직전 자리부터 SLIDE_STEP으로 다시 본다
const SLIDE_CHECKS = 24; // 3D로 넘어져 확인하는 횟수 한도(2D와 3D가 거듭 엇갈리는 드문 경우: 다시 세운다)

// 받침에 닿은 각이 바닥 마찰로 버티지 못할 때(slip): 머리는 받침을 타고 내려가며 바닥(뒤쪽 아래 모서리)이 앞으로 미끄러진다.
// 바닥 자리를 앞으로 옮기며, 그 자리에서 넘어져 처음 닿는 곳이 버티거나(statics) 아무것에도 닿지 않고 눕는(90°)·벽에 기대는
// 첫 자리를 찾는다. 걸음마다의 판정은 젖힘 평면(2D, front-pose)으로 하고, 멈출 자리만 3D 상자로 넘어져 확인한다(fall3).
// 바닥 축이 선반 앞 끝에 닿도록 버티지 못하면 더 넘어진다(edgeRest). 앞길이 막히면(바닥 앞에 다른 책) 그 책이 받쳐 마지막으로 확인한
// 자리에 둔다(2D 평형은 받침 하나만 본다: 앞의 책이 미는 힘은 넣지 않는 어림).
function slideRest(w: FrontWorld, from: FrontPose): FrontRest {
  const { dims, qx } = w;
  const s = from.st;
  // 2D로 볼 상자: 이 책과 가로 범위가 겹치는 것(넘어지는 동안의 범위)
  const a = xRange(frontBook3(w.bookId, dims, qx, s.depth, 0, s.spin));
  const b = xRange(frontBook3(w.bookId, dims, qx, s.depth, 90, s.spin));
  const lo = Math.min(a.lo, b.lo) - 0.5;
  const hi = Math.max(a.hi, b.hi) + 0.5;
  const near = w.bodies.filter((o) => o.box.x1 > lo && o.box.x0 < hi);
  // 바닥 축(돌린 모서리)의 가장 앞 z
  const r = (s.spin * Math.PI) / 180;
  const footFront = (depth: number) => depth + (dims.T / 2) * (1 + Math.cos(r)) - (dims.W / 2) * Math.abs(Math.sin(r));
  // 이 자리의 2D 받침 외곽(옆에 붙어 선 책은 빼고)
  const outlines = (s0: FrontState) => near.filter((o) => !beside(w, qx, s0.depth, s0.spin, o)).map((o) => ({ o, h: frontSupport2(dims, s0, qx, o.b) }));
  const penOf = (s0: FrontState, o: Body) => {
    const h = frontSupport2(dims, s0, qx, o.b);
    return penetration2(frontLeaner2(dims, s0).poly, h);
  };
  // 2D로 본 한 자리(from = 지금 자리에서 바닥만 앞으로): 선반 앞 끝 너머 / 앞길이 막힘(지금보다 더 파고든다: 폭 경계에서 비스듬히 닿은
  // 받침은 2D로 겹쳐 보인 채 함께 옮겨지므로 겹침이 늘 때만) / 넘어져 닿은 곳에서 또 미끄러짐 / 멈춤
  const probe = (from: FrontState, depth: number, pitch: number) => {
    const s0 = { depth, pitch, spin: s.spin };
    if (footFront(depth) < -SHELF_FRONT - 0.01) return { s0, kind: 'edge' as const, target: pitch, pitch };
    const out = outlines(s0);
    const hulls = out.map((q) => q.h);
    const poly = frontLeaner2(dims, s0).poly;
    const deeper = (q: (typeof out)[number]) => {
      const p = penetration2(poly, q.h);
      return p > 0.01 && p > penOf(from, q.o) + 0.01;
    };
    if (out.some(deeper)) return { s0, kind: 'blocked' as const, target: pitch, pitch };
    const target = releasedPitch(dims, s0, SHELF_DEPTH);
    const c = frontFall2(dims, s0, target, hulls);
    const slip = !!c && frontLean(dims, { ...s0, pitch: c.pitch }, hulls[c.index]).reason === 'slip';
    return { s0, kind: slip ? ('slip' as const) : ('stop' as const), target, pitch: c?.pitch ?? target };
  };
  let st: FrontState = s;
  let held = from; // 마지막으로 3D로 확인한(받침에 닿아 미끄러지는) 자세
  let step = SLIDE_COARSE;
  let checks = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const q = probe(st, st.depth - step, st.pitch);
    if (q.kind === 'slip') {
      st = { ...q.s0, pitch: q.pitch };
      continue;
    }
    if (step > SLIDE_STEP) {
      step = SLIDE_STEP;
      continue;
    }
    if (q.kind === 'edge') return edgeRest(w, s.spin);
    if (q.kind === 'blocked') return restPose(held);
    // 2D로는 여기서 멈춘다: 3D로 넘어져 확인
    if (++checks > SLIDE_CHECKS) return { kind: 'stand' };
    const fell = fall3(w, q.s0, q.target);
    if (!fell.free0) return restPose(held);
    const v = restAt(w, fell);
    if (v !== 'slip') return v;
    held = fell.pose;
    st = fell.pose.st;
    step = SLIDE_COARSE;
  }
  return { kind: 'stand' };
}

// 넘어져 멈춘 자세를 놓는다(옆 책 자리는 그대로): 지금 항목 순서로 안 되면 순서를 바꿔 본다(reorderFront)
function placeFront(layout: ShelfLayout, books: BookMap, bookId: string, qx: number, st: FrontState): ShelfLayout | null {
  const f = frontPose(books[bookId], qx, st);
  return settleFront(layout, books, bookId, f) ?? reorderFront(layout, books, bookId, f);
}

// 배치가 x로 훑어 옆 책을 미는 것은 항목 순서상 그 책이 반대쪽(뒤 항목인데 왼쪽, 앞 항목인데 오른쪽)에 있을 때다: 순서에서 이 책 자리만
// 바꿔(가운데가 놓이는 순서, 가로 범위가 겹치는 항목의 앞·뒤. 가운데 순서에 가까운 것부터) 옆 책이 모두 제자리인 순서가 있으면 그것으로 놓는다.
// 깊이가 떨어진 항목끼리는 순서가 배치에 영향을 주지 않는다(packedPositions).
function reorderFront(layout: ShelfLayout, books: BookMap, bookId: string, f: FrontPose): ShelfLayout | null {
  const shelfId = placementOf(layout, bookId)!.shelfId;
  const pos = itemPositions(shelfItems(layout, shelfId), layout, books);
  const m = pos.findIndex((q) => q.item.bookIds.includes(bookId));
  const others = pos.filter((_, i) => i !== m);
  const lo = f.pos;
  const hi = f.pos + f.e.x1 - f.e.x0;
  const mid = insertIndex(others, (lo + hi) / 2);
  const cands = [mid];
  others.forEach((q, j) => {
    if (q.x < hi && q.x + q.width > lo) cands.push(j, j + 1);
  });
  const tried = new Set([m]);
  for (const i of cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))) {
    if (tried.has(i)) continue;
    tried.add(i);
    const order = others.map((q) => q.item);
    order.splice(i, 0, pos[m].item);
    const r = settleFront(layout, books, bookId, f, order);
    if (r) return r;
  }
  return null;
}

function releaseRest(w: FrontWorld, cur: FrontState, target: number): FrontRest {
  const fell = fall3(w, cur, target);
  if (target < cur.pitch) return restPose(fell.pose); // 다시 선다(앞에 닿으면 거기)
  const v = restAt(w, fell);
  return v === 'slip' ? slideRest(w, fell.pose) : v;
}

// 손을 놓으면 무게중심 방향으로 넘어지며 바닥 축을 고정한다(releasedPitch: 다시 서기·벽에 기대기·눕기). 가는 길에 책(받침)에 막히면
// 거기 기대 버티는지 젖힘 평면의 힘 평형(statics.ts)으로 본다: 버티면 그 각, 받침을 밀지 않으면(tip) 다시 서고,
// 바닥 마찰이 못 버티면(slip) 바닥이 앞으로 미끄러진 자리(slideRest). 바닥이 선반 앞 끝까지 가도 버티지 못하면 더 넘어져
// 앞 끝에 눕거나 선반에서 떨어진다(edgeRest: 서랍). 공중이나 버티지 못하는 각에는 두지 않는다: 찾은 자세를 놓을 수 없으면
// (항목 순서를 바꿔도 배치가 옆 책을 밀어야 한다고 보는 드문 경우: 눕힌 책 바로 뒤 순서는 그 책 끝을 비워 둔다 등) 처음 바닥 자리에서
// 다시 세우고, 그것도 안 되면 null. 다시 설 때 돌린 책의 앞 모서리가 선반 앞 끝을 넘으면(젖힌 채 돌린 책) 넘지 않는 데(0°에 조금
// 못 미쳐)에서 선다. 2D 평형의 어림(front-pose): 받침이 이 책 폭 경계에서 비스듬히 닿으면(돌린 모서리) 받치는 힘을 2D로 잘못 볼 수
// 있다(tip이 나오면 다시 서다 그 받침에 막힌 데 머문다).
export function frontRelease(layout: ShelfLayout, books: BookMap, bookId: string, cur: FrontState, qx: number): ShelfLayout | null {
  const dims = frontDims(books[bookId]);
  const target = releasedPitch(dims, cur, SHELF_DEPTH);
  if (Math.abs(target - cur.pitch) < 0.01) return applyFront(layout, books, bookId, qx, cur);
  const w = frontWorld(layout, books, bookId, qx, cur);
  const rest = releaseRest(w, cur, target);
  if (rest.kind === 'drawer') {
    const r = moveToDrawer(layout, bookId, books);
    if (r.ok) return r.layout;
  } else if (rest.kind === 'pose') {
    const placed = placeFront(layout, books, bookId, qx, rest.st);
    if (placed) return placed;
  }
  return placeFront(layout, books, bookId, qx, fall3(w, cur, 0).pose.st);
}

// 앞뒤 막대(보조): 바닥 자리를 옮긴다. 서 있는 책은 그대로 서서 옮겨진다(벽 가까이 가도 저절로 기대지 않는다: 2026-10-10 사용자
// '앞뒤로 왔다 갔다 하는데 왜 갑자기 벽에 붙냐'). 기댄 책은 머리가 벽에 닿는 각으로 따라가고(회전한 상자로 계산),
// 당기면 벽을 따라 더 넘어간다. 그 각이 버티지 못하면(statics.ts) 밀어 넣을 때는 다시 서고, 당길 때는 바닥이 미끄러져 눕는다.
function setFrontDepth(layout: ShelfLayout, books: BookMap, bookId: string, z: number, prevLean?: boolean): Result {
  const f = frontStateOf(layout, books, bookId)!;
  const dims = frontDims(books[bookId]);
  const range = depthRange(layout, books, bookId);
  const target = Math.max(range.lo, Math.min(range.hi, z));
  if (Math.abs(target - f.state.depth) < 0.01) return { ok: false, reason: 'no-change' };
  const was = prevLean ?? f.state.pitch > 0;
  const at = (k: number): FrontState => {
    const depth = f.state.depth + (target - f.state.depth) * k;
    const need = pitchForWall(dims, depth, f.state.spin, SHELF_DEPTH, 90);
    const pitch = f.state.pitch >= 89.95 ? 90 : was ? wallLeanRest(dims.T, dims.H, need ?? 90) : 0;
    return { depth, pitch, spin: f.state.spin };
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
  if (side === 0) return setTilt(layout, books, bookId, tiltToward(dir));
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
    // 기대는 쪽 옆 책과의 틈을 버틸 수 있는 각(넘어짐 한계 + 여유)에 맞춘다: 모자라면 벌리고(빈 공간을 쓰거나 옆 책을 민다),
    // 넓으면 좁힌다(메뉴 한도 LEAN_MENU_MAX보다 크게 기울지 않게). 두꺼워서 한도 안에서 기댈 수 없는 책은 거절한다.
    const want = leanTarget(books[bookId]);
    if (want === null) return { ok: false, reason: 'cannot-lean' };
    const items = shelfItems(next, p.shelfId);
    const i = items.findIndex((it) => it.bookIds.includes(bookId));
    const dir = tilt < 0 ? -1 : 1;
    const nb = items[i + dir];
    if (nb) {
      const pos = itemPositions(items, next, books);
      const [l, r] = dir < 0 ? [i - 1, i] : [i, i + 1];
      const s = leanSpacing(items, next, books, i, dir, want);
      const have = pos[r].x - pos[l].x;
      if (s !== null && Math.abs(s - have) > 0.05) {
        // 틈 오른쪽 항목들을 함께 옮긴다(그 너머 책들 사이 틈, 특히 다른 기댄 책의 틈은 그대로 둔다).
        // 선반 끝에 걸리면 settle이 오른쪽 끝부터 되민다.
        for (let k = r; k < items.length; k++) for (const id of items[k].bookIds) desired.set(id, desired.get(id)! + (s - have));
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

// 드래그 중 삽입 자리 판정. centerX는 선반 판 안쪽 기준 설계 단위(끄는 항목 3D 상자의 가운데), draggedWidth는 그 상자의 폭(DU).
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
  // 그 자리(끄는 책의 3D 상자 가운데 기준, 같은 선반과 같은 0.5DU 단위)에 놓고, 부딪히는 옆 책은 pushOneSide가 한쪽으로 비킨다
  const index = insertIndex(positions, centerX);
  return { kind: 'insert', shelfId, index, x: Math.round((centerX - draggedWidth / 2) * 2) / 2 };
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
  | { kind: 'place'; x: number; index: number } // 그 자리에 놓기(x: 책 왼쪽 끝, index: 끼울 순서). 제자리에서 조금 옮기는 것도 이것
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
  // 놓을 자리: 끈 만큼 그대로(0.5DU 단위, 아주 조금 옮긴 것도 그 위치로). 순서는 나를 뺀 항목들 기준
  const w = upper ? box.size.w : mine.width;
  const place = (): SwapTarget => {
    const x = Math.round((lo + (centerX - cur)) * 2) / 2;
    const others = positions.filter((q) => q !== mine);
    return { kind: 'place', x, index: insertIndex(others, x + w / 2) };
  };
  // 자기 자리(가로 범위) 위에 있는 동안은 자기 자리가 먼저다: 앞뒤로 겹쳐 선 누운 책 위라도 잡자마자 쌓이지 않는다
  if (centerX >= mine.x && centerX <= mine.x + mine.width) {
    // 제자리 위: 끈 만큼 그대로 옮긴다(위 책은 아래 책 위에서만)
    if (Math.abs(centerX - cur) < 0.25) return { kind: 'self' };
    if (upper) return { kind: 'shift', dx: Math.round((centerX - cur) * 2) / 2 };
    return place();
  }
  for (const pos of positions) {
    if (pos === mine || centerX < pos.x || centerX > pos.x + pos.width) continue;
    const middle = centerX >= pos.x + pos.width * 0.25 && centerX <= pos.x + pos.width * 0.75;
    if (!base && middle && isHorizontalItem(pos.item, layout)) return { kind: 'stack', itemKey: pos.item.key };
    break; // 다른 책 위: 그 자리에 끼워 넣고 옆 책들을 민다(자리 바꾸기 대신). 깊이가 떨어져 있으면 겹쳐 놓인다
  }
  // 빈 곳·다른 책 위: 끄는 책이 지금 자리에서 옮겨 간 만큼(더미째 옮기면 더미 왼쪽 끝 기준)
  return place();
}

export function applySwapTarget(layout: ShelfLayout, books: BookMap, bookId: string, t: SwapTarget): Result {
  const p = placementOf(layout, bookId);
  if (!p) return { ok: false, reason: 'unknown-book' };
  if (t.kind === 'self') return { ok: false, reason: 'no-change' };
  if (t.kind === 'shift') return shiftOnStack(layout, books, bookId, t.dx);
  if (t.kind === 'stack') return moveBook(layout, books, bookId, { kind: 'stack', shelfId: p.shelfId, itemKey: t.itemKey });
  if (t.kind === 'place') return moveBook(layout, books, bookId, { kind: 'insert', shelfId: p.shelfId, index: t.index, x: t.x });
  return swapWith(layout, books, bookId, t.itemKey);
}
