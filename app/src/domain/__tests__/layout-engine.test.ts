import { SHELF_USABLE_WIDTH, singleFootprint, tiltedBounds } from '../geometry';
import {
  addShelf,
  detach,
  findDropTarget,
  moveBook,
  moveBy,
  moveToShelf,
  normalize,
  placementOf,
  removeShelf,
  setPose,
  setTilt,
  shelfItems,
  usedWidth,
  validate,
  type BookMap,
} from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../sample-books';
import type { ShelfLayout } from '../types';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ids = SAMPLE_BOOKS.map((b) => b.id);
const ok = (r: ReturnType<typeof moveBook>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  expect(validate(r.layout, books, ids)).toEqual([]);
  return r.layout;
};
// 샘플 선반은 거의 꽉 차 있어서 가로 배치 실험은 빈 4번 선반에서 한다.
const roomy = () => {
  let l = addShelf(SAMPLE_LAYOUT, 'shelf-4');
  l = ok(moveToShelf(l, books, 'b16', 'shelf-4'));
  l = ok(moveToShelf(l, books, 'b15', 'shelf-4'));
  return l;
};

describe('샘플 데이터', () => {
  it('16권이 모두 한 번씩 유효하게 놓여 있다', () => {
    expect(SAMPLE_BOOKS).toHaveLength(16);
    expect(validate(SAMPLE_LAYOUT, books, ids)).toEqual([]);
    expect(normalize(SAMPLE_LAYOUT)).toEqual(SAMPLE_LAYOUT);
  });

  it('세움·기울임·쌓기·표지 전시를 모두 포함한다', () => {
    const ps = SAMPLE_LAYOUT.placements;
    expect(ps.some((p) => p.pose === 'spine' && p.tilt === 0)).toBe(true);
    expect(ps.some((p) => p.tilt !== 0)).toBe(true);
    expect(ps.some((p) => p.stackId)).toBe(true);
    expect(ps.some((p) => p.pose === 'front')).toBe(true);
  });
});

describe('형상', () => {
  it('기울이면 점유 폭이 늘어난다', () => {
    const { width } = tiltedBounds(34, 148, 7);
    expect(width).toBeGreaterThan(34 + 17);
    expect(width).toBeLessThan(34 + 19);
  });

  it('표지 전시는 책등보다 넓다', () => {
    const b = books.b04;
    expect(singleFootprint(b, { pose: 'front', tilt: 0 }).width).toBeGreaterThan(
      singleFootprint(b, { pose: 'spine', tilt: 0 }).width * 2,
    );
  });
});

describe('이동', () => {
  it('선반 사이로 옮기고 원래 선반은 빈틈 없이 정리된다', () => {
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b01', { kind: 'insert', shelfId: 'shelf-2', index: 1 }));
    expect(placementOf(l, 'b01')).toMatchObject({ shelfId: 'shelf-2', order: 1 });
    expect(shelfItems(l, 'shelf-1').map((it) => it.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('제자리 드롭은 변화 없음으로 처리한다', () => {
    const r = moveBook(SAMPLE_LAYOUT, books, 'b02', { kind: 'insert', shelfId: 'shelf-1', index: 1 });
    expect(r).toEqual({ ok: false, reason: 'no-change' });
  });

  it('공간이 부족하면 거절하고 책을 다른 선반으로 보내지 않는다', () => {
    // 1번 선반에 앞표지 책을 하나 더 넣으면 넘친다.
    const r = moveBook(SAMPLE_LAYOUT, books, 'b07', { kind: 'insert', shelfId: 'shelf-1', index: 0 });
    expect(r).toEqual({ ok: false, reason: 'no-space' });
  });

  it('빈 선반에 드롭할 수 있다', () => {
    const withEmpty = addShelf(SAMPLE_LAYOUT, 'shelf-new');
    const l = ok(moveBook(withEmpty, books, 'b16', { kind: 'insert', shelfId: 'shelf-new', index: 5 }));
    expect(placementOf(l, 'b16')).toMatchObject({ shelfId: 'shelf-new', order: 0 });
  });

  it('메뉴로 이전/다음 자리와 다른 선반으로 옮긴다', () => {
    let l = ok(moveBy(SAMPLE_LAYOUT, books, 'b02', 1));
    expect(shelfItems(l, 'shelf-1').map((it) => it.key).slice(0, 3)).toEqual(['b01', 'b03', 'b02']);
    expect(moveBy(SAMPLE_LAYOUT, books, 'b01', -1)).toEqual({ ok: false, reason: 'no-change' });
    l = ok(moveToShelf(SAMPLE_LAYOUT, books, 'b01', 'shelf-2'));
    expect(shelfItems(l, 'shelf-2').at(-1)!.key).toBe('b01');
    expect(moveToShelf(SAMPLE_LAYOUT, books, 'b09', 'shelf-3')).toEqual({ ok: false, reason: 'no-space' });
  });
});

describe('쌓기', () => {
  it('눕힌 책을 눕힌 그룹 위에 쌓고, 3권까지만 허용한다', () => {
    let l = ok(setPose(roomy(), books, 'b15', 'horizontal'));
    l = ok(moveBook(l, books, 'b15', { kind: 'stack', shelfId: 'shelf-3', itemKey: 'stack:b12' }));
    const stack = shelfItems(l, 'shelf-3')[0];
    expect(stack.bookIds).toEqual(['b12', 'b13', 'b15']);

    let l2 = ok(moveToShelf(l, books, 'b09', 'shelf-4'));
    l2 = ok(setPose(l2, books, 'b09', 'horizontal'));
    expect(moveBook(l2, books, 'b09', { kind: 'stack', shelfId: 'shelf-3', itemKey: 'stack:b12' })).toEqual({
      ok: false,
      reason: 'stack-full',
    });
  });

  it('세운 책은 쌓을 수 없다', () => {
    const r = moveBook(SAMPLE_LAYOUT, books, 'b14', { kind: 'stack', shelfId: 'shelf-3', itemKey: 'stack:b12' });
    expect(r).toEqual({ ok: false, reason: 'not-stackable' });
  });

  it('아래 책을 빼면 나머지가 내려앉고, 한 권만 남으면 일반 가로 책이 된다', () => {
    const d = detach(SAMPLE_LAYOUT, 'b12');
    const b13 = placementOf(d, 'b13')!;
    expect(b13.stackId).toBeUndefined();
    expect(b13).toMatchObject({ pose: 'horizontal', shelfId: 'shelf-3', order: 0 });

    let l = ok(setPose(roomy(), books, 'b15', 'horizontal'));
    l = ok(moveBook(l, books, 'b15', { kind: 'stack', shelfId: 'shelf-3', itemKey: 'stack:b12' }));
    const l2 = ok(moveBook(l, books, 'b12', { kind: 'insert', shelfId: 'shelf-4', index: 0 }));
    const stack = shelfItems(l2, 'shelf-3')[0];
    expect(stack.bookIds).toEqual(['b13', 'b15']);
    expect(stack.key).toBe('stack:b13');
    expect(stack.bookIds.map((id) => placementOf(l2, id)!.stackOrder)).toEqual([0, 1]);
  });

  it('쌓인 책의 형태를 바꾸면 그룹에서 빠져 옆자리로 나온다', () => {
    const l = ok(setPose(roomy(), books, 'b13', 'spine'));
    expect(shelfItems(l, 'shelf-3').map((it) => it.key).slice(0, 2)).toEqual(['b12', 'b13']);
  });
});

describe('형태·기울기', () => {
  it('눕힌 책·표지 전시는 기울일 수 없다', () => {
    expect(setTilt(SAMPLE_LAYOUT, books, 'b04', 7)).toEqual({ ok: false, reason: 'tilt-only-spine' });
  });

  it('형태를 바꾸면 기울기는 0이 된다', () => {
    const l = ok(setPose(roomy(), books, 'b15', 'horizontal'));
    expect(placementOf(l, 'b15')).toMatchObject({ pose: 'horizontal', tilt: 0 });
    expect(setPose(SAMPLE_LAYOUT, books, 'b11', 'horizontal')).toEqual({ ok: false, reason: 'no-space' });
    const l3 = ok(setPose(ok(moveToShelf(roomy(), books, 'b11', 'shelf-4')), books, 'b11', 'horizontal'));
    expect(placementOf(l3, 'b11')).toMatchObject({ pose: 'horizontal', tilt: 0 });
  });

  it('표지 전시로 바꿔 넘치면 적용하지 않는다', () => {
    expect(setPose(SAMPLE_LAYOUT, books, 'b01', 'front')).toEqual({ ok: false, reason: 'no-space' });
  });
});

describe('드롭 판정', () => {
  it('눕힌 책을 그룹 가운데에 가져가면 쌓기, 옆이면 나란히', () => {
    const l: ShelfLayout = ok(setPose(roomy(), books, 'b15', 'horizontal'));
    const d = detach(l, 'b15');
    expect(findDropTarget(d, books, 'shelf-3', 80, 'horizontal')).toEqual({
      kind: 'stack',
      shelfId: 'shelf-3',
      itemKey: 'stack:b12',
    });
    expect(findDropTarget(d, books, 'shelf-3', 12, 'horizontal')).toEqual({ kind: 'insert', shelfId: 'shelf-3', index: 0 });
    expect(findDropTarget(d, books, 'shelf-3', 80, 'spine')).toEqual({ kind: 'insert', shelfId: 'shelf-3', index: 0 });
    expect(findDropTarget(d, books, 'shelf-3', 999, 'spine')).toEqual({ kind: 'insert', shelfId: 'shelf-3', index: 2 });
  });
});

describe('선반', () => {
  it('책이 있는 선반은 지울 수 없다', () => {
    expect(removeShelf(SAMPLE_LAYOUT, 'shelf-1')).toEqual({ ok: false, reason: 'shelf-not-empty' });
    const l = addShelf(SAMPLE_LAYOUT, 'x');
    const r = removeShelf(l, 'x');
    expect(r.ok && r.layout.shelves).toHaveLength(3);
  });

  it('모든 샘플 선반이 사용 가능 폭 안에 있다', () => {
    for (const s of SAMPLE_LAYOUT.shelves) {
      expect(usedWidth(shelfItems(SAMPLE_LAYOUT, s.id), SAMPLE_LAYOUT, books)).toBeLessThanOrEqual(SHELF_USABLE_WIDTH);
    }
  });

  it('중복·누락·깨진 그룹을 잡아낸다', () => {
    const dup = { ...SAMPLE_LAYOUT, placements: [...SAMPLE_LAYOUT.placements, SAMPLE_LAYOUT.placements[0]] };
    expect(validate(dup, books, ids)).toContain('duplicate:b01');
    const missing = { ...SAMPLE_LAYOUT, placements: SAMPLE_LAYOUT.placements.slice(1) };
    expect(validate(missing, books, ids)).toContain('missing:b01');
    const broken = {
      ...SAMPLE_LAYOUT,
      placements: SAMPLE_LAYOUT.placements.map((p) => (p.bookId === 'b13' ? { ...p, order: 3 } : p)),
    };
    expect(validate(broken, books, ids)).toContain('stack-slot:stack:b12');
  });
});
