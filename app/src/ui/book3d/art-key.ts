import type { Book, CoverArt } from '@/domain/types';

// spineLook: 측면 모양(scene-config/spine-look). 실물 표지가 없는 책은 모양과 상관없이 같은 그림이라 열쇠에 넣지 않는다
export function bookArtKey(book: Book, scale: number, dims: { T: number; H: number; W: number }, cover: CoverArt, coverUri: string | null, spineUri: string | null, spineLook = 'color') {
  // Serialize every binding field so crop/ribbon changes cannot reuse old art.
  return JSON.stringify([
    'material-shader-2', book.seedId ?? book.id, scale.toFixed(4), dims.T.toFixed(3), dims.H.toFixed(3), dims.W.toFixed(3),
    book.title, book.quotes ?? 0, book.themeColor, book.art, book.body, cover, coverUri, spineUri, coverUri ? spineLook : 'color',
  ]);
}
