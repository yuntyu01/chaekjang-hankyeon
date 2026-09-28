// 기대기: 먼저 "똑바로 선 책 + 기대는 책 한 권", 그다음 연쇄·마주 기대기, 마지막으로 높이·두께가 다른 세 권의 이동·저장·복원.
import { bookHeight, bookThickness, SHELF } from '../geometry';
import { bookXs, moveBook, normalize, setTilt, shelfItems, type BookMap } from '../layout-engine';
import { MAX_LEAN, overlaps } from '../lean';
import { computeShelf, frontOutline, leanFrame, withLeans, type BookFrame } from '../shelf-scene';
import type { Book, BookPlacement, ShelfLayout } from '../types';

const FLOOR = SHELF.clearHeight;
const rad = (d: number) => (d * Math.PI) / 180;

const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.66, // 표지 폭이 책 기준선 뒤 깊이(160mm) 안에 들어가게(더 깊으면 기준선 앞으로 나와 선다)
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

function expectSeated(f: BookFrame) {
  // 가장 낮은 점이 선반 바닥에 닿고, 축 모서리가 바닥에 있다
  const o = frontOutline(f);
  expect(Math.max(...o.map((p) => p.y))).toBeCloseTo(FLOOR, 6);
  if (f.rotate) {
    const pivotX = f.rotate > 0 ? f.left + f.width : f.left;
    expect(o.some((p) => Math.abs(p.x - pivotX) < 1e-6 && Math.abs(p.y - FLOOR) < 1e-6)).toBe(true);
  }
}
function expectNoOverlap(frames: BookFrame[]) {
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) expect(overlaps(frontOutline(frames[i]), frontOutline(frames[j]), 0.2)).toBe(false);
}
function expectTouching(f: BookFrame, other: BookFrame) {
  const dir = Math.sign(f.rotate);
  const more = leanFrame(books[f.bookId], f.left, f.rotate + dir * 0.6).poly;
  expect(overlaps(more, frontOutline(other))).toBe(true);
}

describe('한 권이 똑바로 선 책에 기댄다', () => {
  it('더 큰 책에 기대면 윗모서리가 옆면에 닿는다: sin θ = 빈틈 / 키', () => {
    // A는 똑바로, B는 A 오른쪽에 빈틈 g를 두고 왼쪽으로 기댄다
    const g = 15;
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40 + g, -7));
    const b = frameOf(l, 'B');
    const a = frameOf(l, 'A');
    expect(b.rotate).toBeCloseTo(-Math.asin(g / bookHeight(B)) * (180 / Math.PI), 0);
    expect(b.leanOn).toBe('A');
    expectSeated(b);
    expectSeated(a);
    expectNoOverlap([a, b]);
    expectTouching(b, a);
  });

  it('더 작은 책에 기대면 옆 책 윗모서리에 걸린다: tan θ = 빈틈 / 옆 책 키', () => {
    const g = 20;
    const l = layoutOf(place('C', 0, 0), place('A', 1, 34 + g, -7));
    const a = frameOf(l, 'A');
    expect(Math.abs(a.rotate)).toBeCloseTo(Math.atan(g / bookHeight(C)) * (180 / Math.PI), 0);
    expectSeated(a);
    expectNoOverlap(allFrames(l));
    expectTouching(a, frameOf(l, 'C'));
  });

  it('오른쪽으로도 같은 규칙', () => {
    const g = 12;
    const l = layoutOf(place('B', 0, 0, 7), place('A', 1, 28 + g));
    const b = frameOf(l, 'B');
    expect(b.rotate).toBeGreaterThan(0);
    expect(b.rotate).toBeCloseTo(Math.asin(g / bookHeight(B)) * (180 / Math.PI), 0);
    expectSeated(b);
    expectNoOverlap(allFrames(l));
  });

  it('빈틈이 없으면 그대로 선다', () => {
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40, -7));
    expect(frameOf(l, 'B').rotate).toBe(0);
  });

  it('기댈 책이 없거나 최대 각도를 넘으면 바로 선다', () => {
    const alone = layoutOf(place('B', 0, 100, 7));
    const f = frameOf(alone, 'B');
    expect(f.rotate).toBe(0);
    expect(f.leanFailed).toBe(true);
    const far = bookHeight(B) * Math.sin(rad(MAX_LEAN + 3));
    const wide = layoutOf(place('A', 0, 0), place('B', 1, 40 + far, -7));
    expect(frameOf(wide, 'B').rotate).toBe(0);
    expect(frameOf(wide, 'B').leanFailed).toBe(true);
  });

  it('선반 밖으로 쓰러지는 쪽이면 바로 선다', () => {
    const edge = layoutOf(place('B', 0, 0, -7));
    expect(frameOf(edge, 'B').rotate).toBe(0);
  });
});

describe('메뉴로 기울이기', () => {
  it('위치 값이 없는 예전 저장본에서도 기울일 틈을 벌려 기댄다', () => {
    const legacy = layoutOf(place('A', 0, 0), place('B', 1, 0), place('C', 2, 0));
    const noPos: ShelfLayout = { ...legacy, placements: legacy.placements.map(({ pos: _p, ...rest }) => rest) };
    const r = setTilt(noPos, books, 'C', -7);
    if (!r.ok) throw new Error(r.reason);
    const c = frameOf(r.layout, 'C');
    expect(c.rotate).toBeLessThan(-3);
    expect(c.leanOn).toBe('B');
  });
});

describe('여러 권', () => {
  it('연쇄: C가 B에, B가 A에 기댄다', () => {
    const l = layoutOf(place('A', 0, 0), place('B', 1, 40 + 12, -7), place('C', 2, 40 + 12 + 28 + 14, -7));
    const frames = allFrames(l);
    for (const f of frames) expectSeated(f);
    expectNoOverlap(frames);
    expect(frameOf(l, 'B').leanOn).toBe('A');
    expect(frameOf(l, 'C').leanOn).toBe('B');
  });

  it('마주 기대기: A는 오른쪽, B는 왼쪽으로 서로 기댄다', () => {
    const l = layoutOf(place('A', 0, 0, 7), place('B', 1, 40 + 16, -7));
    const frames = allFrames(l);
    for (const f of frames) expectSeated(f);
    expectNoOverlap(frames);
    expect(frameOf(l, 'A').rotate).toBeGreaterThan(0);
    expect(frameOf(l, 'B').rotate).toBeLessThan(0);
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
      expect(g.left).toBeCloseTo(f.left, 4);
      expect(g.rotate).toBeCloseTo(f.rotate, 3);
    }
    // 기댄 상대가 없어지면 다시 계산해 바로 선다
    const noA = withLeans({ ...restored, placements: restored.placements.filter((p) => p.bookId !== 'A') }, books);
    expect(noA.placements.find((p) => p.bookId === 'B')!.tilt).toBe(0);
    expect(shelfItems(noA, 's')).toHaveLength(2);
    expect(bookThickness(B)).toBe(28);
  });
});
