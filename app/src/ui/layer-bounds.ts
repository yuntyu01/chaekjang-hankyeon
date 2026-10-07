// 레이어 크기 묶기(RN Skia 2.x: Group layer는 자르기보다 먼저 saveLayer(경계 없음)를 하므로 레이어 = 그때의 자르기 영역 크기)
import { Skia, type SkPath, type SkRect } from '@shopify/react-native-skia';

// 레이어 크기를 그 그림 둘레로 묶는 사각형(정수 px로 넓힘): RN Skia의 레이어(Group layer)는 그때의 자르기 영역 크기라,
// 이 사각형으로 먼저 자르지 않으면 캔버스 전체 크기 레이어가 프레임마다 생긴다
export function layerBounds(path: SkPath, pad = 2): SkRect {
  'worklet';
  const b = path.computeTightBounds();
  const x0 = Math.floor(b.x) - pad;
  const y0 = Math.floor(b.y) - pad;
  return Skia.XYWHRect(x0, y0, Math.ceil(b.x + b.width) + pad - x0, Math.ceil(b.y + b.height) + pad - y0);
}
