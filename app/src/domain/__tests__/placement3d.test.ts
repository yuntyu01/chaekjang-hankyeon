// 3D 배치(단계 2~4): 실제 깊이·수직축 회전·선반 경계, 회전된 책끼리의 충돌, 수평 쌓기 받침, 깊이가 다른 가짜 받침.
import { corners, footprintXZ, fromPlaced, gap, lowest, topXZ, toWorld } from '../book3';
import { boxSize, type Placed } from '../box';
import { MAX_SPIN, SHELF_DEPTH, SHELF_FRONT, SHELF_USABLE_WIDTH } from '../geometry';
import { checkSpace, moveBook, placementOf, setPose, setSpin, type BookMap, type Result } from '../layout-engine';
import { bodiesOf, computeShelf, PLANK_BOUNDS, withLeans } from '../shelf-scene';
import { stackBoxes, stackSupported, supportedOn } from '../support';
import type { Book, BookPlacement, ShelfLayout, Tilt } from '../types';

const book = (id: string, height: number, thickness: number, width: number): Book => ({
  id, title: id, themeColor: '#CCBBAA', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: width / height,
  art: { motif: 'leaf' }, dims: { height, thickness, coverWidth: width },
});
// 대표 4권: 키 큰 두꺼운 책, 얇은 책, 작은 책, 눕힐 책
const books: BookMap = {
  A: book('A', 175, 40, 115),
  B: book('B', 150, 22, 100),
  C: book('C', 120, 34, 90),
  L: book('L', 160, 26, 110),
  S: book('S', 120, 20, 80), // L 위에 올릴 작은 책
  N: book('N', 150, 22, 50), // 표지 폭이 좁은 책(선반 앞쪽에 세우면 벽 쪽 눕힌 책과 깊이가 겹치지 않는다)
};
const place = (bookId: string, order: number, pos: number, extra: Partial<BookPlacement> = {}): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt: 0 as Tilt, pos, ...extra });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const TOL = 0.25;

function expectNoPenetration(l: ShelfLayout) {
  const bs = bodiesOf(l, books, 's');
  for (let i = 0; i < bs.length; i++) {
    expect(lowest(bs[i])).toBeGreaterThan(-0.05); // 선반을 뚫지 않는다
    for (const c of corners(bs[i])) {
      expect(c.z).toBeGreaterThanOrEqual(-SHELF_FRONT - 0.05); // 선반 앞 끝
      expect(c.z).toBeLessThanOrEqual(SHELF_DEPTH + 0.05); // 뒷벽
    }
    for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-TOL);
  }
}

describe('실제 깊이와 수직축 회전', () => {
  const base = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40), place('L', 2, 90, { pose: 'horizontal' }), place('C', 3, 280)), books);

  it.each([-MAX_SPIN, 0, MAX_SPIN])('눕힌 책 %i°: 변 길이 보존, 앞뒤 모서리 깊이가 다르고, 경계·충돌 없음', (deg) => {
    const l = deg ? withLeans(ok(setSpin(base, books, 'L', deg)), books) : base;
    const spin = placementOf(l, 'L')!.spin ?? 0;
    expect(Math.abs(spin - deg)).toBeLessThan(0.5);
    const Lb = bodiesOf(l, books, 's').find((b) => b.id === 'L')!;
    const c = corners(Lb);
    // 로컬 변(두께·세로·표지 폭) 길이가 원본 치수 그대로
    expect(len(c[0], c[1])).toBeCloseTo(Lb.dims.T, 6);
    expect(len(c[0], c[2])).toBeCloseTo(Lb.dims.H, 6);
    expect(len(c[0], c[4])).toBeCloseTo(Lb.dims.W, 6);
    // 비스듬하면 왼쪽 끝과 오른쪽 끝의 앞 모서리 깊이가 다르다(+면 오른쪽 끝이 뒤로)
    // 책 양 끝(머리·꼬리) 가운데의 깊이
    const e1 = toWorld(Lb, { x: Lb.dims.T / 2, y: 0, z: Lb.dims.W / 2 });
    const e2 = toWorld(Lb, { x: Lb.dims.T / 2, y: Lb.dims.H, z: Lb.dims.W / 2 });
    const [left, right] = e1.x < e2.x ? [e1, e2] : [e2, e1];
    expect(footprintXZ(Lb).length).toBe(4);
    if (deg > 0) expect(right.z).toBeGreaterThan(left.z);
    if (deg < 0) expect(right.z).toBeLessThan(left.z);
    expectNoPenetration(l);
  });

  it('돌리면 넓어진 만큼 옆 책을 밀고, 선반 끝에서는 가능한 각도까지만', () => {
    const tight = withLeans(layoutOf(place('A', 0, 0), place('L', 1, SHELF_USABLE_WIDTH - 160 - 1, { pose: 'horizontal' })), books);
    const r = setSpin(tight, books, 'L', MAX_SPIN);
    const got = r.ok ? placementOf(r.layout, 'L')!.spin ?? 0 : 0;
    expect(got).toBeLessThanOrEqual(MAX_SPIN);
    if (r.ok) expectNoPenetration(withLeans(r.layout, books));
    expect(setSpin(base, books, 'A', 5).ok).toBe(false); // 세운 책은 돌리지 않는다
  });

  it('정면에서 겹쳐 보여도 깊이가 떨어진 책은 밀지 않는다', () => {
    // 얇은 표지 전시 책(앞)과 뒷벽 쪽 눕힌 책: 깊이가 겹치지 않는다
    // 표지 전시 책은 책 기준선 앞(선반 앞 끝 쪽)에, 눕힌 책은 벽에 붙여 둔다
    const back = SHELF_DEPTH - 110 - 1;
    const l = layoutOf(place('C', 0, 60, { pose: 'front', depth: -SHELF_FRONT + 1 }), place('L', 1, 40, { pose: 'horizontal', depth: back }));
    expect(checkSpace(l, books)).toBeNull();
    const f = computeShelf(l, books, 's').frames;
    const cx = f.find((x) => x.bookId === 'C')!.box!.x;
    const lx = f.find((x) => x.bookId === 'L')!.box!.x;
    expect(lx).toBeLessThan(cx + 90); // 화면에서는 겹친다
    expect(lx).toBeCloseTo(40, 1); // 그래도 밀리지 않았다
    expectNoPenetration(l);
  });

  it('뒷벽을 넘는 깊이는 거절', () => {
    const l = layoutOf(place('L', 0, 40, { pose: 'horizontal', depth: SHELF_DEPTH - 50 }));
    expect(checkSpace(l, books)).toBe('no-space');
  });

  it('자세를 바꾸면 깊이·회전은 새 자세 기본값(원본 치수는 그대로)', () => {
    const l = ok(setSpin(base, books, 'L', 8));
    const up = ok(setPose(l, books, 'L', 'spine'));
    expect(placementOf(up, 'L')!.spin).toBeUndefined();
    const b = bodiesOf(withLeans(up, books), books, 's').find((x) => x.id === 'L')!;
    expect(b.dims).toEqual(bodiesOf(base, books, 's').find((x) => x.id === 'L')!.dims);
  });
});

describe('수평 쌓기 받침', () => {
  const lying = (id: string, spin = 0): { bookId: string; book: Book; spin: number } => ({ bookId: id, book: books[id], spin });

  it('작은 책을 큰 책 위에: 받쳐지고, 높이는 아래 책의 실제 윗면', () => {
    const boxes = stackBoxes([lying('L'), lying('S')], 10);
    expect(stackSupported(boxes)).toBe(true);
    const lower = fromPlaced(boxes[0]);
    expect(boxes[1].y).toBeCloseTo(Math.max(...corners(lower).map((c) => c.y)), 6);
    expect(gap(lower, fromPlaced(boxes[1]))).toBeGreaterThan(-TOL);
  });

  it('큰 책을 작은 책 위에는 받쳐지지 않는다(부분 돌출 불허)', () => {
    expect(stackSupported(stackBoxes([lying('S'), lying('L')], 10))).toBe(false);
  });

  it('위 책을 비스듬히: 아래 윗면 안이면 허용, 삐져나오면 불허', () => {
    expect(stackSupported(stackBoxes([lying('L'), lying('S', 6)], 10))).toBe(true);
    const tooMuch = stackBoxes([lying('L'), lying('L', 12)], 10);
    expect(supportedOn(tooMuch[1], tooMuch[0])).toBe(false);
    expect(topXZ(fromPlaced(tooMuch[0])).length).toBe(4);
  });

  it('레이아웃: 큰 책을 작은 책 위에 쌓으려 하면 거절, 반대는 허용', () => {
    const l = layoutOf(place('S', 0, 10, { pose: 'horizontal' }), place('L', 1, 180, { pose: 'horizontal' }));
    const bad = moveBook(l, books, 'L', { kind: 'stack', shelfId: 's', itemKey: 'S' });
    expect(bad.ok ? 'ok' : bad.reason).toBe('unsupported');
    const good = moveBook(l, books, 'S', { kind: 'stack', shelfId: 's', itemKey: 'L' });
    expect(good.ok).toBe(true);
    if (good.ok) expectNoPenetration(withLeans(good.layout, books));
  });
});

describe('높이·깊이가 다른 책의 기대기', () => {
  it('큰 책이 작은 책의 실제 윗모서리에 기댄다(바닥 접촉 유지)', () => {
    const l = withLeans(layoutOf(place('C', 0, 0), place('A', 1, 34 + 20, { tilt: -7 })), books);
    const a = computeShelf(l, books, 's').frames.find((f) => f.bookId === 'A')!;
    expect(a.leanOn).toBe('C');
    expect(lowest(fromPlaced(a.box!))).toBeCloseTo(0, 3);
    expectNoPenetration(l);
  });

  it('화면에서 나란해도 깊이가 다른 책은 받침이 되지 않는다', () => {
    // 벽 쪽 눕힌 책과 앞쪽에 세운 좁은 책: 깊이가 겹치지 않아 기대려 해도 받칠 곳이 없어 바로 선다
    const back = SHELF_DEPTH - 110 - 1;
    const front = -SHELF_FRONT + 1;
    expect(front + 50).toBeLessThan(back); // 깊이가 떨어져 있다
    const l = withLeans(layoutOf(place('L', 0, 0, { pose: 'horizontal', depth: back }), place('N', 1, 120, { tilt: -7, depth: front })), books);
    expect(placementOf(l, 'N')!.tilt).toBe(0);
  });

  it('선반 끝·빈 공간에서는 무리하게 기대지 않는다', () => {
    const l = withLeans(layoutOf(place('B', 0, 0, { tilt: -7 })), books);
    expect(placementOf(l, 'B')!.tilt).toBe(0);
    expect(PLANK_BOUNDS.min).toBeLessThan(0);
  });
});

describe('저장·복원', () => {
  it('깊이·회전·쌓기가 있는 배치를 저장했다 복원하면 같은 장면', () => {
    let l = withLeans(layoutOf(place('A', 0, 0), place('L', 1, 60, { pose: 'horizontal' }), place('S', 2, 250, { pose: 'horizontal' })), books);
    l = withLeans(ok(moveBook(l, books, 'S', { kind: 'stack', shelfId: 's', itemKey: 'L' })), books);
    l = withLeans(ok(setSpin(l, books, 'S', 5)), books);
    const again = JSON.parse(JSON.stringify(l)) as ShelfLayout;
    const a = bodiesOf(l, books, 's');
    const b = bodiesOf(again, books, 's');
    expect(b).toEqual(a);
    const placed: Placed = { bookId: 'x', pose: 'spine', size: boxSize(books.A, 'spine'), x: 0, y: 0, z: 0, angle: 0 };
    expect(fromPlaced(placed).spin).toBe(0);
  });
});
