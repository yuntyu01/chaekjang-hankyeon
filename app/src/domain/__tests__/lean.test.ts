// 기대기: 먼저 "똑바로 선 책 + 기대는 책 한 권", 그다음 연쇄·마주 기대기, 마지막으로 높이·두께가 다른 세 권의 이동·저장·복원.
// 버틸 수 있는지(넘어짐·미끄러짐·받침)는 statics.ts 규칙: 각은 넘어짐 한계 atan(두께/키)를 넘어야 하고, 받침을 잃은 책은 더 넘어진다.
import { corners, fromPlaced, lowest } from '../book3';
import { bookHeight, bookThickness } from '../geometry';
import { bookXs, moveBook, normalize, setTilt, shelfItems, type BookMap } from '../layout-engine';
import { overlaps } from '../test-fixtures/overlap';
import { LEAN_MARGIN, LEAN_MENU_MAX, tipAngle } from '../statics';
import { computeShelf, frontOutline, withLeans, type BookFrame } from '../shelf-scene';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const rad = (d: number) => (d * Math.PI) / 180;

const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.7, // A는 표지 폭이 기준선 뒤 깊이보다 커서 기준선 앞으로 조금 나와 선다(크기는 그대로)
  art: { motif: 'leaf' },
  dims: { height, thickness },
});

// 높이·두께가 다른 세 권
const A = book('A', 180, 40); // 키 크고 두꺼움
const B = book('B', 150, 28); // 중간, 얇음
const C = book('C', 120, 34); // 작음
const books: BookMap = { A, B, C };

const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });
const layoutOf = (...placements: BookPlacement[]): ShelfLayout => ({ version: 2, shelves: [{ id: 's', order: 0 }], placements, drawer: [] });
const frameOf = (l: ShelfLayout, id: string) => computeShelf(l, books, 's').frames.find((f) => f.bookId === id)!;
const allFrames = (l: ShelfLayout) => computeShelf(l, books, 's').frames;
// 기운 정도(도, 방향 무시): 0이면 똑바로 선다(왼쪽으로 기대려다 선 책은 -0일 수 있다)
const leanOf = (f: BookFrame) => Math.abs(f.box.angle);

function expectSeated(f: BookFrame) {
  // 3D에서: 가장 낮은 점이 선반 윗면(y=0)에 닿고, 기울었으면 축 모서리(발)가 윗면에 있다.
  // (앞으로 나온 책은 화면에서 조금 아래에 보이므로 화면 바닥선으로 재지 않는다)
  const b = fromPlaced(f.box);
  const cs = corners(b);
  expect(lowest(b)).toBeCloseTo(0, 6);
  if (f.box.angle) {
    const footX = f.box.angle > 0 ? f.box.x + f.box.size.w : f.box.x;
    expect(cs.some((c) => Math.abs(c.x - footX) < 1e-6 && Math.abs(c.y) < 1e-6)).toBe(true);
  }
}
function expectNoOverlap(frames: BookFrame[]) {
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) expect(overlaps(frontOutline(frames[i]), frontOutline(frames[j]), 0.2)).toBe(false);
}
function expectTouching(f: BookFrame, other: BookFrame) {
  // 같은 발(축 모서리)로 0.6도만 더 기울이면 옆 책 앞면에 파고든다 = 지금 닿아 있다
  const dir = Math.sign(f.box.angle);
  const more = frontOutline({ ...f, box: { ...f.box, angle: f.box.angle + dir * 0.6 } });
  expect(overlaps(more, frontOutline(other))).toBe(true);
}

describe('한 권이 똑바로 선 책에 기댄다', () => {
  it('더 큰 책에 기대면 윗모서리가 옆면에 닿는다: sin θ = 빈틈 / 키', () => {
    // A는 똑바로, B는 A 오른쪽에 빈틈 g를 두고 왼쪽으로 기댄다(약 11.5°: B의 넘어짐 한계 10.6°보다 크다)
    const g = 30;
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40 + g, -7));
    const b = frameOf(l, 'B');
    const a = frameOf(l, 'A');
    expect(b.box.angle).toBeCloseTo(-Math.asin(g / bookHeight(B)) * (180 / Math.PI), 0);
    expect(b.leanOn).toBe('A');
    expectSeated(b);
    expectSeated(a);
    expectNoOverlap([a, b]);
    expectTouching(b, a);
  });

  it('더 작은 책에 기대면 옆 책 윗모서리에 걸린다: tan θ = 빈틈 / 옆 책 키', () => {
    const g = 30; // 약 14°(A의 넘어짐 한계 12.5°보다 크다)
    const l = layoutOf(place('C', 0, 0), place('A', 1, 34 + g, -7));
    const a = frameOf(l, 'A');
    expect(Math.abs(a.box.angle)).toBeCloseTo(Math.atan(g / bookHeight(C)) * (180 / Math.PI), 0);
    expectSeated(a);
    expectNoOverlap(allFrames(l));
    expectTouching(a, frameOf(l, 'C'));
  });

  it('오른쪽으로도 같은 규칙', () => {
    const g = 30;
    const l = layoutOf(place('B', 0, 0, 7), place('A', 1, 28 + g));
    const b = frameOf(l, 'B');
    expect(b.box.angle).toBeGreaterThan(0);
    expect(b.box.angle).toBeCloseTo(Math.asin(g / bookHeight(B)) * (180 / Math.PI), 0);
    expectSeated(b);
    expectNoOverlap(allFrames(l));
  });

  it('빈틈이 없으면 그대로 선다', () => {
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40, -7));
    expect(leanOf(frameOf(l, 'B'))).toBe(0);
  });

  it('닿는 각이 넘어짐 한계 이하면 무게중심이 축 안쪽이라 다시 선다(옛 규칙의 7° 기대기)', () => {
    const tip = tipAngle(bookThickness(B), bookHeight(B));
    expect(tip).toBeCloseTo((Math.atan(28 / 150) * 180) / Math.PI, 6);
    for (const deg of [5, 7, tip - 0.3]) {
      const g = bookHeight(B) * Math.sin(rad(deg));
      const f = frameOf(layoutOf(place('A', 0, 0), place('B', 1, 40 + g, -7)), 'B');
      expect(leanOf(f)).toBe(0);
      expect(f.leanFailed).toBe(true);
    }
    const g = bookHeight(B) * Math.sin(rad(tip + 0.5));
    expect(leanOf(frameOf(layoutOf(place('A', 0, 0), place('B', 1, 40 + g, -7)), 'B'))).toBeCloseTo(tip + 0.5, 1);
  });

  it('기댈 책이 없거나 최대 각도를 넘으면 바로 선다', () => {
    const alone = layoutOf(place('B', 0, 100, 7));
    const f = frameOf(alone, 'B');
    expect(leanOf(f)).toBe(0);
    expect(f.leanFailed).toBe(true);
    const far = bookHeight(B) * Math.sin(rad(LEAN_MENU_MAX + 3));
    const wide = layoutOf(place('A', 0, 0), place('B', 1, 40 + far, -7));
    expect(leanOf(frameOf(wide, 'B'))).toBe(0);
    expect(frameOf(wide, 'B').leanFailed).toBe(true);
  });

  it('선반 밖으로 쓰러지는 쪽이면 바로 선다', () => {
    const edge = layoutOf(place('B', 0, 0, -7));
    expect(leanOf(frameOf(edge, 'B'))).toBe(0);
  });
});

describe('메뉴로 기울이기', () => {
  it('위치 값이 없는 예전 저장본에서도 기울일 틈을 벌려 기댄다', () => {
    const legacy = layoutOf(place('A', 0, 0), place('B', 1, 0), place('C', 2, 0));
    const noPos: ShelfLayout = { ...legacy, placements: legacy.placements.map(({ pos: _p, ...rest }) => rest) };
    const r = setTilt(noPos, books, 'C', -7);
    if (!r.ok) throw new Error(r.reason);
    const c = frameOf(r.layout, 'C');
    expect(c.box.angle).toBeLessThan(-3);
    expect(c.leanOn).toBe('B');
  });

  it('책마다 넘어짐 한계 + 여유로 기울도록 틈을 맞춘다(양쪽 모두, 넓으면 좁힌다)', () => {
    for (const [id, dir, l] of [
      ['B', -7, layoutOf(place('A', 0, 0), place('B', 1, 45))],
      ['B', -7, layoutOf(place('A', 0, 0), place('B', 1, 110))], // 틈이 넓다
      ['B', 7, layoutOf(place('B', 0, 10), place('A', 1, 45))],
      ['A', -7, layoutOf(place('C', 0, 0), place('A', 1, 40))],
    ] as const) {
      const r = setTilt(l, books, id, dir);
      if (!r.ok) throw new Error(r.reason);
      const f = frameOf(r.layout, id);
      const want = tipAngle(bookThickness(books[id]), bookHeight(books[id])) + LEAN_MARGIN;
      expect(Math.sign(f.box.angle)).toBe(Math.sign(dir));
      expect(leanOf(f)).toBeCloseTo(want, 1);
      expectSeated(f);
      expectNoOverlap(allFrames(r.layout));
    }
  });

  it('메뉴 한도 안에서 버틸 수 없는 두꺼운 책은 기울이지 않는다', () => {
    const fat = book('F', 120, 50); // 넘어짐 한계 22.6°
    const l = layoutOf(place('A', 0, 0), place('F', 1, 60));
    const r = setTilt(l, { ...books, F: fat }, 'F', -7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cannot-lean');
  });
});

describe('여러 권', () => {
  it('연쇄: C가 B에, B가 A에 기댄다', () => {
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40 + 30, -7), place('C', 2, 40 + 30 + 28 + 12, -7));
    const frames = allFrames(l);
    for (const f of frames) expectSeated(f);
    expectNoOverlap(frames);
    expect(frameOf(l, 'B').leanOn).toBe('A');
    expect(frameOf(l, 'C').leanOn).toBe('B');
  });

  it('마주 기대기: A는 오른쪽, B는 왼쪽으로 서로 기댄다', () => {
    const l = layoutOf(place('A', 0, 0, 7), place('B', 1, 40 + 70, -7));
    const frames = allFrames(l);
    for (const f of frames) expectSeated(f);
    expectNoOverlap(frames);
    expect(frameOf(l, 'A').box.angle).toBeGreaterThan(0);
    expect(frameOf(l, 'B').box.angle).toBeLessThan(0);
  });
});

describe('세 권: 세우고, 옮기고, 기대게 하고, 저장 후 복원', () => {
  it('형태가 깨지지 않는다', () => {
    let l = layoutOf(place('A', 0, 10), place('B', 1, 60), place('C', 2, 100));
    // B를 A 쪽으로 기울인다: 메뉴처럼 틈을 벌리고 기댄다
    const r1 = setTilt(l, books, 'B', -7);
    if (!r1.ok) throw new Error(r1.reason);
    l = withLeans(r1.layout, books);
    expect(l.placements.find((p) => p.bookId === 'B')!.lean?.on).toBe('A');
    // C를 빈 공간(오른쪽 끝)으로 옮긴다: A·B는 제자리
    const before = bookXs(l, books);
    const r2 = moveBook(l, books, 'C', { kind: 'insert', shelfId: 's', index: 2, x: 250 });
    if (!r2.ok) throw new Error(r2.reason);
    l = withLeans(r2.layout, books);
    const after = bookXs(l, books);
    expect(after.get('A')).toBeCloseTo(before.get('A')!, 2);
    expect(after.get('B')).toBeCloseTo(before.get('B')!, 2);
    expect(after.get('C')).toBeCloseTo(250, 1);
    const frames = allFrames(l);
    for (const f of frames) expectSeated(f);
    expectNoOverlap(frames);
    // 저장(JSON) → 복원: 위치·각도가 같다
    const restored = normalize(JSON.parse(JSON.stringify(l)));
    const again = allFrames(restored);
    for (const f of frames) {
      const g = again.find((q) => q.bookId === f.bookId)!;
      expect(g.box.x).toBeCloseTo(f.box.x, 4); // 똑바로 섰을 때 왼쪽 면(발 위치)
      expect(g.box.z).toBeCloseTo(f.box.z, 4);
      expect(g.box.angle).toBeCloseTo(f.box.angle, 3);
    }
    // 기댄 상대가 없어지면 그 각에서 더 넘어진다: 왼쪽에 닿을 책이 없어 바닥에 눕는다(무게중심이 판 안이라 선반에 남는다)
    const noA = withLeans({ ...restored, placements: restored.placements.filter((p) => p.bookId !== 'A') }, books);
    expect(noA.placements.find((p) => p.bookId === 'B')!.pose).toBe('horizontal');
    expect(shelfItems(noA, 's')).toHaveLength(2);
    // 선반 끝 가까이에서 넘어져 무게중심이 판 밖으로 나가면 선반에서 떨어진다(서랍)
    const edge = withLeans(layoutOf(place('A', 0, 0), place('B', 1, 40 + 30, -7)), books);
    const off = withLeans({ ...edge, placements: edge.placements.filter((p) => p.bookId !== 'A') }, books);
    expect(off.placements.find((p) => p.bookId === 'B')).toBeUndefined();
    expect(off.drawer).toContain('B');
    expect(bookThickness(B)).toBe(28);
  });
});

describe('받침을 잃거나 받침이 밀릴 때(도미노)', () => {
  const D = book('D', 160, 30);
  const S = book('S', 120, 20); // 가볍고 얇은 받침
  const all: BookMap = { ...books, D, S };
  const frame = (l: ShelfLayout, id: string) => computeShelf(l, all, 's').frames.find((f) => f.bookId === id)!;
  const lean = (l: ShelfLayout) => withLeans(l, all);

  it('받치던 책을 빼면 그 각에서 더 넘어져 다음 책에 기댄다', () => {
    // A ... C ... B(기댐: C에). C를 빼면 B는 A까지(약 34°, 미끄러짐 한계 44.6° 안) 넘어진다
    let l = lean(layoutOf(place('A', 0, 60), place('C', 1, 120), place('B', 2, 120 + 34 + 30, -7)));
    expect(frame(l, 'B').leanOn).toBe('C');
    const was = leanOf(frame(l, 'B'));
    l = lean({ ...l, placements: l.placements.filter((p) => p.bookId !== 'C') });
    const b = frame(l, 'B');
    expect(b.leanOn).toBe('A');
    expect(leanOf(b)).toBeGreaterThan(was + 5);
    expectSeated(b);
    expectNoOverlap(computeShelf(l, all, 's').frames);
  });

  it('닿을 곳이 미끄러짐 한계(약 45°)보다 멀면 바닥에 눕는다', () => {
    // D가 C에 기대 있다가 C를 빼면 왼쪽으로 넘어진다. 그쪽에는 판 안쪽으로 빈 바닥뿐이다
    let l = lean(layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7)));
    expect(frame(l, 'D').leanOn).toBe('C');
    l = lean({ ...l, placements: l.placements.filter((p) => p.bookId !== 'C') });
    const d = l.placements.find((p) => p.bookId === 'D')!;
    expect(d.pose).toBe('horizontal');
    expect(d.tilt).toBe(0);
    // 축 모서리에서 키만큼 넘어진 쪽에 눕는다
    const f = frame(l, 'D');
    expect(f.box.x).toBeCloseTo(150 + 34 + 30 - 160, 0);
    expect(lowestY(f)).toBeCloseTo(0, 6);
  });

  it('미는 힘에 받침이 넘어간다: 그 너머가 비었으면 받침도 기울고, 붙은 책이 있으면 버틴다', () => {
    // 무거운 D가 C에 기대 있다가 C를 빼면 얇은 S까지 크게 넘어진다. S 왼쪽이 비었으면 S가 밀려 넘어간다
    const open = lean(layoutOf(place('S', 0, 120), place('C', 1, 175), place('D', 2, 175 + 34 + 30, -7)));
    const pushed = lean({ ...open, placements: open.placements.filter((p) => p.bookId !== 'C') });
    const s = pushed.placements.find((p) => p.bookId === 'S');
    expect(!s || s.pose === 'horizontal' || s.tilt !== 0).toBe(true);
    // S 왼쪽에 A가 붙어 서 있으면 줄이 함께 버틴다
    const backed = lean(layoutOf(place('A', 0, 80), place('S', 1, 120), place('C', 2, 175), place('D', 3, 175 + 34 + 30, -7)));
    const held = lean({ ...backed, placements: backed.placements.filter((p) => p.bookId !== 'C') });
    const hs = held.placements.find((p) => p.bookId === 'S')!;
    expect(hs.pose).toBe('spine');
    expect(hs.tilt).toBe(0);
    expect(frame(held, 'D').leanOn).toBe('S');
  });
});

function lowestY(f: BookFrame) {
  return Math.min(...corners(fromPlaced(f.box)).map((c) => c.y));
}
