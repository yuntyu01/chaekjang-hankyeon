// 갈피 공유 이미지: 아이보리 종이 카드에 문장, 책 제목·저자·쪽수, 왼쪽 얇은 책 색 띠. 개인 메모는 기본으로 넣지 않는다.
// Skia로 화면 밖 표면에 그려 PNG 파일로 저장한 뒤 공유 창을 연다.
import { Skia, TextAlign, type SkTypeface } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type CardInput = { text: string; title: string; author?: string; page?: number; memo?: string; color: string };

const W = 1080;
const H = 1350;
const INK = '#1F2533';
const SOFT = '#6E6B66';
const PAPER = '#FBF7F0';

function paragraph(provider: ReturnType<typeof Skia.TypefaceFontProvider.Make>, text: string, size: number, color: string, lh: number, width: number, align = TextAlign.Left) {
  const p = Skia.ParagraphBuilder.Make({ textAlign: align }, provider)
    .pushStyle({ fontFamilies: ['Gowun'], fontSize: size, color: Skia.Color(color), heightMultiplier: lh })
    .addText(text)
    .build();
  p.layout(width);
  return p;
}

export function drawCard(input: CardInput, regular: SkTypeface) {
  const surface = Skia.Surface.MakeOffscreen(W, H) ?? Skia.Surface.Make(W, H);
  if (!surface) throw new Error('이미지를 만들 표면을 열지 못했어요');
  const c = surface.getCanvas();
  const provider = Skia.TypefaceFontProvider.Make();
  provider.registerFont(regular, 'Gowun');
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(PAPER));
  c.drawRect(Skia.XYWHRect(0, 0, W, H), paint);
  paint.setColor(Skia.Color(input.color));
  c.drawRect(Skia.XYWHRect(0, 0, 18, H), paint);
  const left = 130;
  const width = W - left - 110;
  // 문장이 길면 글자를 줄여 카드 안에 넣는다(최소 34px)
  let size = 54;
  let quote = paragraph(provider, input.text, size, INK, 1.8, width);
  const maxH = H - 520;
  while (quote.getHeight() > maxH && size > 34) {
    size -= 3;
    quote = paragraph(provider, input.text, size, INK, 1.8, width);
  }
  const quoteH = Math.min(quote.getHeight(), maxH);
  const top = Math.max(180, (H - quoteH - 260) / 2);
  c.save();
  c.clipRect(Skia.XYWHRect(left, top - 10, width, maxH + 20), 1, true);
  quote.paint(c, left, top);
  c.restore();
  let y = top + quoteH + 70;
  paint.setColor(Skia.Color(input.color));
  c.drawRect(Skia.XYWHRect(left, y, 64, 3), paint);
  y += 34;
  const src = paragraph(provider, `${input.title}`, 34, INK, 1.4, width);
  src.paint(c, left, y);
  y += src.getHeight() + 6;
  const meta = [input.author, input.page ? `${input.page}쪽` : null].filter(Boolean).join(' · ');
  if (meta) {
    const m = paragraph(provider, meta, 28, SOFT, 1.4, width);
    m.paint(c, left, y);
    y += m.getHeight() + 6;
  }
  if (input.memo) {
    const m = paragraph(provider, input.memo, 28, SOFT, 1.5, width);
    m.paint(c, left, y + 20);
  }
  const mark = paragraph(provider, '책장 한켠', 26, '#9A958C', 1.2, W - 220, TextAlign.Right);
  mark.paint(c, 110, H - 110);
  surface.flush();
  return surface.makeImageSnapshot();
}

export async function shareCard(input: CardInput, regular: SkTypeface) {
  const img = drawCard(input, regular);
  const b64 = img.encodeToBase64();
  const uri = `${FS.cacheDirectory}gallpi_${Date.now().toString(36)}.png`;
  await FS.writeAsStringAsync(uri, b64, { encoding: FS.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) return { ok: false as const, uri };
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '갈피 공유' });
  return { ok: true as const, uri };
}
