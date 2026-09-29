// 끼워 넣을 때 옆 책 비키기: 실제로 부딪히는 이웃만 필요한 최소 거리만큼, 연쇄는 필요한 데까지. 빈틈·무관한 책은 그대로.
import { SHELF_USABLE_WIDTH } from '../geometry';
import { bookXs, moveBook, placementOf, setDepth, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { withLeans } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const xs0 = bookXs(SAMPLE_LAYOUT, books);
const x0 = (id: string) => xs0.get(id)!;

// 3번 선반: 쌓기 더미(b12·b13) | 쇼코(b14) | 아무튼 서재(b15) | 우리가 빛의 속도로(b16)
describe('같은 선반 안에서 옮기기', () => {
  it('놓을 자리와 부딪히는 왼쪽 이웃은 왼쪽으로, 오른쪽 이웃은 오른쪽으로 부딪히지 않을 만큼만', () => {
    const x = x0('b12') + 164; // 더미 끝(끝면 여유 포함) 조금 안쪽
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b15', { kind: 'insert', shelfId: 'shelf-3', index: 1, x }));
    const xs = bookXs(l, books);
    expect(xs.get('b15')).toBeCloseTo(x, 1);
    // 더미는 왼쪽으로 밀리고(위아래 책이 함께), 쇼코는 b15 바로 오른쪽으로
    expect(xs.get('b12')!).toBeLessThan(x0('b12'));
    expect(xs.get('b13')).toBeCloseTo(xs.get('b12')!, 6);
    expect(xs.get('b14')!).toBeGreaterThan(x0('b14'));
    // 쇼코가 밀려도 b16과 부딪히지 않으면 b16은 그대로(빈틈 유지)
    expect(xs.get('b16')).toBeCloseTo(x0('b16'), 1);
  });

  it('밀린 책이 다음 책과 부딪히면 필요한 데까지만 연쇄로 민다', () => {
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b15', { kind: 'insert', shelfId: 'shelf-3', index: 1, x: 200 }));
    const xs = bookXs(l, books);
    expect(xs.get('b14')!).toBeGreaterThan(200);
    expect(xs.get('b16')!).toBeGreaterThan(x0('b16'));
    expect(xs.get('b12')).toBeCloseTo(x0('b12'), 1); // 왼쪽은 부딪히지 않아 그대로
  });

  it('아주 조금 옮긴 자리도 그대로 저장한다', () => {
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b16', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: x0('b16') + 1.5 }));
    expect(bookXs(l, books).get('b16')).toBeCloseTo(x0('b16') + 1.5, 1);
  });

  it('앞뒤로 떨어져 실제 상자가 부딪히지 않는 책은 밀지 않는다', () => {
    // 표지 책(깊이 약 31DU)을 벽 쪽(z 120~151)으로: 앞쪽(z 0~84)에 서는 아무튼 서재와는 겹칠 수 없다
    const deep = ok(setDepth(SAMPLE_LAYOUT, books, 'b16', 120));
    const before = bookXs(deep, books);
    const l = ok(moveBook(deep, books, 'b15', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: before.get('b16')! + 20 }));
    const xs = bookXs(l, books);
    expect(xs.get('b16')).toBeCloseTo(before.get('b16')!, 1);
    expect(xs.get('b15')).toBeCloseTo(before.get('b16')! + 20, 1);
  });

  it('선반 끝에 막히면 옮긴 책을 반대쪽으로 비켜 넣고, 양쪽 다 막히면 자리 없음', () => {
    // 오른쪽 끝을 넘는 자리: 끝에 맞춰 들어간다
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b15', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: SHELF_USABLE_WIDTH - 5 }));
    for (const [id, v] of bookXs(l, books)) if (placementOf(l, id)?.shelfId === 'shelf-3') expect(v).toBeGreaterThanOrEqual(-0.01);
    // 월든(폭 약 116DU)은 3번 선반 남은 공간(약 51DU)에 못 들어간다
    expect(moveBook(SAMPLE_LAYOUT, books, 'b07', { kind: 'insert', shelfId: 'shelf-3', index: 1, x: 190 })).toEqual({ ok: false, reason: 'no-space' });
  });
});

describe('다른 선반에 끼워 넣기', () => {
  it('기대는 책은 받치는 책과 함께 움직인다', () => {
    const leaned = withLeans(SAMPLE_LAYOUT, books);
    expect(placementOf(leaned, 'b11')?.lean?.on).toBe('b18');
    const before = bookXs(leaned, books);
    const l = ok(moveBook(leaned, books, 'b03', { kind: 'insert', shelfId: 'shelf-2', index: 4, x: 238 }));
    const xs = bookXs(l, books);
    const d18 = xs.get('b18')! - before.get('b18')!;
    expect(d18).toBeGreaterThan(0);
    expect(xs.get('b11')! - before.get('b11')!).toBeCloseTo(d18, 1);
    // 왼쪽 이웃(밝은 밤)은 왼쪽으로 비킨다
    expect(xs.get('b10')!).toBeLessThan(before.get('b10')!);
  });
});
