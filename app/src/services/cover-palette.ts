// 표지 썸네일에서 주조색만 뽑는다(재장정 색 추출 전용). 이미지는 화면에 그리지 않고 저장하지도 않는다.
// Skia로 작은 화면 밖 표면에 줄여 그린 뒤 픽셀을 읽어 median cut(domain/rebinding.extractPalette). 실패하면 null(재장정은 제목 해시 색으로).
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';

import { extractPalette, type PaletteEntry } from '@/domain/rebinding';

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
