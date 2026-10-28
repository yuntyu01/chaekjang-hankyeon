import type { Book, CoverArt } from '@/domain/types';

export function bookArtKey(book: Book, scale: number, dims: { T: number; H: number; W: number }, cover: CoverArt, coverUri: string | null, spineUri: string | null) {
  // Serialize every binding field so crop/ribbon changes cannot reuse old art.
  return JSON.stringify([
    'material-shader-2', book.id, scale.toFixed(4), dims.T.toFixed(3), dims.H.toFixed(3), dims.W.toFixed(3),
    book.title, book.quotes ?? 0, book.themeColor, book.art, book.body, cover, coverUri, spineUri,
  ]);
}
