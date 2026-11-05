import { emptyLibrary, toShelfBook, type Library } from '../library';
import { hasRibbon, ribbonDesign } from '../ribbon-design';

// 책장 갈피는 실제 갈피가 있는 책에만, 1개면 1장, 2개 이상이면 2장(2026-11-05 사용자)
const STAMP = '2026-11-05T00:00:00.000Z';
function libWith(marks: number): Library {
  const lib = emptyLibrary();
  lib.editions.e = { id: 'e', title: '책', authors: [], source: 'search', createdAt: STAMP, updatedAt: STAMP };
  lib.books.b = { id: 'b', editionId: 'e', status: 'reading', createdAt: STAMP, updatedAt: STAMP };
  for (let i = 0; i < marks; i++) lib.bookmarks[`m${i}`] = { id: `m${i}`, myBookId: 'b', text: `문장 ${i}`, createdAt: STAMP, updatedAt: STAMP } as Library['bookmarks'][string];
  return lib;
}

describe('책장 갈피 장 수는 실제 갈피 수를 따른다', () => {
  it.each([[0, 0], [1, 1], [2, 2], [3, 2], [12, 2]])('갈피 %i개면 %i장', (marks, tabs) => {
    const book = toShelfBook(libWith(marks), 'b')!;
    expect(hasRibbon(book)).toBe(tabs > 0);
    if (tabs > 0) expect(ribbonDesign(book).tabs).toHaveLength(tabs);
  });
});
