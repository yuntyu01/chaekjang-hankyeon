// 책장 틀이 있으면(기본 스킨) 옆판에 막혀 책이 판 끝 밖으로 걸치지 않는다. 틀이 없는 스킨의 걸침은 fall-rest 시험
import { placementOf, type BookMap } from '../layout-engine';
import { withLeans } from '../shelf-scene';
import { FRAME_ON } from '@/scene-config/skin';
import type { Book, BookPlacement } from '../types';

const book = (id: string, height: number, thickness: number): Book => ({
  id,
  title: id,
  themeColor: '#CCBBAA',
  heightClass: 'medium',
  thicknessClass: 'medium',
  coverAspectRatio: 0.7,
  art: { motif: 'leaf' },
  dims: { height, thickness },
}) as Book;
const place = (bookId: string, order: number, pos: number, tilt: -7 | 0 | 7 = 0): BookPlacement => ({ bookId, shelfId: 's', order, pose: 'spine', tilt, pos });

it('기본 스킨은 움푹 파인 책장이다', () => {
  expect(FRAME_ON).toBe(true);
});

it('왼쪽으로 넘어진 책이 안에 못 들어가면 판 끝에 걸치지 않고 서랍으로 간다', () => {
  // D가 왼쪽 C에 기대 있다가 C를 빼면 왼쪽으로 넘어진다. E가 막고 있어 안쪽에 눕힐 자리가 없다(틀이 없으면 판 끝에 걸치는 자리: fall-rest)
  const books: BookMap = { C: book('C', 120, 34), D: book('D', 160, 30), E: book('E', 150, 30) };
  const before = withLeans({ version: 2, shelves: [{ id: 's', order: 0 }], placements: [place('C', 0, 50), place('D', 1, 114, -7), place('E', 2, 156)], drawer: [] }, books);
  const after = withLeans({ ...before, placements: before.placements.filter((p) => p.bookId !== 'C') }, books);
  expect(after.drawer).toEqual(['D']);
  expect(placementOf(after, 'D')).toBeUndefined();
});
