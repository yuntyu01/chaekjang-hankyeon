// 끼워 넣을 때 옆 책 비키기(한쪽 우선): 가리킨 자리·깊이는 고정, 실제로 부딪히는 이웃을 먼저 모두 왼쪽으로,
// 왼쪽 공간이 모자라면 드래그 시작 배치에서 오른쪽으로. 둘 다 안 되면 자리 없음. 빈틈·무관한 책은 그대로.
import { bookXs, moveBook, placementOf, setDepth, shelfItems, type BookMap, type Result } from '../layout-engine';
import { SAMPLE_BOOKS, SAMPLE_LAYOUT } from '../onboarding-sample';
import { withLeans } from '../shelf-scene';

const books: BookMap = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const xs0 = bookXs(SAMPLE_LAYOUT, books);
const x0 = (id: string) => xs0.get(id)!;
const order = (l: ReturnType<typeof ok>, shelf: string) => shelfItems(l, shelf).map((it) => it.key);
const depthOf = (l: ReturnType<typeof ok>, id: string) => placementOf(l, id)?.depth;

// 2번 선반: 월든(b07) | 여행의 이유(b08) | 채식주의자(b09) | 밝은 밤(b10) | 아몬드(b18) | 달러구트(b11, 아몬드에 기댐). 왼쪽 여유 약 45DU
// 3번 선반: 쌓기 더미(b12·b13) | 쇼코(b14) | 아무튼 서재(b15) | 우리가 빛의 속도로(b16). 왼쪽 여유 약 23DU
describe('한쪽 우선 비키기', () => {
  it('왼쪽 우선: 부딪히는 이웃을 모두 왼쪽으로 필요한 만큼만(오른쪽 책은 그대로)', () => {
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b03', { kind: 'insert', shelfId: 'shelf-2', index: 2, x: 175 }));
    const xs = bookXs(l, books);
    expect(xs.get('b03')).toBeCloseTo(175, 1);
    expect(order(l, 'shelf-2').slice(0, 4)).toEqual(['b07', 'b08', 'b09', 'b03']);
    expect(xs.get('b09')!).toBeLessThan(x0('b09'));
    expect(xs.get('b07')!).toBeLessThan(x0('b07'));
    for (const id of ['b10', 'b18', 'b11']) expect(xs.get(id)).toBeCloseTo(x0(id), 1);
  });

  it('왼쪽 공간이 모자라면 시작 배치에서 오른쪽으로(왼쪽 결과에 덧붙이지 않는다), 가리킨 자리는 그대로', () => {
    // 3번 선반 맨 왼쪽: 더미와 부딪히고 더미 왼쪽 여유가 없다 → 더미부터 오른쪽으로 연쇄
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b03', { kind: 'insert', shelfId: 'shelf-3', index: 0, x: 21 }));
    const xs = bookXs(l, books);
    expect(xs.get('b03')).toBeCloseTo(21, 1);
    expect(order(l, 'shelf-3')[0]).toBe('b03');
    const d = xs.get('b12')! - x0('b12');
    expect(d).toBeGreaterThan(0);
    expect(xs.get('b13')).toBeCloseTo(xs.get('b12')!, 6); // 더미는 통째로
    expect(xs.get('b14')! - x0('b14')).toBeGreaterThan(0);
  });

  it('기대는 책은 받치는 책과 같은 쪽으로 함께 움직인다', () => {
    const leaned = withLeans(SAMPLE_LAYOUT, books);
    expect(placementOf(leaned, 'b11')?.lean?.on).toBe('b18');
    const before = bookXs(leaned, books);
    const l = ok(moveBook(leaned, books, 'b03', { kind: 'insert', shelfId: 'shelf-2', index: 4, x: 246 }));
    const xs = bookXs(l, books);
    const d18 = xs.get('b18')! - before.get('b18')!;
    expect(Math.abs(d18)).toBeGreaterThan(1);
    expect(xs.get('b11')! - before.get('b11')!).toBeCloseTo(d18, 1);
  });

  it('양쪽 다 공간이 없으면 자리 없음(옮긴 책을 옆으로 비켜 끼우지 않는다)', () => {
    expect(moveBook(SAMPLE_LAYOUT, books, 'b07', { kind: 'insert', shelfId: 'shelf-3', index: 1, x: 190 })).toEqual({ ok: false, reason: 'no-space' });
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

  it('옮겨도 깊이는 그대로(같은 선반·다른 선반)', () => {
    const deep = ok(setDepth(SAMPLE_LAYOUT, books, 'b16', 120));
    const z = depthOf(deep, 'b16');
    const same = ok(moveBook(deep, books, 'b16', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: bookXs(deep, books).get('b16')! - 30 }));
    expect(depthOf(same, 'b16')).toBe(z);
    const other = ok(moveBook(deep, books, 'b16', { kind: 'insert', shelfId: 'shelf-1', index: 7, x: 330 }));
    expect(depthOf(other, 'b16')).toBe(z);
  });

  it('아주 조금 옮긴 자리도 그대로 저장한다', () => {
    const l = ok(moveBook(SAMPLE_LAYOUT, books, 'b16', { kind: 'insert', shelfId: 'shelf-3', index: 3, x: x0('b16') + 1.5 }));
    expect(bookXs(l, books).get('b16')).toBeCloseTo(x0('b16') + 1.5, 1);
  });
});
