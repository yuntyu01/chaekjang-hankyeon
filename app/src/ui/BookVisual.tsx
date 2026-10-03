import { memo, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useCanvasRef } from '@shopify/react-native-skia';
import { useBookShared } from '@/ui/book3d/art';
import { BASE_CAM } from '@/domain/camera';
import { frameBBox, standaloneFrame } from '@/domain/shelf-scene';
import { toShelfBook, type Library } from '@/domain/library';
import type { Book } from '@/domain/types';
import { BOOK_PAD, StandaloneBook } from '@/ui/book3d/StandaloneBook';

// Every screen uses the same saved book model and renderer as the bookshelf.
export const BookVisual = memo(function BookVisual({ book, width, rasterize = false, onReady }: { book: Book; width: number; rasterize?: boolean; onReady?: () => void }) {
  const scale = useMemo(() => width / (frameBBox(standaloneFrame(book, 'front'), BASE_CAM).width + BOOK_PAD * 2), [book, width]);
  const canvas = useCanvasRef();
  const shared = useBookShared();
  const [uri, setUri] = useState<string | null>(null);
  const revision = JSON.stringify(book);
  useEffect(() => {
    if (!rasterize || !shared.regular || !shared.original) return;
    let live = true;
    setUri(null);
    const timer = setTimeout(() => {
      void canvas.current?.makeImageSnapshotAsync().then((img) => {
        if (live) setUri(`data:image/png;base64,${img.encodeToBase64()}`);
      }).catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [rasterize, revision, width, shared.regular, shared.original, canvas]);
  return <View accessible accessibilityLabel={`${book.title} 표지`}>
    <StandaloneBook book={book} pose="front" scale={scale} canvasRef={canvas} />
    {rasterize && uri ? <Image source={{ uri }} resizeMode="contain" style={StyleSheet.absoluteFill} onLoad={onReady} /> : null}
  </View>;
});

export function LibraryCover({ lib, id, width }: { lib: Library; id: string; width: number }) {
  const book = useMemo(() => toShelfBook(lib, id), [lib, id]);
  return book ? <BookVisual book={book} width={width} /> : null;
}
