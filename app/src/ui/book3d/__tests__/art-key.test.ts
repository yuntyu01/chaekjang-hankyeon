import type { Book, CoverArt } from '@/domain/types';
import { bookArtKey } from '../art-key';

const book: Book = { id: 'book', title: '제목', themeColor: '#885544', heightClass: 'medium', thicknessClass: 'medium', coverAspectRatio: 0.65, art: { motif: 'none' } };
const cover: CoverArt = { image: 1, titleTop: 0.2, ink: '#111111', edge: '#885544' };
const key = (b = book, c = cover) => bookArtKey(b, 1, { T: 20, H: 200, W: 130 }, c, null, null);

it('invalidates art when the image, crop, or artwork changes', () => {
  expect(key(book, { ...cover, image: 2 })).not.toBe(key());
  expect(key(book, { ...cover, focusY: 0.7 })).not.toBe(key());
  expect(key(book, { ...cover, artworkId: 'new-art' })).not.toBe(key());
});

it('invalidates ribbon count and body changes but ignores reading metadata', () => {
  expect(key({ ...book, art: { ...book.art, ribbonCount: 3 } })).not.toBe(key());
  expect(key({ ...book, body: { face: '#123456' } as Book['body'] })).not.toBe(key());
  expect(key({ ...book, startedAt: '2026-10-28' })).toBe(key());
  expect(key({ ...book })).toBe(key());
});
