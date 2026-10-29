import { migrate, normalize, validateStructure } from '../layout-schema';
import { validate } from '../layout-engine';
import { SAMPLE_BOOKS } from '../test-fixtures/interaction-books';
import type { ShelfLayout, ShelfLayoutV1 } from '../types';

const book = SAMPLE_BOOKS[0];
const books = { [book.id]: book };

it('migrates old saved poses without changing the save or losing placement fields', () => {
  const saved: ShelfLayoutV1 = {
    version: 1,
    shelves: [{ id: 'shelf-1', order: 9 }],
    placements: [{ bookId: book.id, shelfId: 'shelf-1', order: 4, pose: 'horizontal', tilt: 0, pos: 20, depth: 8, spin: 12, flip: true, overhang: true }],
  };
  const before = JSON.stringify(saved);
  const migrated = migrate(saved);
  expect(migrated).toEqual({
    version: 2,
    shelves: [{ id: 'shelf-1', order: 0 }],
    placements: [{ ...saved.placements[0], order: 0 }],
    drawer: [],
  });
  expect(normalize(migrated)).toEqual(migrated);
  expect(JSON.stringify(saved)).toBe(before);
});

it('separates saved-data integrity from spatial validation without weakening the engine API', () => {
  const outside: ShelfLayout = {
    version: 2,
    shelves: [{ id: 'shelf-1', order: 0 }],
    placements: [{ bookId: book.id, shelfId: 'shelf-1', order: 0, pose: 'spine', tilt: 0, depth: 10000 }],
    drawer: [],
  };
  expect(validateStructure(outside, books, [book.id])).toEqual([]);
  expect(validate(outside, books, [book.id])).toEqual(['no-space']);
  const duplicate = { ...outside, drawer: [book.id] };
  expect(validateStructure(duplicate, books)).toEqual([`duplicate:${book.id}`]);
  expect(validate(duplicate, books)).toEqual([`duplicate:${book.id}`]);
});
