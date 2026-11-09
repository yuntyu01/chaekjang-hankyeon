// 갈피 공유 그림 두 가지(2026-11-10 사용자 시안 '두 버전으로 선택, 99% 동일하게, 글자만 넣으면 되니까 물리법칙은 고려 안 해도 돼'):
//  page: 펼친 책 한 쪽(왼쪽 제본 그늘·왼쪽 위 창빛, 종이에 찍힌 문장, 아래 '책 장 한 켠'과 쪽수)
//  note: 벽에 테이프로 붙인 찢은 종이(문장 왼쪽 정렬, 아래 책 제목·저자·쪽수, 벽 아래 '책장 한켠')
// 시안에서 글자를 지운 바탕(assets/share/bookmark-*.png) 위에 같은 자리·글꼴·색으로 글자만 얹는다. 좌표는 시안 화소(941×1672).
// 앱과 시험용 Node(CanvasKit)가 같이 쓰므로 다른 모듈을 import하지 않는다(share-scene과 같다)
import type { SkCanvas, SkImage, SkParagraph, SkTypefaceFontProvider, Skia as SkiaApi } from '@shopify/react-native-skia';

export const MARK_W = 941;
export const MARK_H = 1672;
export type MarkStyle = 'page' | 'note';
export const MARK_FONTS = { quote: 'MarkQuote', ui: 'MarkUI', uiBold: 'MarkUIBold', serif: 'MarkSerif' };

export type MarkInput = { text: string; title: string; author?: string; page?: number };

type Spec = {
  quote: { x: number; maxW: number; size: number; pitch: number; center: number; color: string; maxBottom: number; spacing: number };
  inkTop: number; // 글꼴 크기에 대한 문단 위 끝 → 글자 위 끝 거리(비율)
};

// 시안에서 잰 값(글자 상자, 화소)
const SPEC: Record<MarkStyle, Spec> = {
  page: { quote: { x: 193, maxW: 560, size: 68.5, pitch: 110, center: 725, color: '#24211E', maxBottom: 1150, spacing: 0.9 }, inkTop: 0 },
  note: { quote: { x: 155, maxW: 600, size: 72, pitch: 108, center: 811.5, color: '#2C2C2C', maxBottom: 1110, spacing: 0.8 }, inkTop: 0 },
};
export const SHADOWS = { light: { a: 0.6, dy: 1.6, blur: 1.2 }, dark: { a: 0.1, dy: -0.6, blur: 1 }, body: { a: 0, blur: 0.8 } };

const keepAll = (t: string) => t.replace(/([^\s⁠])(?=[^\s⁠])/g, '$1⁠');

function para(Skia: typeof SkiaApi, fonts: SkTypefaceFontProvider, text: string, o: { family: string; size: number; color: string; pitch?: number; spacing?: number; width?: number; align?: number; emboss?: boolean }) {
  const b = Skia.ParagraphBuilder.Make({ textAlign: o.align ?? 0, textStyle: { fontFamilies: [o.family], fontSize: o.size, color: Skia.Color(o.color) } }, fonts);
  b.pushStyle({
    fontFamilies: [o.family],
    fontSize: o.size,
    color: Skia.Color(o.color),
    ...(o.pitch ? { heightMultiplier: o.pitch / o.size } : {}),
    ...(o.spacing ? { letterSpacing: o.spacing } : {}),
    // 종이에 눌러 찍은 글자: 아래로 옅은 흰 테두리 + 위로 아주 옅은 그늘
    ...(o.emboss
      ? { shadows: [
          { color: Skia.Color(`rgba(255,255,255,${SHADOWS.light.a})`), offset: { x: 0, y: SHADOWS.light.dy }, blurRadius: SHADOWS.light.blur },
          { color: Skia.Color(`rgba(0,0,0,${SHADOWS.dark.a})`), offset: { x: 0, y: SHADOWS.dark.dy }, blurRadius: SHADOWS.dark.blur },
          // 마루부리 Regular와 SemiBold 사이 굵기(시안 잉크 양): 같은 색을 아주 얇게 번진다
          ...(SHADOWS.body.a > 0 ? [{ color: Skia.Color(o.color), offset: { x: 0, y: 0 }, blurRadius: SHADOWS.body.blur }] : []),
        ] }
      : {}),
  });
  b.addText(keepAll(text));
  const p = b.build();
  p.layout(o.width ?? 800);
  return p;
}

// 문장 줄 나누기(시안 '누구에게나 / 자기 자신에게로 / 가는 길이 있다.'처럼): 사용자가 넣은 줄바꿈은 그대로 두고, 각 문단은
// 가장 적은 줄 수 안에서 '가장 긴 줄'이 짧아지게 나눈다. 뒤 낱말을 꾸미는 짧은 낱말(두 글자 이하, '-는/-은/-의/-한/-던/-ㄹ' 끝) 뒤에서는 줄을 바꾸지 않는다
const GLUE = /^(.{1,2}|.*(는|은|의|한|던|할|될|된|운|른|을|를))$/;
function breakLines(words: string[], widthOf: (t: string) => number, maxW: number): string[] {
  const n = words.length;
  const cache = new Map<string, number>();
  const width = (a: number, b: number) => {
    const key = `${a}:${b}`;
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = widthOf(words.slice(a, b).join(' '))));
    return v;
  };
  type Best = { max: number; pen: number; cut: number[] } | null;
  for (let lines = 1; lines <= n; lines++) {
    // prev[i]: 처음 i 낱말을 k줄로 나눈 가장 좋은 방법(벌점이 적은 쪽, 같으면 가장 긴 줄이 짧은 쪽)
    let prev: Best[] = Array.from({ length: n + 1 }, () => null);
    prev[0] = { max: 0, pen: 0, cut: [] };
    for (let k = 1; k <= lines; k++) {
      const cur: Best[] = Array.from({ length: n + 1 }, () => null);
      for (let i = k; i <= n; i++) {
        for (let j = k - 1; j < i; j++) {
          const b = prev[j];
          if (!b) continue;
          const w = width(j, i);
          if (w > maxW && i - j > 1) continue;
          const pen = b.pen + (i < n && GLUE.test(words[i - 1]) ? 1 : 0);
          const max = Math.max(b.max, w);
          const c = cur[i];
          if (!c || pen < c.pen || (pen === c.pen && max < c.max)) cur[i] = { max, pen, cut: [...b.cut, i] };
        }
      }
      prev = cur;
    }
    const r = prev[n];
    if (r && (r.max <= maxW || lines === n)) {
      const out: string[] = [];
      let a = 0;
      for (const c of r.cut) {
        out.push(words.slice(a, c).join(' '));
        a = c;
      }
      return out;
    }
  }
  return [words.join(' ')];
}

const MAX_LINES = 6;
function quotePara(Skia: typeof SkiaApi, fonts: SkTypefaceFontProvider, s: Spec['quote'], text: string) {
  const maxH = 2 * (s.maxBottom - s.center);
  let last: { p: SkParagraph; size: number; pitch: number } | null = null;
  for (let size = s.size; size >= 40; size -= 3) {
    const pitch = (s.pitch * size) / s.size;
    const spacing = (s.spacing * size) / s.size;
    // 폭을 잴 때는 줄이 바뀌지 않게 아주 넓게 놓는다(800에 놓았더니 긴 줄이 저절로 접혀 짧게 재졌다)
    const widthOf = (t: string) => para(Skia, fonts, t, { family: MARK_FONTS.quote, size, color: s.color, spacing, width: 100000 }).getLongestLine();
    const broken = text
      .split('\n')
      .flatMap((line) => {
        const words = line.trim().split(/\s+/).filter(Boolean);
        return words.length ? breakLines(words, widthOf, s.maxW) : [''];
      })
      .join('\n');
    const p = para(Skia, fonts, broken, { family: MARK_FONTS.quote, size, color: s.color, pitch, width: 2000, spacing, emboss: true });
    last = { p, size, pitch };
    const lines = p.getLineMetrics().length;
    if (lines <= MAX_LINES && lines * pitch <= maxH && p.getLongestLine() <= s.maxW + 40) return last;
  }
  return last!;
}

export function drawMarkScene(Skia: typeof SkiaApi, canvas: SkCanvas, width: number, style: MarkStyle, plate: SkImage, fonts: SkTypefaceFontProvider, input: MarkInput) {
  const k = width / MARK_W;
  canvas.save();
  canvas.scale(k, k);
  const paint = Skia.Paint();
  canvas.drawImageRect(plate, Skia.XYWHRect(0, 0, plate.width(), plate.height()), Skia.XYWHRect(0, 0, MARK_W, MARK_H), paint);
  const spec = SPEC[style];
  const q = quotePara(Skia, fonts, spec.quote, input.text);
  // 문단 위 끝: 시안 첫 줄 글자 위 끝(page 585, note 671)과 맞도록 글자 크기 비례로 위로 당긴 값. 줄 수가 늘면 가운데를 지킨다
  const lineN = q.p.getLineMetrics().length;
  const blockH = lineN * q.pitch;
  const top = spec.quote.center - blockH / 2;
  q.p.paint(canvas, spec.quote.x - 3, top);
  const bottom = top + blockH;
  if (style === 'page') {
    const attr = [input.title, input.author].filter(Boolean).join(' · ');
    const a = para(Skia, fonts, attr, { family: MARK_FONTS.ui, size: 36, color: '#423E3B', width: 640, emboss: true });
    a.paint(canvas, 192, Math.min(bottom + 62, 1420));
    // 맨 아래 '책 장 한 켠'(넓은 자간) + 양옆 줄, 오른쪽 쪽수
    const f = para(Skia, fonts, '책장 한켠', { family: MARK_FONTS.ui, size: 22.5, color: '#423F3C', spacing: 2.2 });
    const fw = f.getLongestLine();
    f.paint(canvas, 471 - fw / 2 + 1, 1537);
    const lp = Skia.Paint();
    lp.setColor(Skia.Color('#ABA8A6'));
    canvas.drawRect(Skia.XYWHRect(351, 1553.5, 54, 1.4), lp);
    canvas.drawRect(Skia.XYWHRect(538, 1553.5, 53, 1.4), lp);
    if (input.page) {
      const pg = para(Skia, fonts, `p. ${input.page}`, { family: MARK_FONTS.serif, size: 31, color: '#3B3937', spacing: -1, emboss: true });
      pg.paint(canvas, 851 - pg.getLongestLine(), 1525);
    }
  } else {
    const t = para(Skia, fonts, input.title, { family: MARK_FONTS.uiBold, size: 42, color: '#2C2B2B', width: 520, emboss: true });
    t.paint(canvas, 154, 1193);
    if (input.author) para(Skia, fonts, input.author, { family: MARK_FONTS.ui, size: 34, color: '#65615F', width: 520, emboss: true }).paint(canvas, 154, 1252);
    if (input.page) {
      const pg = para(Skia, fonts, `p. ${input.page}`, { family: MARK_FONTS.ui, size: 34, color: '#69645F', emboss: true });
      pg.paint(canvas, 786 - pg.getLongestLine(), 1252);
    }
    const f = para(Skia, fonts, '책장 한켠', { family: MARK_FONTS.ui, size: 31, color: '#484443', spacing: 2 });
    const fw = f.getLongestLine();
    f.paint(canvas, 470 - fw / 2, 1545);
    const lp = Skia.Paint();
    lp.setColor(Skia.Color('#A8A3A2'));
    canvas.drawRect(Skia.XYWHRect(317, 1565.6, 67, 1.6), lp);
    canvas.drawRect(Skia.XYWHRect(557, 1565.6, 67, 1.6), lp);
  }
  canvas.restore();
}

export type { SkParagraph };
