// 책 크기가 바뀌어도 사용자가 둔 책 사이 틈은 그대로: 얇아진 만큼 옆 책을 당기고, 겹치게 두지 않는다
import { bookXs, keepGaps, normalize, type BookMap } from '../layout-engine';
import type { Book, ShelfLayout } from '../types';

const book = (id: string, thickness: number): Book => ({ id, title: id, themeColor: '#888888', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.7, art: { motif: 'none' }, dims: { height: 170, coverWidth: 110, thickness } } as Book);
const place = (bookId: string, pos: number) => ({ bookId, shelfId: 's', pose: 'spine' as const, tilt: 0 as const, pos });

it('얇아지면 뒤 책을 당기고 원래 틈은 남긴다', () => {
  const before: BookMap = { a: book('a', 30), b: book('b', 30), c: book('c', 30) };
  const after: BookMap = { a: book('a', 10), b: book('b', 12), c: book('c', 30) };
  const layout = normalize({ version: 2, shelves: [{ id: 's', order: 0 }], placements: [place('a', 5), place('b', 35), place('c', 75)], drawer: [] } as unknown as ShelfLayout);
  const xs = bookXs(keepGaps(layout, before, after), after);
  expect(xs.get('a')).toBeCloseTo(5, 3); // 왼쪽 여백 5 그대로
  expect(xs.get('b')).toBeCloseTo(15, 3); // a 바로 옆(틈 0 그대로)
  expect(xs.get('c')).toBeCloseTo(37, 3); // b와의 틈 10 그대로
});
