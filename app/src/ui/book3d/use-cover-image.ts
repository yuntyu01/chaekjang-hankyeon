// 책 그림에 쓰는 표지·책등 사진 훅(services/cover-cache). Skia useImage와 달리 네트워크 실패에도 멈추지 않는다.
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import { watchCover, type CoverState } from '@/services/cover-cache';

const decode = async (file: string): Promise<SkImage | null> => Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(file));

export function useCoverImage(uri: string | null): CoverState<SkImage> {
  const [got, setGot] = useState<{ uri: string | null } & CoverState<SkImage>>({ uri: null, image: null, pending: false });
  useEffect(() => watchCover<SkImage>(uri, decode, (s) => setGot({ uri, ...s })), [uri]);
  // 주소가 막 바뀐 첫 그림에서는 아직 확인 전이다
  return got.uri === uri ? got : { image: null, pending: !!uri };
}
