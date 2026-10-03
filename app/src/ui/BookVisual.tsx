import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { BASE_CAM } from '@/domain/camera';
import { frameBBox, standaloneFrame } from '@/domain/shelf-scene';
import { toShelfBook, type Library } from '@/domain/library';
import type { Book } from '@/domain/types';
import { BOOK_PAD, StandaloneBook } from '@/ui/book3d/StandaloneBook';

// Every screen uses the same saved book model and renderer as the bookshelf.
export const BookVisual = memo(function BookVisual({ book, width }: { book: Book; width: number }) {
  const scale = useMemo(() => width / (frameBBox(standaloneFrame(book, 'front'), BASE_CAM).width + BOOK_PAD * 2), [book, width]);
  return <View accessible accessibilityLabel={`${book.title} 표지`}><StandaloneBook book={book} pose="front" scale={scale} /></View>;
});

export function LibraryCover({ lib, id, width }: { lib: Library; id: string; width: number }) {
  const book = useMemo(() => toShelfBook(lib, id), [lib, id]);
  return book ? <BookVisual book={book} width={width} /> : null;
}
