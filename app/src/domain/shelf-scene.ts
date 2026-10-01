// 선반 한 칸의 책 프레임 계산(순수). 프레임 = 선반 공간의 3D 상자(카메라와 무관). 그리기·터치·그림자는 이 상자를
// 매 프레임 같은 카메라로 투영해 쓴다(투영 결과를 여기 저장하지 않는다).
import { boxSize, collide, CONTACT, frontPoly, hull, solveLean, type Placed } from './box';
import { corners, fromPlaced, type Book3 } from './book3';
import { project, type Cam, type Point } from './camera';
import { SHELF_X0, SHELF_X1 } from './geometry';
import { itemBoxes, itemPositions, placementOf, shelfItems, type BookMap } from './layout-engine';
import { firstContact, MAX_LEAN } from './lean';
import type { Book, Pose, ShelfLayout, Tilt } from './types';

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

// 기대는 책들의 각도(선반 공간). 저장된 결과(각도·상대)가 아직 맞으면 그대로 쓰고(사용자가 꾸민 모습 유지),
// 상대가 바뀌었거나 더 이상 닿지 않거나 파고들면 옆 상자에 처음 닿는 각도를 다시 구한다(0.5도 탐색 + 이분 탐색).
// 깊이 구간이 겹치는 상자만 장애물이다(뒤에 놓인 눕힌 책은 화면에서 겹쳐도 닿지 않는다).
// 순서: 오른쪽으로 기대는 책은 오른쪽 이웃부터, 왼쪽으로 기대는 책은 왼쪽부터. 연쇄를 위해 몇 번 반복한다.
function solveLeans(frames: BookFrame[], layout: ShelfLayout) {
  const leaners = frames.filter((f) => f.pose === 'spine' && f.tilt !== 0);
  if (!leaners.length) return;
  const set = (f: BookFrame, angle: number, extra: Partial<BookFrame>) => {
    Object.assign(f, { box: { ...f.box, angle } }, extra);
  };
  const ordered = [...leaners].sort((a, b) => a.box!.x - b.box!.x);
  // 마주 보고 기대는 두 권은 같은 각도로 함께 기울여 처음 닿는 곳에서 멈춘다(한 권씩 풀면 먼저 푼 책이 빈틈을 다 차지한다).
  const paired = new Set<string>();
  const byLeft = [...frames].filter((f) => f.stackIndex === 0).sort((a, b) => a.box!.x - b.box!.x);
  for (let i = 0; i + 1 < byLeft.length; i++) {
    const a = byLeft[i];
    const b = byLeft[i + 1];
    if (!(a.pose === 'spine' && b.pose === 'spine' && a.tilt > 0 && b.tilt < 0)) continue;
    const c = firstContact((d) => collide({ ...a.box!, angle: d }, { ...b.box!, angle: -d }, CONTACT));
    if (!c.found || c.angle === 0) continue;
    set(a, c.angle, { leanFailed: false, leanOn: b.bookId });
    set(b, -c.angle, { leanFailed: false, leanOn: a.bookId });
    paired.add(a.bookId).add(b.bookId);
  }
  const passes = [ordered.filter((f) => f.tilt < 0), [...ordered].reverse().filter((f) => f.tilt > 0)].map((pass) =>
    pass.filter((f) => !paired.has(f.bookId)),
  );
  for (let iter = 0; iter < 3; iter++) {
    for (const pass of passes) {
      for (const f of pass) {
        const dir = Math.sign(f.tilt) as -1 | 1;
        const base = { ...f.box, angle: 0 };
        const others = frames.filter((o) => o !== f).map((o) => o.box!);
        const stored = placementOf(layout, f.bookId)?.lean;
        const partner = stored && others.find((o) => o.bookId === stored.on);
        if (stored && partner && Math.sign(stored.angle) === dir && Math.abs(stored.angle) <= MAX_LEAN) {
          const q = { ...base, angle: stored.angle };
          const touching = collide({ ...base, angle: stored.angle + dir * 0.6 }, partner, CONTACT);
          if (touching && !others.some((o) => collide(q, o)) && inside(frontPoly(q))) {
            set(f, stored.angle, { leanFailed: false, leanOn: stored.on });
            continue;
          }
        }
        const r = solveLean(base, dir, others, PLANK_BOUNDS);
        set(f, r.angle, { leanFailed: !r.supported, leanOn: r.on });
      }
    }
  }
}

// 확정할 때 기대기 결과를 저장한다. 기댈 곳이 없던 책은 놓은 자리에서 바로 선다(tilt 0).
// only: 그 선반의 기대기만 다시 푼다(나머지 선반은 그대로 둔다)
export function withLeans(layout: ShelfLayout, books: BookMap, only?: string): ShelfLayout {
  const result = new Map<string, BookFrame>();
  for (const shelf of layout.shelves) if (!only || shelf.id === only) for (const f of computeShelf(layout, books, shelf.id).frames) result.set(f.bookId, f);
  return {
    ...layout,
    placements: layout.placements.map((p) => {
      if (only && p.shelfId !== only) return p;
      const f = result.get(p.bookId);
      if (!f || p.pose !== 'spine' || p.tilt === 0) return p.lean ? { ...p, lean: undefined } : p;
      if (f.leanFailed) return { ...p, tilt: 0 as Tilt, lean: undefined };
      return { ...p, lean: f.leanOn ? { angle: Math.round(f.box.angle * 1000) / 1000, on: f.leanOn } : undefined };
    }),
  };
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
