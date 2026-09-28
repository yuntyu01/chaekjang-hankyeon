// 선반 판 이미지와 앞턱(책 앞을 가리는 판 앞면). ShelfRow가 쓴다.
import { Image, View } from 'react-native';

import { DESIGN_WIDTH, SHELF, SHELF_IMG_W, SHELF_IMG_X } from '@/domain/geometry';
import { SHELF_ASSET } from '@/domain/shelf-asset.generated';
import { ShelfShadow } from '@/ui/shelf/ShelfShadow';
import { plankLight } from '@/ui/theme';

// 선반 판: 3D 판(앞 모서리 z=-SHELF_FRONT ~ 벽 z=SHELF_DEPTH)을 책과 같은 카메라로 투영한 자리에 PNG를 붙인다.
// PNG는 자체 시점으로 그려져 있어서 윗면 띠와 앞면 띠를 따로 잘라 각 자리에 맞춘다(윗면 = 투영된 깊이, 앞면 = PNG 두께 그대로).
// 나뭇결이 가로라 윗면을 세로로 늘려도 티가 나지 않는다. 바깥 그림자는 ShelfShadow가 판 아래에 그린다.
const SHELF_PNG = require('../../../assets/bookshelf/shelf-plank.png');

// PNG의 [y0, y1] 띠(이미지 높이 비율)를 화면 [top, top+h](px)에 맞춰 잘라 붙인다
function Band({ s, y0, y1, top, h }: { s: number; y0: number; y1: number; top: number; h: number }) {
  const ih = h / (y1 - y0);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top, width: DESIGN_WIDTH * s, height: h, overflow: 'hidden' }}>
      <Image source={SHELF_PNG} resizeMode="stretch" style={{ position: 'absolute', left: SHELF_IMG_X * s, top: -y0 * ih, width: SHELF_IMG_W * s, height: ih }} />
    </View>
  );
}

export function ShelfImage({ scale: s, clear }: { scale: number; clear: number }) {
  const back = (clear - SHELF.back) * s;
  const lip = (clear + SHELF.lip) * s;
  const bottom = (clear + SHELF.below) * s;
  return (
    <>
      <ShelfShadow
        plankLeft={(SHELF_IMG_X + SHELF_ASSET.plankLeft * SHELF_IMG_W) * s}
        plankRight={(SHELF_IMG_X + SHELF_ASSET.plankRight * SHELF_IMG_W) * s}
        plankTop={back}
        plankBottom={bottom}
        scale={s}
      />
      <Band s={s} y0={SHELF_ASSET.plankTopY} y1={SHELF_ASSET.frontTopY} top={back} h={lip - back} />
      <Band s={s} y0={SHELF_ASSET.frontTopY} y1={SHELF_ASSET.frontBottomY} top={lip} h={bottom - lip} />
      {/* 윗면 살짝 밝게 */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: (SHELF_IMG_X + SHELF_ASSET.plankLeft * SHELF_IMG_W) * s,
          width: (SHELF_ASSET.plankRight - SHELF_ASSET.plankLeft) * SHELF_IMG_W * s,
          top: back,
          height: lip - back,
          backgroundColor: `rgba(255,255,255,${plankLight.top})`,
          borderRadius: 2 * s,
        }}
      />
    </>
  );
}

// The front face occludes everything behind the lip, including cast shadows.
// Reuse the same image so the grain and lighting stay aligned with the top.
export function ShelfFront({ scale: s, clear }: { scale: number; clear: number }) {
  const lip = (clear + SHELF.lip) * s;
  const bottom = (clear + SHELF.below) * s;
  return (
    <>
      <Band s={s} y0={SHELF_ASSET.frontTopY} y1={SHELF_ASSET.frontBottomY} top={lip} h={bottom - lip + 0.5 * s} />
      {/* 앞면 살짝 어둡게 */}
      <View pointerEvents="none" style={{ position: 'absolute', left: (SHELF_IMG_X + SHELF_ASSET.plankLeft * SHELF_IMG_W) * s, top: lip,
        width: (SHELF_ASSET.plankRight - SHELF_ASSET.plankLeft) * SHELF_IMG_W * s, height: bottom - lip + 0.5 * s, backgroundColor: `rgba(59,51,48,${plankLight.front})` }} />
    </>
  );
}
