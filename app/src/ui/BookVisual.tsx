import { memo, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useCanvasRef } from '@shopify/react-native-skia';
import { useBookShared } from '@/ui/book3d/art';
import { frameBBox, standaloneFrame } from '@/domain/shelf-scene';
import { memoShelfBook, type Library } from '@/domain/library';
import type { Book } from '@/domain/types';
import { RealCover } from '@/ui/kit';
import { colors } from '@/ui/screenTheme';
import { BOOK_PAD, frameCam, noRibbon, StandaloneBook } from '@/ui/book3d/StandaloneBook';

// Every screen uses the same saved book model and renderer as the bookshelf.
export const BookVisual = memo(function BookVisual({ book, width, rasterize = false, onReady }: { book: Book; width: number; rasterize?: boolean; onReady?: () => void }) {
  // The protruding ribbon is a bookshelf count indicator, not part of a saved cover.
  // Keep the stored binding/art and the 3D engine intact in every presentation.
  const displayBook = useMemo(() => noRibbon(book), [book]);
  const bbox = useMemo(() => {
    const frame = standaloneFrame(displayBook, 'front');
    return frameBBox(frame, frameCam(frame));
  }, [displayBook]);
  const scale = width / (bbox.width + BOOK_PAD * 2);
  const canvas = useCanvasRef();
  const shared = useBookShared();
  // Some renderers also load reference glyphs; the base renderer only needs its font.
  const referenceReady = !('original' in shared) || !!shared.original;
  const [uri, setUri] = useState<string | null>(null);
  // 그림으로 굳힐 때만 내용 비교값을 만든다(목록마다 책 전체를 문자열로 만들지 않게)
  const revision = rasterize ? JSON.stringify(book) : '';
  useEffect(() => {
    if (!rasterize || !shared.regular || !referenceReady) return;
    let live = true;
    setUri(null);
    const timer = setTimeout(() => {
      void canvas.current?.makeImageSnapshotAsync().then((img) => {
        if (live) setUri(`data:image/png;base64,${img.encodeToBase64()}`);
      }).catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [rasterize, revision, width, shared.regular, referenceReady, canvas]);
  const edge = BOOK_PAD * scale;
  return <View accessible accessibilityLabel={`${book.title} 표지`}>
    <View pointerEvents="none" style={{ position: 'absolute', left: edge + 1, right: Math.max(0, edge - width * 0.018), top: edge + 3, bottom: edge, borderRadius: width * 0.025, backgroundColor: '#E8D8C0', borderRightWidth: 1, borderRightColor: '#F7ECDB', boxShadow: [{ offsetX: 1, offsetY: width * 0.043, blurRadius: width * 0.072, color: 'rgba(124,85,48,0.19)' }, { offsetX: 0, offsetY: 1, blurRadius: 1.2, color: 'rgba(87,63,40,0.18)' }] }} />
    <StandaloneBook book={displayBook} pose="front" scale={scale} canvasRef={canvas} />
    {rasterize && uri ? <Image source={{ uri }} resizeMode="contain" style={StyleSheet.absoluteFill} onLoad={onReady} /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', left: edge, top: edge, right: edge, bottom: edge, borderRadius: width * 0.025, overflow: 'hidden' }}>
      <Svg width="100%" height="100%">
        <Defs><LinearGradient id="coverSheen" x1="0" y1="0" x2="100%" y2="100%"><Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.045" /><Stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0" /><Stop offset="1" stopColor="#271A11" stopOpacity="0.025" /></LinearGradient></Defs>
        <Rect width="100%" height="100%" fill="url(#coverSheen)" />
        <Rect x="0.5" y="0.5" width={bbox.width * scale - 1} height={bbox.height * scale - 1} rx={width * 0.025} fill="none" stroke="#FFFAEC" strokeWidth="0.65" strokeOpacity="0.23" />
      </Svg>
    </View>
  </View>;
});

export function LibraryCover({ lib, id, width }: { lib: Library; id: string; width: number }) {
  const book = memoShelfBook(lib, id);
  return book ? <BookVisual book={book} width={width} /> : null;
}

// 다른 것에 연결된 책의 작은 표지(갈피의 책 고르기·책 고르기 시트 등): 실물 표지(도서 이미지·내가 찍은 사진)를 먼저,
// 사진이 없는 책만 책장과 같은 장정 그림(2026-11-01 사용자 '연결된 거 전부 실물로')
export function LinkedCover({ lib, id, width }: { lib: Library; id: string; width: number }) {
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  if (e?.coverUri) return <RealCover uri={e.coverUri} title={e.title} color={(b.bindingId && lib.bindings[b.bindingId]?.spineColor) || colors.input} width={width} />;
  return <LibraryCover lib={lib} id={id} width={width} />;
}
