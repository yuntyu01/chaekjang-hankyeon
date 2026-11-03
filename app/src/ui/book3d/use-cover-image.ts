// 책 그림에 쓰는 표지·책등 사진 훅(services/cover-cache). Skia useImage와 달리 네트워크 실패에도 멈추지 않는다.
// 읽은 그림은 주소별로 메모리에 둔다: 같은 책을 다시 올릴 때(이동 캔버스·시트·격자) 첫 렌더부터 있어 책이 잠깐 비지 않고, 같은 파일을 책마다 다시 읽지 않는다.
// SkImage는 해석을 미루는 그림이라 상한은 권 수로 둔다(화면에 없는 것은 해석된 픽셀을 오래 잡지 않는다).
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

import { watchCover, type CoverState } from '@/services/cover-cache';

const MEMORY_MAX = 128;
const memory = new Map<string, SkImage>();
function remember(uri: string, image: SkImage) {
  memory.delete(uri);
  memory.set(uri, image);
  if (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

const decode = async (file: string): Promise<SkImage | null> => Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(file));
const READY_NONE: CoverState<SkImage> = { image: null, pending: false };

export function useCoverImage(uri: string | null): CoverState<SkImage> {
  const [got, setGot] = useState<{ uri: string | null } & CoverState<SkImage>>(() => ({ uri, image: uri ? memory.get(uri) ?? null : null, pending: !!uri && !memory.has(uri) }));
  useEffect(() => {
    if (!uri) return undefined;
    const hit = memory.get(uri);
    if (hit) {
      setGot((g) => (g.uri === uri && g.image === hit ? g : { uri, image: hit, pending: false }));
      return undefined;
    }
    return watchCover<SkImage>(uri, decode, (s) => {
      if (s.image) remember(uri, s.image);
      setGot({ uri, ...s });
    });
  }, [uri]);
  if (!uri) return READY_NONE;
  if (got.uri === uri) return got;
  const hit = memory.get(uri);
  return hit ? { image: hit, pending: false } : { image: null, pending: true };
}
