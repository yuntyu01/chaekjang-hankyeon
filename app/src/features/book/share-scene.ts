// 책 공유 카드 그림(2026-11-10 사용자 시안 '재질·빛비침·그림자 99% 동일하게', '물리법칙 안 맞춰도 돼, 어떤 책을 넣어도 빛 반사가 책 위에서 동일하게, 책 오버레이도'):
// 시안에서 책·글자를 지운 바탕(벽 질감·창빛 줄기·나무 선반)을 깔고, 그 위에 책 그림자(시안에서 맞춘 두 겹 흐린 그늘) → 책(표지 + 오버레이 + 속지 띠) → 글자를 그린다.
// 오버레이는 시안 책에서 뽑은 두 지도: 곱하는 빛 M(큰 빛 기울기·책등 홈·가장자리 그늘·종이 결)과 더하는 빛 A(왼쪽 위 은은한 빛·가장자리 반사).
// 표지 색 c에 out = grade(c)·M + A를 똑같이 적용하므로 어떤 표지든 빛이 같은 자리에 같은 세기로 든다.
// 좌표는 시안 화소(폭 941) 기준이고, 그릴 때 폭에 맞춰 줄인다. 앱(@shopify/react-native-skia)과 시험용 Node(CanvasKit + 같은 API)가 이 파일을 함께 쓴다:
// 그래서 다른 모듈을 import하지 않고 Skia API 객체를 인자로 받는다(타입만 가져온다).
import type { SkCanvas, SkImage, SkParagraph, SkTypefaceFontProvider, Skia as SkiaApi } from '@shopify/react-native-skia';

export const SCENE_W = 941; // 시안 폭(화소)
export const SCENE_H = 1671; // 시안 높이(9:16)

// 시안에서 잰 자리(화소)
const COVER_H = 616; // 표지 높이(시안 책)
const COVER_BOTTOM = 840; // 표지 아래 끝(선반 윗면 위)
const BOOK_CX = 468.5; // 책(표지+속지) 가운데
const COVER_MAX_W = 520; // 아주 넓은 책은 이 폭에 맞춰 높이를 줄인다
const PAGE_K = 0.57; // 속지 띠 폭 = 표지 높이 × 두께/높이 × 이 값(시안: 아몬드 두께/높이 0.07 → 24.6px)
const SHELF_TOP = 827; // 선반 윗면 뒤 끝
const SHELF_FRONT = 853; // 선반 윗면 앞 끝(앞면 시작)
// 벽 그림자(시안에서 맞춘 값, 밝기 오차 약 1%): 책 모양을 옮겨 흐린 세 겹(바로 옆 짙은 그늘 · 중간 · 멀리 옅게)
const SHADOW = [
  { a: 0.137, dx: 6.73, dy: 19.98, s: 11.27 },
  { a: 0.088, dx: 39.94, dy: 34.07, s: 11.88 },
  { a: 0.067, dx: 92.84, dy: 72.4, s: 20.01 },
];
// 표지 색감(시안 책은 실제 표지보다 채도가 높고 검정이 따뜻한 회색으로 뜬 무광 종이)
// 실제 아몬드 표지와 시안 표지의 분홍·빨강·검정 11곳을 짝지어 맞춘 값: 채도 1.42배, 감마 1.015, 밝기 0.978배, 검정을 따뜻한 회색(16,15,13)으로 띄움
export const GRADE = { sat: 1.42, gamma: 1.015, gain: 0.978, lift: [15.8, 15.0, 12.6] as [number, number, number] };

export const SHARE_FONTS = { title: 'ShareTitle', note: 'ShareNote', ui: 'ShareUI', uiMedium: 'ShareUIMedium' };

export type ShareSceneAssets = {
  plate: SkImage; // 바탕(941×1671)
  mul: SkImage; // 오버레이 M(회색, 값×128)
  add: SkImage; // 오버레이 A(회색, 값+64)
  pages: SkImage; // 속지 띠(RGBA, 시안에서 잘라 냄)
  shelfRight: SkImage; // 선반 윗면 책 오른쪽 그늘(곱하기, 200×27, 책 오른쪽 끝에 붙인다)
  shelfFront: SkImage; // 선반 윗면 책 앞 닿는 그늘(곱하기, 64×13, 책 폭에 맞춰 늘인다)
  cover: SkImage | null;
  fonts: SkTypefaceFontProvider;
};

export type ShareSceneInput = {
  title: string;
  author?: string;
  note?: string;
  rating?: number; // 0.5 단위
  extra?: string[]; // 독서 시간·읽은 기간(고른 것만)
  coverAspect: number; // 표지 폭/높이
  thicknessRatio?: number; // 두께/높이(속지 띠 폭)
  coverColor?: string; // 표지 그림이 없을 때(받는 중·사진 없음) 표지 색
};

type Layout = {
  height: number; // 장면 높이(시안 화소)
  cover: { x: number; y: number; w: number; h: number };
  pageW: number;
  title: SkParagraph;
  author: SkParagraph | null;
  note: SkParagraph | null;
  meta: SkParagraph | null;
  foot: SkParagraph;
  y: { title: number; author: number; note: number; stars: number; foot: number };
};

// 글자(시안에서 잰 크기·색, 화소)
const INK = { title: '#1B1B1B', author: '#5E5D5E', note: '#1E1E1E', star: '#7E7C7C', meta: '#7D7C7D', foot: '#161516', rule: '#D8D8D7' };
const TEXT_X = 89;
// 종이에 찍힌 글자처럼 아래로 아주 옅은 그늘(시안 글자 둘레)
export const TEXT_SHADOW = { a: 0.14, dy: 1.5, blur: 2 };
const TEXT_W = 760;

// 한글 낱말 단위 줄바꿈(ui/keep-all과 같은 규칙: 띄어쓰기 없는 글자 사이에 단어 이음표 U+2060). 이 파일은 다른 모듈을 쓰지 않아 여기 둔다
const keepAll = (t: string) => t.replace(/([^\s\u2060])(?=[^\s\u2060])/g, '$1\u2060');

function para(Skia: typeof SkiaApi, fonts: SkTypefaceFontProvider, text: string, family: string, size: number, color: string, lineHeight?: number) {
  const b = Skia.ParagraphBuilder.Make({ textStyle: { fontFamilies: [family], fontSize: size, color: Skia.Color(color) } }, fonts);
  b.pushStyle({
    fontFamilies: [family],
    fontSize: size,
    color: Skia.Color(color),
    ...(lineHeight ? { heightMultiplier: lineHeight / size } : {}),
    ...(TEXT_SHADOW.a > 0 ? { shadows: [{ color: Skia.Color(`rgba(0,0,0,${TEXT_SHADOW.a})`), offset: { x: 0, y: TEXT_SHADOW.dy }, blurRadius: TEXT_SHADOW.blur }] } : {}),
  });
  b.addText(keepAll(text));
  const p = b.build();
  p.layout(TEXT_W);
  return p;
}

export function layoutShareScene(Skia: typeof SkiaApi, input: ShareSceneInput, fonts: SkTypefaceFontProvider): Layout {
  // 책: 높이는 시안 책과 같게, 폭은 표지 비율. 너무 넓으면 폭을 묶고 높이를 줄인다
  let h = COVER_H;
  let w = h * input.coverAspect;
  if (w > COVER_MAX_W) {
    w = COVER_MAX_W;
    h = w / input.coverAspect;
  }
  const pageW = Math.max(10, Math.min(40, h * (input.thicknessRatio ?? 0.07) * PAGE_K));
  const x = BOOK_CX - (w + pageW) / 2;
  const cover = { x, y: COVER_BOTTOM - h, w, h };

  const title = para(Skia, fonts, input.title, SHARE_FONTS.title, 67, INK.title, 80);
  const author = input.author ? para(Skia, fonts, input.author, SHARE_FONTS.ui, 36, INK.author) : null;
  const note = input.note ? para(Skia, fonts, input.note, SHARE_FONTS.note, 48, INK.note, 70) : null;
  const metaText = [input.rating ? input.rating.toFixed(1) : null, ...(input.extra ?? [])].filter(Boolean).join('   ');
  const meta = metaText ? para(Skia, fonts, metaText, SHARE_FONTS.ui, 36, INK.meta) : null;
  const foot = para(Skia, fonts, '책장 한켠', SHARE_FONTS.uiMedium, 33, INK.foot);
  // 세로 흐름(시안에서 잰 간격, 글자 문단 위 끝): 제목 1017 → 12 → 저자 → 47 → 감상 → 60 → 별점 줄 → 152 → '책장 한켠'(시안 자리보다 위로는 올라가지 않는다)
  const y = { title: 1017, author: 0, note: 0, stars: 0, foot: 0 };
  let bottom = y.title + title.getHeight();
  y.author = bottom + 12;
  if (author) bottom = y.author + author.getHeight();
  y.note = bottom + 47;
  if (note) bottom = y.note + note.getHeight();
  y.stars = bottom + 60;
  if (input.rating || meta) bottom = y.stars + 43;
  y.foot = Math.max(1551, (input.rating || meta ? y.stars : bottom) + 152);
  const height = Math.max(SCENE_H, y.foot + 120);
  return { height, cover, pageW, title, author, note, meta, foot, y };
}

const COVER_SKSL = `
uniform shader cover;
uniform shader mulMap;
uniform shader addMap;
uniform float4 rect;
uniform float2 coverSize;
uniform float2 mapSize;
uniform float sat;
uniform float gamma;
uniform float gain;
uniform float3 lift;
half4 main(float2 p) {
  float2 uv = clamp((p - rect.xy) / rect.zw, 0.0, 1.0);
  half4 c = cover.eval(uv * coverSize);
  half g = dot(c.rgb, half3(0.299, 0.587, 0.114));
  half3 cc = clamp(mix(half3(g), c.rgb, half(sat)), 0.0, 1.0);
  cc = pow(cc, half3(gamma)) * half(gain);
  cc = half3(lift) + cc * (1.0 - half3(lift));
  half m = mulMap.eval(uv * mapSize).r * 2.0;
  half a = addMap.eval(uv * mapSize).r - 64.0 / 255.0;
  return half4(clamp(cc * m + a, 0.0, 1.0), 1.0);
}`;

let coverEffect: ReturnType<typeof SkiaApi.RuntimeEffect.Make> | null = null;

// 5각 별(시안 별: 끝이 조금 둥근 회색 별)
function starPath(Skia: typeof SkiaApi, cx: number, cy: number, R: number) {
  const b = Skia.PathBuilder.Make();
  const r = R * 0.5;
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    const px = cx + rr * Math.cos(ang);
    const py = cy + rr * Math.sin(ang);
    if (i === 0) b.moveTo(px, py);
    else b.lineTo(px, py);
  }
  b.close();
  return b.detach();
}

export function drawShareScene(Skia: typeof SkiaApi, canvas: SkCanvas, width: number, L: Layout, A: ShareSceneAssets, input: ShareSceneInput) {
  const k = width / SCENE_W;
  canvas.save();
  canvas.scale(k, k);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  // 1) 바탕: 시안 높이를 넘으면 아래 벽(글자 없는 띠)을 거울로 이어 붙인다
  canvas.drawImageRect(A.plate, Skia.XYWHRect(0, 0, SCENE_W, SCENE_H), Skia.XYWHRect(0, 0, SCENE_W, SCENE_H), paint);
  for (let y = SCENE_H, flip = true; y < L.height; y += 300, flip = !flip) {
    canvas.save();
    if (flip) {
      canvas.translate(0, 2 * y);
      canvas.scale(1, -1);
      canvas.drawImageRect(A.plate, Skia.XYWHRect(0, SCENE_H - 300, SCENE_W, 300), Skia.XYWHRect(0, y - 300, SCENE_W, 300), paint);
    } else {
      canvas.drawImageRect(A.plate, Skia.XYWHRect(0, SCENE_H - 300, SCENE_W, 300), Skia.XYWHRect(0, y, SCENE_W, 300), paint);
    }
    canvas.restore();
  }
  const c = L.cover;
  const R = c.x + c.w;
  const pw = L.pageW;
  // 책 모양(표지 + 속지 띠): 그림자에 쓴다
  const sil = Skia.PathBuilder.Make();
  sil.moveTo(c.x, c.y);
  sil.lineTo(R, c.y);
  sil.lineTo(R + pw, c.y + 3 + pw * 0.65);
  sil.lineTo(R + pw, c.y + c.h - pw * 0.43);
  sil.lineTo(R, c.y + c.h);
  sil.lineTo(c.x, c.y + c.h);
  sil.close();
  const silPath = sil.detach();
  // 2) 책 그림자(벽): 선반 윗면 뒤 끝 위로만
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(0, 0, SCENE_W, SHELF_TOP), 1, true);
  for (const s of SHADOW) {
    const sp = Skia.Paint();
    sp.setAntiAlias(true);
    sp.setColor(Skia.Color(`rgba(0,0,0,${s.a})`));
    sp.setMaskFilter(Skia.MaskFilter.MakeBlur(0, s.s, true));
    canvas.save();
    canvas.translate(s.dx, s.dy);
    canvas.drawPath(silPath, sp);
    canvas.restore();
  }
  canvas.restore();
  // 선반 윗면 그늘(시안에서 뜬 그림을 곱한다): 책 오른쪽 + 책 앞
  const mp = Skia.Paint();
  mp.setBlendMode(24); // Multiply
  canvas.drawImageRect(A.shelfRight, Skia.XYWHRect(0, 0, A.shelfRight.width(), A.shelfRight.height()), Skia.XYWHRect(R + pw, SHELF_TOP, 200, 27), mp);
  canvas.drawImageRect(A.shelfFront, Skia.XYWHRect(0, 0, A.shelfFront.width(), A.shelfFront.height()), Skia.XYWHRect(c.x, COVER_BOTTOM + 1, c.w + pw, 13), mp);
  // 3) 책: 표지(오버레이 셰이더) → 속지 띠
  if (!coverEffect) coverEffect = Skia.RuntimeEffect.Make(COVER_SKSL);
  const mapW = A.mul.width();
  const mapH = A.mul.height();
  const cp = Skia.Paint();
  cp.setAntiAlias(true);
  if (coverEffect) {
    // 표지 그림이 없으면(받는 중·사진 없음) 표지 색 한 가지에 같은 오버레이
    const src = A.cover ? A.cover.makeShaderOptions(0, 0, 1, 0) : Skia.Shader.MakeColor(Skia.Color(input.coverColor ?? '#D9D6D2'));
    const sw = A.cover ? A.cover.width() : 1;
    const shh = A.cover ? A.cover.height() : 1;
    const sh = coverEffect.makeShaderWithChildren(
      [c.x, c.y, c.w, c.h, sw, shh, mapW, mapH, GRADE.sat, GRADE.gamma, GRADE.gain, GRADE.lift[0] / 255, GRADE.lift[1] / 255, GRADE.lift[2] / 255],
      [src, A.mul.makeShaderOptions(0, 0, 1, 0), A.add.makeShaderOptions(0, 0, 1, 0)],
    );
    cp.setShader(sh);
  } else {
    cp.setColor(Skia.Color(input.coverColor ?? '#D9D6D2'));
  }
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(c.x, c.y, c.w, c.h), 3, 3), cp);
  canvas.drawImageRect(A.pages, Skia.XYWHRect(0, 0, A.pages.width(), A.pages.height()), Skia.XYWHRect(R - 0.5, c.y - 2, pw + 3 * (pw / 27), c.h + 4), paint);
  // 4) 글자
  L.title.paint(canvas, TEXT_X - 4, L.y.title);
  if (L.author) L.author.paint(canvas, TEXT_X, L.y.author);
  if (L.note) L.note.paint(canvas, TEXT_X - 1, L.y.note);
  let mx = TEXT_X + 3;
  if (input.rating) {
    const st = Skia.Paint();
    st.setAntiAlias(true);
    st.setColor(Skia.Color(INK.star));
    const R0 = 16.8;
    for (let i = 0; i < 5; i++) {
      const cx = mx + R0 + i * 43;
      const cy = L.y.stars + 16;
      const path = starPath(Skia, cx, cy, R0);
      const fill = Math.max(0, Math.min(1, input.rating - i));
      if (fill >= 1) canvas.drawPath(path, st);
      else {
        if (fill > 0) {
          canvas.save();
          canvas.clipRect(Skia.XYWHRect(cx - R0, cy - R0, R0 * 2 * fill, R0 * 2), 1, true);
          canvas.drawPath(path, st);
          canvas.restore();
        }
        const ol = Skia.Paint();
        ol.setAntiAlias(true);
        ol.setColor(Skia.Color(INK.star));
        ol.setStyle(1);
        ol.setStrokeWidth(1.6);
        canvas.drawPath(path, ol);
      }
    }
    mx += 5 * 43 + 18;
  }
  if (L.meta) L.meta.paint(canvas, mx - 3, L.y.stars - 4);
  // 맨 아래 '책장 한켠' + 양옆 줄
  const fw = L.foot.getMaxIntrinsicWidth();
  const fx = SCENE_W / 2 - fw / 2;
  L.foot.paint(canvas, fx, L.y.foot);
  const rp = Skia.Paint();
  rp.setColor(Skia.Color(INK.rule));
  canvas.drawRect(Skia.XYWHRect(296, L.y.foot + 22, 76, 2), rp);
  canvas.drawRect(Skia.XYWHRect(SCENE_W - 296 - 76, L.y.foot + 22, 76, 2), rp);
  canvas.restore();
}
