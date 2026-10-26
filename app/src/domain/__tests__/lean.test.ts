// 기대기: 먼저 "똑바로 선 책 + 기대는 책 한 권", 그다음 연쇄·마주 기대기, 마지막으로 높이·두께가 다른 세 권의 이동·저장·복원.
// 버틸 수 있는지(넘어짐·미끄러짐·받침)는 statics.ts 규칙: 각은 넘어짐 한계 atan(두께/키)를 넘어야 하고, 받침을 잃은 책은 더 넘어진다.
import { corners, fromPlaced, lowest } from '../book3';
import type { Placed } from '../box';
import { bookHeight, bookThickness, SHELF_USABLE_WIDTH } from '../geometry';
import { bookXs, checkSpace, moveBook, normalize, setTilt, shelfItems, type BookMap } from '../layout-engine';
import { overlaps } from '../test-fixtures/overlap';
import { contactOf, LEAN_MARGIN, LEAN_MENU_MAX, leanStatics, slipAngle, supportTips, tipAngle } from '../statics';
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
// 저장한 세운 책의 기울기는 늘 실제로 기댄 상대와 함께다(기울기만 남으면 다시 열 때 새로 기대려 해 배치가 바뀐다)
function expectNoBareTilt(l: ShelfLayout) {
  for (const p of l.placements) if (p.pose === 'spine' && p.tilt !== 0) expect(p.lean?.on).toBeDefined();
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
    let l = layoutOf(place('A', 0, 35), place('B', 1, 85), place('C', 2, 125));
    // B를 A 쪽으로 기울인다: 메뉴처럼 틈을 벌리고 기댄다(받침 A가 왼쪽 빈 공간으로 비킨다. B는 제자리)
    const xs0 = bookXs(l, books);
    const r1 = setTilt(l, books, 'B', -7);
    if (!r1.ok) throw new Error(r1.reason);
    l = withLeans(r1.layout, books);
    expect(l.placements.find((p) => p.bookId === 'B')!.lean?.on).toBe('A');
    expect(bookXs(l, books).get('B')).toBeCloseTo(xs0.get('B')!, 4);
    expect(bookXs(l, books).get('A')!).toBeLessThan(xs0.get('A')!);
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

// 좌우를 뒤집은 배치: 자리·기울기·저장된 기대기 각을 거울로(세운 책만)
function mirrored(l: ShelfLayout, all: BookMap): ShelfLayout {
  const n = l.placements.length;
  return {
    ...l,
    placements: l.placements.map((p) => ({
      ...p,
      order: n - 1 - p.order,
      pos: SHELF_USABLE_WIDTH - (p.pos ?? 0) - bookThickness(all[p.bookId]),
      tilt: -p.tilt as -7 | 0 | 7,
      lean: p.lean ? { ...p.lean, angle: -p.lean.angle } : undefined,
    })),
  };
}
// 뒤집은 배치의 결과도 뒤집혀야 한다: 각도 부호, 기댄 상대, 넘어진 방향, 선 책
function expectMirror(l: ShelfLayout, all: BookMap) {
  const a = computeShelf(l, all, 's').frames;
  const b = computeShelf(mirrored(l, all), all, 's').frames;
  for (const f of a) {
    const g = b.find((q) => q.bookId === f.bookId)!;
    expect(g.box.angle).toBeCloseTo(-f.box.angle, 2);
    expect(g.leanOn).toBe(f.leanOn);
    expect((g.fell ?? 0) + (f.fell ?? 0)).toBe(0);
    expect(!!g.leanFailed).toBe(!!f.leanFailed);
  }
}

describe('좌우 대칭', () => {
  const D = book('D', 160, 30);
  const S = book('S', 120, 20);
  const all: BookMap = { ...books, D, S };

  it('마주 기댄 두 책은 좌우를 바꿔도 같다(접촉 힘을 두 번 세지 않는다)', () => {
    // 얇은 B(150×28)와 두꺼운 A(180×40)가 70만큼 떨어져 마주 기댄다. 예전에는 B가 왼쪽이면 A가 밀려 둘 다 섰다
    const ab = withLeans(layoutOf(place('A', 0, 100, 7), place('B', 1, 100 + 40 + 70, -7)), all);
    const ba = withLeans(layoutOf(place('B', 0, 100, 7), place('A', 1, 100 + 28 + 70, -7)), all);
    const angle = (l: ShelfLayout, id: string) => l.placements.find((p) => p.bookId === id)!.lean?.angle;
    expect(angle(ab, 'A')).toBeGreaterThan(tipAngle(40, 180));
    expect(angle(ba, 'B')).toBeGreaterThan(tipAngle(28, 150));
    expect(Math.abs(angle(ab, 'A')!)).toBeCloseTo(Math.abs(angle(ba, 'A')!), 2);
    expect(Math.abs(angle(ab, 'B')!)).toBeCloseTo(Math.abs(angle(ba, 'B')!), 2);
  });

  it('기대기·연쇄·마주 기대기·도미노를 거울로 뒤집으면 결과도 뒤집힌다', () => {
    const cases = [
      layoutOf(place('A', 0, 60), place('C', 1, 120), place('B', 2, 120 + 34 + 30, -7)),
      layoutOf(place('A', 0, 60), place('C', 1, 140, -7), place('B', 2, 200, -7)),
      layoutOf(place('A', 0, 100, 7), place('B', 1, 100 + 40 + 70, -7)),
      layoutOf(place('B', 0, 100, 7), place('A', 1, 100 + 28 + 70, -7)),
      layoutOf(place('S', 0, 120), place('D', 1, 175 + 34 + 30, -7)),
      layoutOf(place('C', 0, 150), place('D', 1, 150 + 34 + 30, -7)),
    ];
    for (const l of cases) {
      expectMirror(l, all);
      expectMirror(withLeans(l, all), all);
    }
  });
});

describe('낮은 받침과 연쇄', () => {
  it('낮은 받침의 모서리에 기댄 책은 평평한 받침 공식보다 큰 각에서도 버틴다(실제 접촉점의 힘 평형)', () => {
    // 174×30 D가 C에 기대 있다가 C를 빼면 키 80인 S의 윗모서리까지 넘어진다(56°). S 왼쪽에 A가 붙어 받침이 넘어가지 않는다.
    // 평평한 받침이면 미끄러질 각(44°)이지만 모서리가 미는 방향이 가팔라 바닥 마찰이 버틴다. 예전에는 눕혔다.
    const A2 = book('A', 150, 30);
    const S = book('S', 80, 30);
    const C2 = book('C', 174, 30);
    const D = book('D', 174, 30);
    const all: BookMap = { A: A2, S, C: C2, D };
    const l = withLeans(layoutOf(place('A', 0, 120), place('S', 1, 150), place('C', 2, 228), place('D', 3, 300, -7)), all);
    const after = withLeans({ ...l, placements: l.placements.filter((p) => p.bookId !== 'C') }, all);
    const d = after.placements.find((p) => p.bookId === 'D')!;
    expect(d.pose).toBe('spine');
    expect(d.lean?.on).toBe('S');
    expect(Math.abs(d.lean!.angle)).toBeGreaterThan(slipAngle(30, 174));
    const fs = computeShelf(after, all, 's').frames;
    const f = fs.find((q) => q.bookId === 'D')!;
    const s = fs.find((q) => q.bookId === 'S')!;
    expect(leanStatics(f.box, contactOf(f.box, s.box)).ok).toBe(true);
  });

  it('받침은 넘어가지 않아도 바닥이 미끄러지면 밀려난다(supportTips 미끄러짐 갈래)', () => {
    // 낮고 두꺼운 받침(60×40)을 낮은 곳에서 옆으로 민다: 돌림힘은 버티지만 마찰(0.4)을 넘으면 그쪽으로 밀린다
    const sup: Placed = { bookId: 'S', pose: 'spine', size: { w: 60, h: 40, d: 100 }, x: 100, y: 0, z: 0, angle: 0 };
    const m = 60 * 40 * 100;
    const push = (fx: number) => [{ f: { x: fx * m, y: 0 }, at: { x: 160, y: 10 } }];
    expect(supportTips(sup, push(-0.5), () => false)).toBe(-1);
    expect(supportTips(sup, push(-0.3), () => false)).toBe(0);
    expect(supportTips(sup, push(-0.5), () => true)).toBe(0);
  });

  it('기대려다 실패해 선 책도 받침으로 밀리는지 본다: 한 번 푼 결과를 다시 풀어도 그대로다', () => {
    // Q는 오른쪽으로 기대려 했지만 P가 먼저 Q에 기댄다. 예전에는 Q의 저장된 기울기 때문에 받침 검사를 건너뛰어, 다음에 풀 때(앱을 켤 때) 결과가 바뀌었다
    const all: BookMap = { P: book('P', 141, 28.7), Q: book('Q', 82, 20.7), R: book('R', 144, 30.4) };
    const once = withLeans(layoutOf(place('R', 0, 164.8), place('Q', 1, 230.79, 7), place('P', 2, 274.25, -7)), all);
    expect(withLeans(once, all)).toEqual(once);
    for (const f of computeShelf(once, all, 's').frames) expect(f.fell).toBeUndefined();
  });

  it('세 권 넘게 이어지는 도미노도 겹치지 않고 다시 풀어도 그대로다', () => {
    const D = book('D', 180, 44);
    const C2 = book('C', 120, 34);
    const S1 = book('S1', 120, 20);
    const S2 = book('S2', 110, 18);
    const S3 = book('S3', 100, 16);
    const all: BookMap = { D, C: C2, S1, S2, S3 };
    const l = withLeans(layoutOf(place('S3', 0, 40), place('S2', 1, 80), place('S1', 2, 125), place('C', 3, 175), place('D', 4, 175 + 34 + 30, -7)), all);
    const after = withLeans({ ...l, placements: l.placements.filter((p) => p.bookId !== 'C') }, all);
    // 밀린 받침들이 차례로 넘어간다(선 채로 남은 받침 없음), 선반 밖으로 떨어진 책·누울 자리가 없는 책은 서랍으로
    for (const id of ['S1', 'S2']) {
      const p = after.placements.find((q) => q.bookId === id);
      expect(!p || p.pose === 'horizontal' || p.tilt !== 0).toBe(true);
    }
    expect(after.placements.length + after.drawer.length).toBe(4);
    expect(checkSpace(after, all, 's')).toBeNull();
    expect(withLeans(after, all)).toEqual(after);
    expectNoOverlap(computeShelf(after, all, 's').frames);
  });
});

describe('넘어진 책이 머무는 자리', () => {
  const D = book('D', 160, 30);
  const C2 = book('C', 120, 34);
  const S = book('S', 50, 20);
  const Z = book('Z', 130, 25);
  const all: BookMap = { D, C: C2, S, Z };
  const W = SHELF_USABLE_WIDTH;
  const xsOf = (l: ShelfLayout) => bookXs(l, all);
  const drop = (l: ShelfLayout, id: string) => ({ ...l, placements: l.placements.filter((p) => p.bookId !== id) });

  it('낮은 책 모서리에서 미끄러진 책은 발을 반대쪽으로 미끄러뜨려 기대고, 옆 책은 그대로다(좌우 대칭)', () => {
    // D가 C에 기대 있다가 C를 빼면 키 50인 S에 닿아 미끄러진다. 예전에는 S·Z를 60DU쯤 밀며 눕혔다(거울 배치에서는 밀지 않았다)
    const right = withLeans(layoutOf(place('D', 0, 100, 7), place('C', 1, 160), place('S', 2, 230), place('Z', 3, 260)), all);
    const left = withLeans(layoutOf(place('Z', 0, W - 285), place('S', 1, W - 250), place('C', 2, W - 194), place('D', 3, W - 130, -7)), all);
    for (const [l, dir] of [[right, 1], [left, -1]] as const) {
      const before = drop(l, 'C');
      const after = withLeans(before, all);
      const x0 = xsOf(before);
      const x1 = xsOf(after);
      for (const id of ['S', 'Z']) expect(x1.get(id)).toBeCloseTo(x0.get(id)!, 6);
      const d = after.placements.find((p) => p.bookId === 'D')!;
      expect(d.pose).toBe('spine');
      expect(d.lean?.on).toBe('S');
      expect(Math.sign(d.lean!.angle)).toBe(dir);
      // 발은 넘어지는 반대쪽으로만 미끄러졌다
      expect(((x1.get('D')! - x0.get('D')!) * dir)).toBeLessThan(0);
      expect(withLeans(after, all)).toEqual(after);
    }
    const r = xsOf(withLeans(drop(right, 'C'), all)).get('D')!;
    const m = xsOf(withLeans(drop(left, 'C'), all)).get('D')!;
    expect(r).toBeCloseTo(W - m - 30, 1);
  });

  it('발 뒤에 붙어 선 책이 발을 막으면 미끄러지지 않고 그 자리에서 기댄다', () => {
    // 위와 같지만 D 바로 왼쪽에 Z가 붙어 있다: D는 미끄러질 수 없어 S에 닿은 각 그대로 버틴다
    const l = withLeans(layoutOf(place('Z', 0, 75), place('D', 1, 100, 7), place('C', 2, 160), place('S', 3, 230)), all);
    const after = withLeans(drop(l, 'C'), all);
    const d = after.placements.find((p) => p.bookId === 'D')!;
    expect(d.pose).toBe('spine');
    expect(d.lean?.on).toBe('S');
    expect(xsOf(after).get('D')).toBeCloseTo(100, 6);
    expect(xsOf(after).get('Z')).toBeCloseTo(75, 6);
  });

  it('무작위 줄에서 받침을 빼도 넘어지지 않은 책은 20DU 넘게 밀리지 않고, 다시 풀어도 그대로다', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let checked = 0;
    for (let trial = 0; trial < 90; trial++) {
      const bs: BookMap = {};
      const ps: BookPlacement[] = [];
      let x = 5 + rnd() * 40;
      for (let i = 0; i < 5; i++) {
        const id = `r${i}`;
        const T = Math.round((8 + rnd() * 30) * 10) / 10;
        bs[id] = book(id, Math.round(70 + rnd() * 120), T);
        if (x + T > W) break;
        ps.push(place(id, ps.length, Math.round(x * 100) / 100, rnd() < 0.45 ? (rnd() < 0.5 ? -7 : 7) : 0));
        x += T + (rnd() < 0.4 ? 0 : rnd() * 45);
      }
      if (ps.length < 3) continue;
      const l = withLeans(layoutOf(...ps), bs);
      expect(withLeans(l, bs)).toEqual(l);
      expectNoBareTilt(l);
      for (const v of l.placements) {
        const before = { ...l, placements: l.placements.filter((p) => p.bookId !== v.bookId) };
        const fell = new Set(computeShelf(before, bs, 's').frames.filter((f) => f.fell).map((f) => f.bookId));
        if (!fell.size) continue;
        const after = withLeans(before, bs);
        checked++;
        expect(checkSpace(after, bs, 's')).toBeNull();
        expect(withLeans(after, bs)).toEqual(after);
        expectNoBareTilt(after);
        const x0 = bookXs(before, bs);
        const x1 = bookXs(after, bs);
        for (const p of after.placements) if (!fell.has(p.bookId) && p.pose !== 'horizontal') expect(Math.abs(x1.get(p.bookId)! - x0.get(p.bookId)!)).toBeLessThanOrEqual(20.01);
      }
    }
    expect(checked).toBeGreaterThan(5);
  }, 60_000);
});

describe('선반 끝과 빈 공간', () => {
  const W = SHELF_USABLE_WIDTH;
  const row = (bs: BookMap, ...ps: [string, number, (-7 | 0 | 7)?][]) => layoutOf(...ps.map(([id, pos, tilt], i) => place(id, i, pos, tilt ?? 0)));

  it('판 끝 책이 받침을 잃으면 발이 판 위에 있는 한 미끄러져, 다음 책 앞에 자리가 있으면 판 위에 눕는다', () => {
    const bs: BookMap = { e: book('e', 143.4, 30), s: book('s', 160, 33), n: book('n', 175, 36), m: book('m', 150, 32) };
    const r = setTilt(row(bs, ['e', 0], ['s', 35], ['n', 148], ['m', 184]), bs, 'e', 7);
    if (!r.ok) throw new Error(r.reason);
    const l = withLeans(r.layout, bs);
    expect(l.placements.find((p) => p.bookId === 'e')!.lean?.on).toBe('s');
    // 받침 s를 뺀다: e는 n에 머리를 댄 채 발이 판 끝 쪽으로 미끄러진다(서 있던 상자는 판 끝을 넘어도 발은 두께만큼 안쪽)
    const after = withLeans({ ...l, placements: l.placements.filter((p) => p.bookId !== 's') }, bs);
    const e = after.placements.find((p) => p.bookId === 'e');
    expect(after.drawer).not.toContain('e');
    expect(e!.pose).toBe('horizontal');
    const xs = bookXs(after, bs);
    expect(xs.get('e')! + 143.4).toBeLessThanOrEqual(xs.get('n')! + 0.01);
    expect(checkSpace(after, bs, 's')).toBeNull();
  });

  it('기울일 틈은 어느 쪽 끝의 빈 공간으로도 벌린다: 좌우를 바꾼 줄에서 같은 각으로 기댄다', () => {
    const bs: BookMap = { a: book('a', 150, 30), b: book('b', 160, 35), c: book('c', 170, 40) };
    // 왼쪽 끝에 붙은 줄에서 b를 왼쪽으로(a 너머는 판 끝) / 오른쪽 끝에 붙은 줄에서 b를 오른쪽으로(c 너머는 판 끝)
    const left = setTilt(row(bs, ['a', 0], ['b', 30], ['c', 65]), bs, 'b', -7);
    const right = setTilt(row(bs, ['c', W - 105], ['b', W - 65], ['a', W - 30]), bs, 'b', 7);
    if (!left.ok || !right.ok) throw new Error('tilt');
    const L = withLeans(left.layout, bs);
    const R = withLeans(right.layout, bs);
    const lb = L.placements.find((p) => p.bookId === 'b')!;
    const rb = R.placements.find((p) => p.bookId === 'b')!;
    expect(lb.lean?.on).toBe('a');
    expect(rb.lean?.on).toBe('a');
    expect(Math.abs(rb.lean!.angle)).toBeCloseTo(Math.abs(lb.lean!.angle), 3);
    // 받침(a)은 판 끝에 붙어 있어 그대로, b와 그 너머(c)가 빈 쪽으로 비킨다
    expect(bookXs(L, bs).get('a')).toBeCloseTo(0, 3);
    expect(bookXs(R, bs).get('a')).toBeCloseTo(W - 30, 3);
    expect(bookXs(L, bs).get('c')! - bookXs(L, bs).get('b')!).toBeCloseTo(35, 3);
  });
});
