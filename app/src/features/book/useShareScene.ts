// 공유 카드 장면 재료(시안 바탕·책 오버레이·선반 그늘 그림, 글꼴, 표지)를 불러온다. 다 모이면 assets가 생긴다.
// 표지는 책장과 같은 표지 보관(cover-cache)으로 받는다(Skia useImage로 원격 그림을 받으면 오프라인에서 멈춘다)
import { Skia, useFonts, useImage } from '@shopify/react-native-skia';
import { useMemo } from 'react';

import { coverAtSize } from '@/domain/cover-url';
import type { Book } from '@/domain/types';
import { useCoverImage } from '@/ui/book3d/use-cover-image';
import { drawShareScene, layoutShareScene, SCENE_W, type ShareSceneAssets, type ShareSceneInput } from './share-scene';
import type { BookShareData, ShareParts } from './book-share';

const FONT_SOURCES = {
  ShareTitle: [require('../../../assets/fonts/MaruBuri-SemiBold.ttf')],
  ShareNote: [require('../../../assets/fonts/MaruBuri-Regular.ttf')],
  ShareUI: [require('../../../assets/fonts/Pretendard-Regular.otf')],
};

export type ShareScene = { assets: ShareSceneAssets | null; coverWaiting: boolean };

export function useShareScene(book: Book | undefined): ShareScene {
  const plate = useImage(require('../../../assets/share/plate.png'));
  const mul = useImage(require('../../../assets/share/book-mul.png'));
  const add = useImage(require('../../../assets/share/book-add.png'));
  const pages = useImage(require('../../../assets/share/book-pages.png'));
  const shelfRight = useImage(require('../../../assets/share/shelf-right.png'));
  const shelfFront = useImage(require('../../../assets/share/shelf-front.png'));
  const shade = useImage(require('../../../assets/share/book-shade.png'));
  const fonts = useFonts(FONT_SOURCES);
  const uri = coverAtSize(book?.coverArtUri ?? book?.originalCoverUri, 'XL') ?? null;
  const cover = useCoverImage(uri);
  const assets = useMemo(
    () => (plate && mul && add && pages && shelfRight && shelfFront && shade && fonts ? { plate, mul, add, pages, shelfRight, shelfFront, shade, fonts, cover: cover.image } : null),
    [plate, mul, add, pages, shelfRight, shelfFront, shade, fonts, cover.image],
  );
  return { assets, coverWaiting: !!uri && !cover.image };
}

// 카드에 넣을 내용(고른 것만). 표지 비율·두께는 책장에 그리는 책과 같은 값
export function shareInputOf(data: BookShareData, parts: ShareParts): ShareSceneInput {
  const b = data.book;
  const h = b.dims?.height;
  return {
    title: data.title,
    author: data.author,
    note: parts.note ? data.note : undefined,
    rating: parts.rating && data.rating ? data.rating : undefined,
    extra: [parts.time ? data.readTime : undefined, parts.period ? data.period : undefined].filter((v): v is string => !!v),
    coverAspect: b.coverAspectRatio || (b.dims?.coverWidth && h ? b.dims.coverWidth / h : 0.68),
    thicknessRatio: b.dims?.thickness && h ? b.dims.thickness / h : undefined,
    coverColor: b.themeColor,
  };
}

// 공유 이미지(PNG base64): 화면 뷰를 뜨지 않고 같은 그림을 정해진 폭으로 바로 그린다
export function renderShareCardBase64(assets: ShareSceneAssets, input: ShareSceneInput, pxWidth = 1080): string | null {
  const L = layoutShareScene(Skia, input, assets.fonts);
  const h = Math.round((L.height * pxWidth) / SCENE_W);
  const surface = Skia.Surface.Make(pxWidth, h);
  if (!surface) return null;
  drawShareScene(Skia, surface.getCanvas(), pxWidth, L, assets, input);
  surface.flush();
  return surface.makeImageSnapshot().encodeToBase64();
}
