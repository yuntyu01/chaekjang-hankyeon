// 선반 판 이미지와 앞턱(책 앞을 가리는 판 앞면). ShelfRow와 파일럿(BoxShelf)이 같이 쓴다.
import { Image, View } from 'react-native';

import { DESIGN_WIDTH, SHELF, SHELF_IMG_H, SHELF_IMG_W, SHELF_IMG_X } from '@/domain/geometry';
import { SHELF_ASSET } from '@/domain/shelf-asset.generated';
import { ShelfShadow } from '@/ui/shelf/ShelfShadow';

// 선반 한 칸 이미지(나무판만, 바깥 그림자 분리본). 원본 비율 유지, 책 밑면 기준선(contactY)이 이 줄의 바닥에 오도록 놓는다.
// 바깥 그림자는 ShelfShadow의 접촉층과 긴 감쇠층이 판 아래에 그린다.
const SHELF_PNG = require('../../../assets/bookshelf/shelf-plank.png');

export function ShelfImage({ scale: s, clear }: { scale: number; clear: number }) {
  const top = (clear - SHELF.contact) * s;
  return (
    <>
      <ShelfShadow
        plankLeft={(SHELF_IMG_X + SHELF_ASSET.plankLeft * SHELF_IMG_W) * s}
        plankRight={(SHELF_IMG_X + SHELF_ASSET.plankRight * SHELF_IMG_W) * s}
        plankTop={top + SHELF_ASSET.plankTop * SHELF_IMG_H * s}
        plankBottom={top + SHELF_ASSET.plankBottom * SHELF_IMG_H * s}
        scale={s}
      />
      <Image
      source={SHELF_PNG}
      style={{ position: 'absolute', left: SHELF_IMG_X * s, top, width: SHELF_IMG_W * s, height: SHELF_IMG_H * s }}
      resizeMode="stretch"
    />
    </>
  );
}

// The front face occludes everything behind the lip, including cast shadows.
// Reuse the same image so the grain and lighting stay aligned with the top.
export function ShelfFront({ scale: s, clear }: { scale: number; clear: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: (clear + SHELF.lip) * s,
      width: DESIGN_WIDTH * s, height: (SHELF.below - SHELF.lip + 0.5) * s, overflow: 'hidden' }}>
      <Image source={SHELF_PNG} resizeMode="stretch" style={{ position: 'absolute', left: SHELF_IMG_X * s,
        top: -SHELF_ASSET.frontTopY * SHELF_IMG_H * s, width: SHELF_IMG_W * s, height: SHELF_IMG_H * s }} />
    </View>
  );
}

