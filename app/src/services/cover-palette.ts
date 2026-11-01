// 표지 썸네일에서 주조색만 뽑는다(재장정 색 추출 전용). 이미지는 화면에 그리지 않고 저장하지도 않는다.
// Skia로 작은 화면 밖 표면에 줄여 그린 뒤 픽셀을 읽어 median cut(domain/rebinding.extractPalette). 실패하면 null(재장정은 제목 해시 색으로).
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import { edgeColorOf, extractPalette, type PaletteEntry } from '@/domain/rebinding';

const W = 24;
const H = 36;

export async function coverPalette(url: string | undefined): Promise<PaletteEntry[] | null> {
  if (!url || !/^(https?:|file:|data:)/.test(url)) return null;
  try {
    const data = await Skia.Data.fromURI(url);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return null;
    const surface = Skia.Surface.MakeOffscreen(W, H);
    if (!surface) return null;
    surface.getCanvas().drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, W, H), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!px) return null;
    const palette = extractPalette(px as ArrayLike<number>, 3);
    return palette.length ? palette : null;
  } catch {
    return null;
  }
}

// 표지 왼쪽 가장자리 띠의 주된 색(책등과 맞닿는 쪽). 맨 끝 1.5%는 스캔 테두리·JPEG 번짐이 있어 건너뛴다. 실패하면 null
const EDGE_W = 12;
const EDGE_H = 96;
export async function coverEdgeColor(url: string | undefined): Promise<string | null> {
  if (!url || !/^(https?:|file:|data:)/.test(url)) return null;
  try {
    const data = await Skia.Data.fromURI(url);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return null;
    const surface = Skia.Surface.MakeOffscreen(EDGE_W, EDGE_H);
    if (!surface) return null;
    surface.getCanvas().drawImageRect(img, Skia.XYWHRect(img.width() * 0.015, 0, img.width() * 0.07, img.height()), Skia.XYWHRect(0, 0, EDGE_W, EDGE_H), Skia.Paint());
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, { width: EDGE_W, height: EDGE_H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    return px ? edgeColorOf(px as ArrayLike<number>) : null;
  } catch {
    return null;
  }
}
