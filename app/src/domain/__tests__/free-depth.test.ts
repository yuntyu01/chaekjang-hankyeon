// 앞뒤·좌우 자유 배치: 제자리 조금 옮기기, 앞뒤(깊이) 조절, 쌓인 위 책 어긋남, 더미째 옮기기, 저장·복원.
import { corners, fromPlaced, gap } from '../book3';
import { SHELF_DEPTH, SHELF_FRONT } from '../geometry';
import { applySwapTarget, bookXs, boxOf, checkSpace, depthRange, findSwapTarget, moveBook, normalize, placementOf, setDepth, setPose, shelfItems, shiftOnStack, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { bodiesOf } from '../shelf-scene';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
// 3번째 선반에 두 권만: 뒤쪽 표지 전시(b16), 앞쪽 세운 책(b14)
function pilot(): ShelfLayout {
  const keep = ['b16', 'b14'];
  const l = normalize({
    ...SAMPLE_LAYOUT,
    placements: SAMPLE_LAYOUT.placements
      .filter((p) => p.shelfId !== 'shelf-3' || keep.includes(p.bookId))
      .map((p) => (p.bookId === 'b16' ? { ...p, pos: 150, depth: undefined } : p.bookId === 'b14' ? { ...p, pos: 40 } : p)),
    drawer: [...SAMPLE_LAYOUT.drawer, ...SAMPLE_LAYOUT.placements.filter((p) => p.shelfId === 'shelf-3' && !keep.includes(p.bookId)).map((p) => p.bookId)],
  });
  return l;
}
const noPenetration = (l: ShelfLayout, shelf: string) => {
  const bs = bodiesOf(l, books, shelf);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(gap(bs[i], bs[j])).toBeGreaterThan(-0.3);
};

describe('앞뒤 조절', () => {
  it('정면 책을 뒤로, 세운 책을 앞으로: 깊이가 떨어지면 좌우로 겹쳐 놓을 수 있다', () => {
    let l = ok(setDepth(pilot(), books, 'b16', SHELF_DEPTH));
    const r16 = depthRange(l, books, 'b16');
    expect(boxOf(l, books, 'b16')!.z).toBeCloseTo(r16.hi, 1); // 벽까지 가능한 데까지
    l = ok(setDepth(l, books, 'b14', -SHELF_FRONT));
    expect(boxOf(l, books, 'b14')!.z).toBeCloseTo(-SHELF_FRONT, 1);
    // 세운 책을 정면 책 앞으로 끌어 놓는다: 밀리지 않고 겹친다
    const x16 = bookXs(l, books).get('b16')!;
    const t = findSwapTarget(l, books, 'b14', x16 + 30);
    const moved = ok(applySwapTarget(l, books, 'b14', t));
    expect(bookXs(moved, books).get('b16')).toBeCloseTo(x16, 1);
    expect(boxOf(moved, books, 'b14')!.z).toBeCloseTo(-SHELF_FRONT, 1); // 옮겨도 깊이 그대로
    noPenetration(moved, 'shelf-3');
  });

  it('옆 책에 막히면 밀지 않고 닿는 데까지만', () => {
    // 세운 책을 정면 책 앞(같은 x)에 둔 채 뒤로 보내면 정면 책 앞면에서 멈춘다
    let l = ok(setDepth(pilot(), books, 'b16', SHELF_DEPTH));
    l = ok(setDepth(l, books, 'b14', -SHELF_FRONT));
    const x16 = bookXs(l, books).get('b16')!;
    l = ok(applySwapTarget(l, books, 'b14', findSwapTarget(l, books, 'b14', x16 + 30)));
    const before = bookXs(l, books);
    const r = setDepth(l, books, 'b14', SHELF_DEPTH);
    const after = r.ok ? r.layout : l;
    const z14 = boxOf(after, books, 'b14')!;
    let back = -Infinity;
    for (const c of corners(fromPlaced(z14))) back = Math.max(back, c.z);
    expect(back).toBeLessThanOrEqual(boxOf(after, books, 'b16')!.z + 0.3);
    for (const [id, x] of before) expect(bookXs(after, books).get(id)).toBeCloseTo(x, 1);
    noPenetration(after, 'shelf-3');
  });

  it('앞쪽 책을 눕혀도 뒤쪽(깊이가 떨어진) 정면 책은 밀리지 않는다', () => {
    let l = ok(setDepth(pilot(), books, 'b16', SHELF_DEPTH));
    l = ok(setDepth(l, books, 'b14', -SHELF_FRONT));
    const x16 = bookXs(l, books).get('b16')!;
    l = ok(applySwapTarget(l, books, 'b14', findSwapTarget(l, books, 'b14', x16 + 40)));
    const r = setPose(l, books, 'b14', 'horizontal');
    const after = r.ok ? r.layout : l;
    expect(bookXs(after, books).get('b16')).toBeCloseTo(x16, 1);
    noPenetration(after, 'shelf-3');
  });

  it('자세를 바꿔도 사용자가 둔 깊이는 유지(선반 안으로만 맞춤)', () => {
    let l = ok(setDepth(pilot(), books, 'b14', -30));
    l = ok(setPose(l, books, 'b14', 'front'));
    expect(boxOf(l, books, 'b14')!.z).toBeCloseTo(-30, 1);
  });
});

describe('쌓인 책', () => {
  it('위 책은 아래 책 위에서만 옮겨지고(받침 안), 옮긴 자리는 유지', () => {
    const before = boxOf(SAMPLE_LAYOUT, books, 'b13')!;
    const r = shiftOnStack(SAMPLE_LAYOUT, books, 'b13', 30);
    const l = r.ok ? r.layout : SAMPLE_LAYOUT;
    const dx = boxOf(l, books, 'b13')!.x - before.x;
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBeLessThan(30); // 받침 밖으로는 안 나간다
    expect(checkSpace(l, books)).toBeNull();
  });

  it('받치는 책을 옮기면 위 책이 어긋남까지 그대로 따라온다', () => {
    let l = SAMPLE_LAYOUT;
    const r = shiftOnStack(l, books, 'b13', 1);
    if (r.ok) l = r.layout;
    const rel = boxOf(l, books, 'b13')!.x - boxOf(l, books, 'b12')!.x;
    const b12 = bookXs(l, books).get('b12')!;
    const t = findSwapTarget(l, books, 'b12', b12 + 80 + 12);
    expect(t.kind).toBe('place');
    const moved = applySwapTarget(l, books, 'b12', t);
    const m = moved.ok ? moved.layout : l;
    expect(shelfItems(m, 'shelf-3').find((it) => it.bookIds.includes('b12'))!.bookIds).toEqual(['b12', 'b13']);
    expect(boxOf(m, books, 'b13')!.x - boxOf(m, books, 'b12')!.x).toBeCloseTo(rel, 2);
  });
});

it('저장·복원: 위치·깊이·회전·어긋남이 그대로', () => {
  let l = ok(setDepth(pilot(), books, 'b16', SHELF_DEPTH));
  l = ok(setDepth(l, books, 'b14', -40));
  const restored = normalize(JSON.parse(JSON.stringify(l)));
  for (const id of ['b16', 'b14']) {
    expect(boxOf(restored, books, id)).toEqual(boxOf(l, books, id));
  }
  const s = shiftOnStack(SAMPLE_LAYOUT, books, 'b13', 1);
  if (s.ok) {
    const back = normalize(JSON.parse(JSON.stringify(s.layout)));
    expect(boxOf(back, books, 'b13')).toEqual(boxOf(s.layout, books, 'b13'));
  }
  void moveBook;
});
