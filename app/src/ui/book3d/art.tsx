// 책 면 그림과 조판을 Skia Picture로 한 번 기록해 두고(책·배율마다 캐시), 매 프레임은 면 변환만 바꿔 그린다.
// - 책등 면: 무광 바탕과 미세한 명암. 작은 장식은 제목과 함께 자세별로 기록한다.
// - 책등 제목: 조판 두 가지를 따로 기록한다. 세운 책등은 세로(글자를 바로 세워 쌓음), 눕힌 책등은 가로 한 줄.
//   둘 다 책등 면 그림 좌표에 고정되어 몸체와 함께 돈다(글자를 따로 돌리지 않는다). 어느 쪽을 보일지는 자세가 정한다(BookNode).
// - 표지 면: 표지 그림(달·풍경 등) + 제목(시안처럼 제목만. 저자는 표지에 쓰지 않는다)
// - 갈피: 머리 뒤에서 나오는 끈(원점 = 아래 가운데)
import { ColorType, AlphaType, Group, Image as SkiaImage, PaintStyle, StrokeJoin, ImageSVG, Path, Picture, Rect, Skia, Text, drawAsPicture, useImage, useTypeface, type SkFont, type SkImage, type SkPath, type SkPicture, type SkTypeface } from '@shopify/react-native-skia';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { rgbHex, tabColors, TITLE_LIGHT, titleInk } from '@/domain/color';
import { COVER_ARTWORKS } from '@/domain/cover-artworks';
import { COVER_LINE_H, COVER_SPACE, COVER_TRACK, coverTitleLayout, LYING_TRACK, lyingTitleLayout, SPINE_SPACE, spineTitleLayout } from '@/domain/title-layout';
import type { Book, CoverArt } from '@/domain/types';
import { motifSvg } from '@/ui/art/motifs';
import { bootMark } from '@/ui/boot-trace';
import { GROOVE, rigOf, TAB_R } from '@/domain/book-parts';
import { jacketColor, jacketFor, LANDSCAPES } from '@/domain/book-design';
import { hasRibbon, ribbonDesign } from '@/domain/ribbon-design';
import { bookFacePath, CoverFaceArt, PAGE_BASE, SpineFaceArt } from '@/ui/book/BookBody';
import { ReferenceCover } from './ReferenceCover';
import { ReferenceBinding } from './ReferenceBinding';
import { bookTone, referenceBinding } from '@/domain/binding-material';
import { useLibrary } from '@/store/library-store';
import { placementStore } from '@/store/placement-store';
import { TL, tl } from '@/ui/perf';
import { ORIGINAL_ART, ReferenceGlyph, ReferenceMotif, ReferencePrint, drawOriginalGlyph, hasOriginalGlyph, hasReferenceMotif, referencePrint } from './ReferencePrint';
import { createArtCache } from './art-cache';
import { bookArtKey } from './art-key';

// 책 제목 글꼴: 함렛 SemiBold(2026-10-31 사용자 선택: 고운바탕·나눔스퀘어라운드·주아·함렛을 책장에 넣어 비교. assets/fonts/README.md).
// 고운바탕 Regular는 가로획이 가늘어 책등에서 실처럼 보였다. 한글은 전각(나아가기 폭 1em)이라 제목 맞추기(title-layout)는 그대로다.
// Shared.regular는 이 글꼴이다(이름만 예전 그대로)
const REGULAR = require('../../../assets/fonts/Hahmlet-SemiBold.ttf');

// 굵기는 글꼴 굵기로 정한다(덧그리기 TITLE_WEIGHT 0). Skia에는 이 글꼴 하나만 읽는다
// artworks: 기본 정면 장정 그림(cover-artworks) 여섯 장. 앱을 켤 때 한 번 읽어 모든 책이 같이 쓴다
// (책마다 따로 읽으면 그 책만 몇 초 늦게 나타나 책장에 빈자리가 보였다)
export type Shared = { regular: SkTypeface | null; original: SkImage | null; artworks: Record<string, SkImage | null> };
const Ctx = createContext<Shared>({ regular: null, original: null, artworks: {} });
const NOT_READY: Shared = { regular: null, original: null, artworks: {} };
const ShelfCtx = createContext<Shared>(NOT_READY);

// 앱 뿌리에 한 번: 제목 글꼴, 시안 원본 그림, 기본 정면 장정 그림.
// 장정 그림은 지금 책에 입힌 것부터 읽고 나머지는 그 뒤에 읽는다(여섯 장을 한꺼번에 풀면 에뮬레이터에서 그 책만 5초쯤 늦게 나타났다).
// onReady: 첫 책장에 필요한 것(글꼴·원본 그림·입힌 장정 그림)이 다 준비됨. 뿌리가 그때까지 시작 화면을 덮어 둔다
export function BookArtProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
  const regular = useTypeface(REGULAR);
  const original = useImage(ORIGINAL_ART);
  const { lib } = useLibrary();
  const used = useMemo(() => new Set(Object.values(lib.bindings).map((b) => b.coverArtId)), [lib.bindings]);
  const [rest, setRest] = useState(false);
  const want = (i: number) => (rest || used.has(COVER_ARTWORKS[i].id) ? COVER_ARTWORKS[i].image : null);
  // 훅 순서가 바뀌지 않게 여섯 장을 고정 순서로 읽는다(아직 안 읽을 그림은 null)
  const a0 = useImage(want(0));
  const a1 = useImage(want(1));
  const a2 = useImage(want(2));
  const a3 = useImage(want(3));
  const a4 = useImage(want(4));
  const a5 = useImage(want(5));
  const images = [a0, a1, a2, a3, a4, a5];
  const artworks = useMemo(() => Object.fromEntries(COVER_ARTWORKS.map((a, i) => [a.id, [a0, a1, a2, a3, a4, a5][i] ?? null])), [a0, a1, a2, a3, a4, a5]);
  const usedReady = COVER_ARTWORKS.every((a, i) => !used.has(a.id) || !!images[i]);
  const ready = !!regular && !!original && usedReady;
  useEffect(() => {
    if (regular) bootMark('skia-font-regular');
  }, [regular]);
  useEffect(() => {
    if (!ready) return;
    bootMark('book-art-ready');
    // 책 그림은 캔버스 안(따로 도는 렌더러)에서 대기열에 들어가므로 이 효과보다 늦게 들어올 수 있다.
    // 책장에 책이 있으면 한 권 이상 기록되고 대기열이 빌 때까지 기다린 뒤 시작 화면을 걷고, 나머지 장정 그림은 그 뒤에 읽는다(첫 기록과 겹쳐 느려지지 않게)
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    whenArtIdle(placementStore.get().layout.placements.length > 0, () => {
      if (!alive) return;
      onReady?.();
      t = setTimeout(() => setRest(true), 1500);
    });
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [ready, onReady]);
  const value = useMemo(() => ({ regular, original, artworks }), [regular, original, artworks]);
  // 책장 줄 캔버스용: 준비가 끝났을 때와 책장 책이 쓰는 장정 그림이 바뀔 때만 새 객체.
  // 줄 캔버스는 이 값이 바뀌면 줄 전체를 다시 기록하는데(그때 공유 값마다 UI 스레드를 기다린다), 글꼴·원본 그림이 따로 도착하거나
  // 쓰지 않는 장정 그림이 뒤늦게 읽힐 때마다 다시 기록하면 시작 직후 몇 초씩 막혔다
  const usedImages = COVER_ARTWORKS.map((a, i) => (used.has(a.id) ? images[i] : null));
  const shelfValue = useMemo<Shared>(
    () => (ready ? { regular, original, artworks: Object.fromEntries(COVER_ARTWORKS.map((a, i) => [a.id, usedImages[i] ?? null])) } : NOT_READY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, regular, original, ...usedImages],
  );
  return (
    <Ctx.Provider value={value}>
      <ShelfCtx.Provider value={shelfValue}>{children}</ShelfCtx.Provider>
    </Ctx.Provider>
  );
}

export const useBookShared = () => useContext(Ctx);
// 책장(홈) 줄 캔버스에 넘길 공용 자원(위 shelfValue)
export const useShelfShared = () => useContext(ShelfCtx);

export type BookArt = {
  spine: SkPicture; // 책등 면(책 색)
  titleV: SkPicture; // 세운 책등 제목(세로 조판, 책등 면 그림 좌표)
  titleH: SkPicture; // 눕힌 책등 제목(가로 한 줄, 책등 면 그림 좌표에서 머리 → 꼬리 방향으로 읽힌다)
  cover: SkPicture;
  ribbons: SkPicture | null;
  ribbonsShape: SkPath | null;
  ribbonsOut: number;
  pageEnd: SkPicture; // 머리·꼬리 속지 면(두께 × 책등 띠 뒤 ~ 책배 판 끝 안쪽)
  pageFore: SkPicture; // 책배 속지 면(두께 × 머리·꼬리 판 끝 안쪽)
};

// 책 몸체 색 하나: 표지판·책등·판 끝이 모두 같은 색이다(같은 책의 판 두 장과 책등). 표지 그림이 있는 책은 그 판 색(가장자리 색)을 쓴다.
// 책 재질 색(장정·표지 가장자리). 모든 화면의 책이 이 색 하나를 쓴다
const faceOf = (b: Book) => jacketColor(b.cover?.edge ?? b.body?.face ?? b.themeColor);
export const inkOf = (b: Book) => b.art.inkColor ?? titleInk(faceOf(b));

// 제목 획 두께: 글꼴 굵기 위에 글자 크기의 일부만큼 같은 색 윤곽을 더 그릴 몫(0이면 덧그리지 않는다. 윤곽 두께 0은 Skia에서 1px 선이라 아예 뺀다).
// 예전에는 고운바탕 Regular에 0.022(앞표지 0.024, 어두운 바탕의 밝은 글자 0.016)를 더했다(2026-10-09 사용자: 글씨가 너무 얇다).
// 2026-10-31 사용자가 고운바탕 Bold를 골라 덧그리지 않는다: Bold만으로 예전보다 잉크가 약 13% 많고, 더 그리면 43% 많아 무겁다.
export const TITLE_WEIGHT = 0;
export const TITLE_WEIGHT_LIGHT = 0;
export const COVER_WEIGHT = 0;
const weightFor = (ink: string) => (ink === TITLE_LIGHT ? TITLE_WEIGHT_LIGHT : TITLE_WEIGHT);
function Glyph({ x, y, text, font, color, weight, original }: { x: number; y: number; text: string; font: SkFont; color: string; weight: number; original: SkImage }) {
  if (hasOriginalGlyph(text)) return <ReferenceGlyph image={original} text={text} font={font} x={x} y={y} color={color} />;
  return (
    <>
      <Text x={x} y={y} text={text} font={font} color={color} />
      {weight > 0 ? <Text x={x} y={y} text={text} font={font} color={color} style="stroke" strokeWidth={weight} strokeJoin="round" /> : null}
    </>
  );
}

// 글자 칠 + 같은 색 윤곽(중간 굵기)
function inkPaints(ink: string, fs: number) {
  const fill = Skia.Paint();
  fill.setColor(Skia.Color(ink));
  fill.setAntiAlias(true);
  const weight = fs * weightFor(ink);
  if (weight <= 0) return [fill];
  const stroke = fill.copy();
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(weight);
  stroke.setStrokeJoin(StrokeJoin.Round);
  return [fill, stroke];
}

// 세운 책등 제목(세로 조판): 글자를 바로 세워 열로 쌓는다. 책등 폭 가운데. 쉼표·마침표는 앞 글자 오른쪽 아래.
function verticalTitlePicture(title: string, dims: { T: number; H: number }, s: number, regular: SkTypeface, ink: string, original: SkImage, titleTop?: number, textEnd = 0.79) {
  const w = dims.T * s;
  const h = dims.H * s;
  // 제목 아래에 작은 꽃·잎 장식이 들어갈 공간을 둔다.
  const t = spineTitleLayout(title, dims.H, dims.T * SPINE_FACE, textEnd, textEnd + 0.12);
  const fs = t.fontSize * s;
  const font = Skia.Font(regular, fs);
  const fm = font.getMetrics();
  const gy = -(fm.ascent + fm.descent) / 2;
  const colW = fs * 1.2;
  const cols = [...t.columns].reverse();
  const x0 = w / 2 - (cols.length * colW) / 2;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-w, -h, w * 3, h * 3));
  const paints = inkPaints(ink, fs);
  for (let ci = 0; ci < cols.length; ci++) {
    const list: { ch: string; punct?: string }[] = [];
    for (const ch of cols[ci]) {
      if ((ch === ',' || ch === '.') && list.length) list[list.length - 1].punct = ch;
      else list.push({ ch });
    }
    const cx = x0 + (ci + 0.5) * colW;
    let y = (titleTop ?? t.textTop) * h;
    for (const cell of list) {
      if (cell.ch === ' ') {
        // 띄어쓰기(쉼표 뒤도): 맞추기와 같은 셈(칸의 SPINE_SPACE배). 시안 책등은 단어 사이가 글자 크기의 약 0.4배 더 벌어진다
        y += fs * t.pitch * SPINE_SPACE;
        continue;
      }
      const ch = fs * t.pitch;
      // 세로 조판: 글자마다 전각 칸(나아가기 폭)의 가운데를 열의 가운데에 둔다. measureText는 잉크 상자라(x = 왼쪽 여백)
      // 잉크 폭의 절반만 빼면 글자가 왼쪽 여백(글자 크기의 약 5%)만큼 오른쪽으로 밀리고 글자마다 들쭉날쭉했다
      const adv = font.getGlyphWidths(font.getGlyphIDs(cell.ch))[0] ?? font.measureText(cell.ch).width;
      const gx = cx - adv / 2;
      const ink0 = font.measureText(cell.ch);
      const cy = y + ch / 2;
      if (!drawOriginalGlyph(c,original,cell.ch,font,gx,cy+gy,ink)) for (const p of paints) c.drawText(cell.ch,gx,cy+gy,p,font);
      if (cell.punct) for (const p of paints) c.drawText(cell.punct,gx+ink0.x+ink0.width-fs*0.05,cy+fs*0.5,p,font);
      // 쉼표·마침표 뒤는 조금 더 띄운다(시안 '아무튼, 독서': 쉼표와 띄어쓰기를 합쳐 글자 높이의 약 0.84배)
      y += ch + (cell.punct ? fs * 0.36 : 0);
    }
  }
  return rec.finishRecordingAsPicture();
}

// 눕힌 책등 제목(가로 한 줄): 책등 면 그림 좌표에서 머리(위) → 꼬리(아래) 방향으로 쓰고, 글자 위쪽은 앞표지 쪽(그림 오른쪽)을 향한다.
// 눕힘(roll −90)에서 머리가 왼쪽·앞표지가 위라 화면에서 왼쪽 → 오른쪽으로 바로 읽힌다. 두께 방향 가운데.
function lyingTitlePicture(title: string, dims: { T: number; H: number }, s: number, regular: SkTypeface, ink: string, original: SkImage, hasMotif: boolean) {
  const w = dims.T * s;
  const h = dims.H * s;
  const t = lyingTitleLayout(title, dims.H, dims.T, hasMotif ? 0.20 : undefined);
  const fs = t.fontSize * s;
  const font = Skia.Font(regular, fs);
  const fm = font.getMetrics();
  const gy = -(fm.ascent + fm.descent) / 2;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-w, -h, w * 3, h * 3));
  const paints = inkPaints(ink, fs);
  c.save();
  c.translate(w / 2, t.start * h);
  c.rotate(90, 0, 0);
  let x = 0;
  for (const ch of [...t.text]) {
    if (ch === ' ') {
      x += fs * 0.32;
      continue;
    }
    if (!drawOriginalGlyph(c,original,ch,font,x,gy,ink)) for (const p of paints) c.drawText(ch,x,gy,p,font);
    x += font.measureText(ch).width + fs * LYING_TRACK;
  }
  c.restore();
  return rec.finishRecordingAsPicture();
}

// 표지 그림에서 제목이 놓일 띠의 평균색(그림은 면을 꽉 채우게 놓인다: fit="cover")
function bandColor(img: SkImage, fw: number, fh: number, x0: number, y0: number, x1: number, y1: number) {
  const iw = img.width();
  const ih = img.height();
  const k = Math.max(fw / iw, fh / ih);
  const ox = (fw - iw * k) / 2;
  const oy = (fh - ih * k) / 2;
  const sx = Math.max(0, Math.floor((x0 - ox) / k));
  const sy = Math.max(0, Math.floor((y0 - oy) / k));
  const w = Math.max(1, Math.min(iw - sx, Math.ceil((x1 - x0) / k)));
  const h = Math.max(1, Math.min(ih - sy, Math.ceil((y1 - y0) / k)));
  const px = img.readPixels(sx, sy, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    r += px[i * 4];
    g += px[i * 4 + 1];
    b += px[i * 4 + 2];
  }
  return rgbHex(r / n, g / n, b / n);
}
// 몸체 색(판 두 장·책등이 같은 색). cover 인자는 예전 호출과 맞추려고 남겨 둔다(앞표지·뒤표지·책등이 모두 같은 색).
export const toneOf = (b: Book) => bookTone(b);

export const SPINE_FACE = 0.94; // 세운 책등 제목 크기를 정할 때 쓰는 폭(책등 폭의 94%. 글자는 책등 가운데)

// 갈피(종이 탭): 갈피가 하나면 한 장, 둘 이상이면 두 장이 머리 위로 나란히 나온다(ribbon-design). 색은 책 색 계열(tabColors).
// 원점 = 책 머리 가운데, 위가 음수. 뿌리는 머리 면 속지 사이로 조금 묻힌다(TAB_HIDDEN). 종이 탭은 속지 사이에 끼워져
// 뿌리를 축으로 조금씩 기운다(±TAB_TILT_MAX°, 책마다·장마다). 그림은 재질(색·한지 결)만, 밝기는 그릴 때 빛 모델이 칠한다(BookNode Ribbons).
const TAB_HIDDEN = 1.2;
const TAB_TILT_MAX = 4;
type Tab = { x: number; width: number; out: number; color: string; seed: number; tilt: number };
function rng(seed: number) {
  let k = seed >>> 0;
  return () => {
    k = (Math.imul(k, 1664525) + 1013904223) >>> 0;
    return k / 4294967296;
  };
}
export function tabsOf(book: Book): Tab[] {
  const design = ribbonDesign(book);
  const [c1, c2] = tabColors(toneOf(book), book.art.ribbon);
  const tall = Math.max(...design.tabs.map((t) => t.out));
  let seed = 0;
  for (const ch of book.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return design.tabs.map((t, i) => {
    const sd = seed + i * 7919;
    return { x: design.x + t.x, width: t.width, out: t.out, color: t.out === tall ? c1 : c2, seed: sd, tilt: (rng(sd ^ 0x9e3779b9)() - 0.5) * 2 * TAB_TILT_MAX };
  });
}
// 탭 한 장의 모양(갈피 좌표, px). 둥근 위 모서리 반지름 TAB_R
function tabPath(t: Tab, s: number, into: ReturnType<typeof Skia.PathBuilder.Make>) {
  const w = t.width * s;
  const hidden = TAB_HIDDEN * s;
  const top = -t.out * s;
  const r = Math.min(TAB_R * s, w / 2);
  const m = Skia.Matrix();
  m.translate(t.x * s, hidden);
  m.rotate((t.tilt * Math.PI) / 180);
  m.translate(0, -hidden);
  const p = Skia.PathBuilder.Make();
  p.moveTo(-w / 2, hidden);
  p.lineTo(-w / 2, top + r);
  p.quadTo(-w / 2, top, -w / 2 + r, top);
  p.lineTo(w / 2 - r, top);
  p.quadTo(w / 2, top, w / 2, top + r);
  p.lineTo(w / 2, hidden);
  p.close();
  const one = p.detach();
  one.transform(m);
  into.addPath(one);
  return one;
}
function PaperTab({ t, s }: { t: Tab; s: number }) {
  const w = t.width * s;
  const hidden = TAB_HIDDEN * s;
  const top = -t.out * s;
  // 종이 색만 칠한다: 결(반사율·미세 높이)과 밝기는 빛 셰이더가 무광 종이 재질로(BookNode Ribbons, SceneLight TabLight)
  return <Path path={tabPath(t, s, Skia.PathBuilder.Make())} color={t.color} />;
}
function Ribbons({ book, s }: { book: Book; s: number }) {
  return (
    <Group>
      {tabsOf(book).map((t, i) => (
        <PaperTab key={i} t={t} s={s} />
      ))}
    </Group>
  );
}
// 모든 탭 모양(빛을 다시 칠할 자리)과 가장 긴 탭 길이(DU)
function ribbonShapeOf(book: Book, s: number) {
  const all = Skia.PathBuilder.Make();
  const tabs = tabsOf(book);
  for (const t of tabs) tabPath(t, s, all);
  return { path: all.detach(), out: Math.max(...tabs.map((t) => t.out)) };
}

// 속지 면(판 사이, 판 끝보다 안쪽). w×h DU를 배율 s로 종이 색만 칠한다: 낱장·접장 결(반사율·미세 높이)과 밝기·판 쪽 그늘은
// 빛 셰이더가 속지 단면 재질(ui/lighting materials.pages)로 계산한다(책 좌표에 붙어 세우기·눕히기·돌리기에도 같은 자리)
function PageArt({ w, h, s }: { w: number; h: number; s: number }) {
  return <Rect x={0} y={0} width={w * s} height={h * s} color={PAGE_BASE} />;
}

async function record(el: ReactNode, w: number, h: number) {
  return drawAsPicture(<Group>{el}</Group>, Skia.XYWHRect(-w, -h, w * 3, h * 3));
}

const artCache = createArtCache<BookArt>(96);
let queue: Promise<unknown> = Promise.resolve();
// 측정: 기록 대기 중인 책 수와 누적 기록 시간
let pendingArt = 0;
let builtArt = 0;
let artMs = 0;
// 기록 대기열이 빌 때 부를 것(시작 화면을 첫 책장의 그림이 다 기록된 뒤에 걷는다).
// expect: 기록될 책이 있다(아직 한 권도 안 들어왔으면 들어와서 빌 때까지 기다린다)
const idleWaiters: (() => void)[] = [];
function whenArtIdle(expect: boolean, cb: () => void) {
  if (pendingArt === 0 && (!expect || builtArt > 0)) cb();
  else idleWaiters.push(cb);
}
// 지금 기록할 책 그림이 없다(홈 사진은 그림이 다 올라간 뒤에 찍는다)
export const artIdle = () => pendingArt === 0 && deliveries.length === 0;
// 대기열이 비면 잠깐(다른 줄 캔버스의 책이 이어서 들어올 틈) 뒤에도 비어 있을 때 기다리던 쪽을 부른다
function idleSoon() {
  setTimeout(() => {
    if (pendingArt === 0) idleWaiters.splice(0).forEach((f) => f());
  }, 32);
}

// 기록된 그림 알리기: 대기열이 도는 동안은 모아 두었다가 빌 때(또는 0.4초마다) 한꺼번에 알린다.
// 한 권씩 알리면 그때마다 그 책이 있는 줄 전체를 다시 그려(첫 화면 18권이면 줄 그리기 18번) 기록보다 오래 걸렸다.
const deliveries: (() => void)[] = [];
let deliverTimer: ReturnType<typeof setTimeout> | null = null;
function flushDeliveries() {
  if (deliverTimer) clearTimeout(deliverTimer);
  deliverTimer = null;
  deliveries.splice(0).forEach((f) => f());
}
// 첫 책장(시작 화면 뒤)은 대기열이 빌 때 한 번에만 알린다(줄마다 한 번만 다시 기록). 그 뒤 많은 책을 한꺼번에 기록할 때는 1.5초마다 보여 준다
let firstIdle = false;
function deliver(f: () => void) {
  deliveries.push(f);
  if (pendingArt === 0) flushDeliveries();
  else if (firstIdle) deliverTimer ??= setTimeout(flushDeliveries, 1500);
}

// 서버에서 받은 책 전체 그림(표지·책등). 있으면 코드로 그리는 장정 대신 이 그림을 그대로 쓴다(제목·장식도 그림 안에 있다).
type MadeArt = { cover: SkImage | null; spine: SkImage | null };

// 시안에서 잰 책등 제목 위치(titleTop)는 책등 그림을 머리 위로 늘려 그리던 때의 값이다. 물리 모드는 책등을 늘리지 않아
// 제목이 그만큼(책등 높이의 약 6%) 내려가 보였다(시안 '흰' 0.23 → 앱 0.29). 그만큼 올린다
const TITLE_LIFT = 0.06;
// 책등 장식(꽃·별·달 같은 작은 그림)은 일단 그리지 않는다. 다시 켜려면 true.
const SPINE_MOTIF = false;

async function buildArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared, motif: SkImage | null, coverImg: SkImage | null, made: MadeArt): Promise<BookArt> {
  const regular = shared.regular!;
  const face = faceOf(book);
  const ink = inkOf(book);
  // 책등: 공통 바탕 + 자세별 제목과 장식. 눕힐 때 장식도 바로 선다.
  const w = dims.T * s;
  const h = dims.H * s;
  const spineMotif = !SPINE_MOTIF || book.art.motif === 'none' ? null : Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C')));
  const compactMotif = ['moon', 'crescent', 'star', 'star-solid', 'asterisk', 'cloud', 'wave', 'book'].includes(book.art.motif);
  const motifCap = ({ asterisk: 12.5, 'star-solid': 12.5, cloud: 15.5, book: 15 } as Record<string, number>)[book.art.motif] ?? (compactMotif ? 17 : 14);
  const motifW = Math.min(w * (compactMotif ? 0.58 : 0.45), motifCap * s) * (book.art.motifScale ?? 1);
  const motifH = motifW * 2.5;
  const motifCenter = ({ 'star-solid': 0.71, cloud: 0.785, wave: 0.875, book: 0.87 } as Record<string, number>)[book.art.motif] ?? 0.835;
  const motifY = compactMotif ? h * motifCenter - motifH / 2 : h * (book.art.motifBottom ?? 0.90) - motifH;
  // 실제 사용자 제목은 길이가 달라진다. 장식의 윗끝보다 먼저 조판을
  // 끝내서 마지막 글자와 잎·꽃이 겹치지 않도록 공간을 먼저 확보한다.
  const textEnd = book.art.titleTop !== undefined ? 0.79 : !SPINE_MOTIF || book.art.motif === 'none' ? 0.88 : Math.max(0.50, (motifY + (compactMotif ? motifH * 0.28 : 0) - 4 * s) / h);
  const binding = referenceBinding(face);
  const spine = await record(made.spine
    ? <Group clip={bookFacePath(w, h, s)}><SkiaImage image={made.spine} x={0} y={0} width={w} height={h} fit="fill" /></Group>
    : binding ? <ReferenceBinding material={binding} w={w} h={h} s={s} /> : <SpineFaceArt w={w} h={h} face={face} s={s} />, w, h);
  const motifGlyph = !SPINE_MOTIF ? null : hasReferenceMotif(book.art.motif) ? <ReferenceMotif image={shared.original!} id={book.art.motif} color={book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C')} /> : spineMotif ? <ImageSVG svg={spineMotif} x={0} y={0} width={24} height={60} /> : null;
  const print = referencePrint(book.title);
  const printV = print?.pose === 'spine' ? print : undefined;
  const printH = print?.pose === 'horizontal' ? print : undefined;
  const accent = book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C');
  const titleV = made.spine ? await record(<Group />, w, h) : await record(<Group>
    {printV ? <ReferencePrint image={shared.original!} template={printV} w={w} h={h} ink={ink} accent={accent} decoration={SPINE_MOTIF && printV.motif === book.art.motif} /> : <Picture picture={verticalTitlePicture(book.title, dims, s, regular, ink, shared.original!, book.art.titleTop === undefined ? undefined : Math.max(0.12, book.art.titleTop - TITLE_LIFT), textEnd)} />}
    {!SPINE_MOTIF || printV?.motif === book.art.motif ? null : <Group transform={[{ translateX: (w - motifW) / 2 }, { translateY: motifY }, { scale: motifW / 24 }]}>{motifGlyph}</Group>}
  </Group>, w, h);
  // Counter-rotate the small illustration so it stays upright on a lying spine.
  const lyingMotifW = Math.min(12.5 * s, w * 0.39) * (book.art.motifScale ?? 1);
  const titleH = made.spine ? await record(<Group />, w, h) : await record(<Group>
    {printH ? <ReferencePrint image={shared.original!} template={printH} w={w} h={h} ink={ink} accent={accent} decoration={SPINE_MOTIF && printH.motif === book.art.motif} /> : <Picture picture={lyingTitlePicture(book.title, dims, s, regular, ink, shared.original!, !!spineMotif)} />}
    {!SPINE_MOTIF || printH?.motif === book.art.motif ? null : <Group transform={[{ translateX: w / 2 }, { translateY: h * 0.89 }, { rotate: Math.PI / 2 }]}>
      <Group transform={[{ translateX: -lyingMotifW / 2 }, { translateY: -lyingMotifW * 1.25 }, { scale: lyingMotifW / 24 }]}>{motifGlyph}</Group>
    </Group>}
  </Group>, w, h);
  // 표지(앞표지 그림 + 제목). 시안 표지에는 저자가 없다.
  const cw = dims.W * s;
  const vector = !!book.art.vectorCover && !made.cover;
  const cover = vector ? ({ titleTop: 0.11 } as CoverArt) : jacketFor(book);
  const ct = coverTitleLayout(book.title, dims.W, dims.H);
  const lines = ct.lines;
  const cfs = ct.fontSize * s;
  const cfont = Skia.Font(regular, cfs);
  const spacing = cfs * COVER_TRACK;
  const lh = cfs * COVER_LINE_H;
  const cm = cfont.getMetrics();
  // 제목 칸 위치: 그림 자산의 제목 자리(titleTop)를 따르되 표지 위 끝에 붙지 않게(시안: 잉크 위 끝이 위에서 약 12~33%)
  const moonRoom = cover === LANDSCAPES.night || cover.printedTitle === LANDSCAPES.night.printedTitle ? Math.max(0, lines.length - 1) * 0.04 : 0;
  const top = Math.max(0.08, (cover?.titleTop ?? 0.2) - moonRoom) * h;
  // 가운데: 제본 홈 안쪽의 그림 칸 가운데(시안 표지 제목은 홈을 뺀 면의 가운데, 표지 폭의 약 0.52)
  const cx0 = (cw + GROOVE.at * s) / 2;
  // 제목 색: 제목이 놓이는 그림 띠의 실제 색에 대해 공통 규칙으로(밝으면 먹색, 어두우면 따뜻한 밝은색)
  const bandW = Math.min(cw * 0.84, Math.max(...lines.map((l) => cfont.measureText(l).width)) + cfs);
  const band = coverImg && !cover.sourceRect && !cover.artworkId ? bandColor(coverImg, cw, h, cx0 - bandW / 2, top, cx0 + bandW / 2, top + lines.length * lh) : null;
  // 기본 정면 장정 그림은 그림마다 정해 둔 제목 색(cover-artworks ink: 밝은 하늘 따뜻한 먹색, 어두운 하늘 아이보리)
  const cink = vector ? ink : cover.sourceRect || cover.artworkId ? cover.ink : band ? titleInk(band) : titleInk(face);
  const lineEls = lines.map((line, i) => {
    const chars = [...line];
    const ws = chars.map((c) => (c === ' ' ? cfs * COVER_SPACE : cfont.measureText(c).width));
    const total = ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cx0 - total / 2;
    const base = top + i * lh + lh / 2 - (cm.ascent + cm.descent) / 2;
    return chars.map((c, j) => {
      const el = <Glyph key={`${i}-${j}`} x={x} y={base} text={c} font={cfont} color={cink} weight={cfs * COVER_WEIGHT} original={shared.original!} />;
      x += ws[j] + spacing;
      return el;
    });
  });
  // 표지 장식(그림이 없는 책): 모티프는 표지에만 둔다(책등에는 제목만)
  let coverMotif: ReactNode = null;
  if (!coverImg && !book.body && !book.art.plainCover && book.art.motif !== 'none') {
    const svg = Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? ink));
    const mH = h * (vector ? 0.46 : 0.4);
    const mw = Math.min(cw * (vector ? 0.5 : 0.4), (mH * 24) / 60);
    if (svg) coverMotif = <ImageSVG svg={svg} x={cw / 2 - mw / 2} y={h * 0.9 - (mw * 60) / 24} width={mw} height={(mw * 60) / 24} />;
  }
  const originalCover = !made.cover && !!coverImg && !!cover.sourceRect;
  const retainTitle = originalCover && book.title.replace(/\s/g, '') === cover.printedTitle?.replace(/\s/g, '');
  const coverPic = await record(
    made.cover ? <Group clip={bookFacePath(cw, h, s)}><SkiaImage image={made.cover} x={0} y={0} width={cw} height={h} fit="cover" /></Group> :
    <Group>
      {originalCover ? <ReferenceCover image={coverImg!} cover={cover} w={cw} h={h} s={s} retainTitle={retainTitle} /> : <CoverFaceArt w={cw} h={h} s={s} face={toneOf(book)} image={coverImg} motif={book.body ? motif : null} focusY={cover.artworkId ? cover.focusY : undefined} />}
      {coverMotif}
      {book.art.plainCover || retainTitle ? null : lineEls}
    </Group>,
    cw,
    h,
  );
  const ribbons = hasRibbon(book) ? await record(<Ribbons book={book} s={s} />, 40 * s, 30 * s) : null;
  const rs = hasRibbon(book) ? ribbonShapeOf(book, s) : null;
  // 속지 면(book-parts와 같은 치수): 머리·꼬리는 책등 띠 쪽에도 그늘, 책배는 판 쪽만
  const rig = rigOf(dims);
  const pw = dims.T - 2 * rig.bd;
  const pageEnd = await record(<PageArt w={pw} h={dims.W - rig.sq - rig.sp} s={s} />, pw * s, (dims.W - rig.sq - rig.sp) * s);
  const pageFore = await record(<PageArt w={pw} h={dims.H - 2 * rig.sq} s={s} />, pw * s, (dims.H - 2 * rig.sq) * s);
  return { spine, titleV, titleH, cover: coverPic, ribbons, ribbonsShape: rs?.path ?? null, ribbonsOut: rs?.out ?? 0, pageEnd, pageFore };
}

// 책 한 권의 기록된 그림(없으면 null → 다음 렌더에서 채워진다)
// shared는 캔버스 밖에서 읽어 넘긴다(Skia 캔버스 안은 별도 렌더러라 React 컨텍스트가 닿지 않는다)
export function useBookArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared): BookArt | null {
  // 기존 비트맵 모티프는 표지용. 책등의 작은 장식은 벡터로 기록한다.
  const needMotif = !!book.body?.motif && !book.cover?.image;
  const vector = !!book.art.vectorCover;
  const cover = jacketFor(book);
  const needCover = !!cover.image && !book.art.plainCover && !vector;
  const motif = useImage(needMotif ? (book.body?.motif ?? null) : null);
  const customCoverImg = useImage(book.art.plainCover || vector || cover.sourceRect || cover.artworkId ? null : cover.image);
  const coverImg = book.art.plainCover || vector ? null : cover.sourceRect ? shared.original : cover.artworkId ? shared.artworks[cover.artworkId] ?? null : customCoverImg;
  // 서버가 만든 표지·책등 그림(주소). 못 읽으면 코드로 그리는 장정으로 돌아간다.
  const [badCover, setBadCover] = useState<string | null>(null);
  const [badSpine, setBadSpine] = useState<string | null>(null);
  const madeCoverUri = badCover === book.coverArtUri ? null : book.coverArtUri ?? null;
  const madeSpineUri = badSpine === book.spineArtUri ? null : book.spineArtUri ?? null;
  const madeCover = useImage(madeCoverUri, () => setBadCover(book.coverArtUri ?? null));
  const madeSpine = useImage(madeSpineUri, () => setBadSpine(book.spineArtUri ?? null));
  const ready = shared.regular && shared.original && (!needMotif || motif) && (!needCover || coverImg) && (!madeCoverUri || madeCover) && (!madeSpineUri || madeSpine);
  // 장정(책 색·모티프)·저자가 바뀌면 다시 기록한다(같은 책 id라도)
  const key = bookArtKey(book, s, dims, cover, madeCoverUri, madeSpineUri);
  const [art, setArt] = useState<{ key: string; art: BookArt } | null>(() => {
    const hit = artCache.peek(key);
    return hit ? { key, art: hit } : null;
  });
  useEffect(() => {
    if (!ready) {
      if (TL.on) tl(`art-wait ${book.id} motif=${!needMotif || !!motif} cover=${!needCover || !!coverImg} made=${!madeCoverUri || !!madeCover}`);
      return;
    }
    const p = artCache.load(key, () => {
      if (TL.on) tl(`art-enq ${book.id}`);
      // 한 권씩 차례로 기록한다(한꺼번에 하면 앱이 멈춘다)
      pendingArt++;
      const task = queue.then(async () => {
        const t0 = Date.now();
        if (TL.on) tl(`art-start ${book.id}`);
        const a = await buildArt(book, s, dims, shared, motif, coverImg, { cover: madeCoverUri ? madeCover : null, spine: madeSpineUri ? madeSpine : null });
        artMs += Date.now() - t0;
        if (TL.on) tl(`art-end ${book.id} ${Date.now() - t0}ms`);
        builtArt++;
        if (builtArt === 1) bootMark('art-first', `${Date.now() - t0}ms`);
        return a;
      }).finally(() => {
        // 실패해도 대기 수는 줄인다(시작 화면이 대기열을 기다리다 멈추지 않게)
        pendingArt--;
        if (pendingArt === 0) {
          firstIdle = true;
          bootMark(`art-idle-${builtArt}`, `books=${builtArt} build=${artMs}ms`);
          idleSoon();
        }
      });
      queue = task.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 0)));
      return task;
    });
    let alive = true;
    p.then((a) => {
      deliver(() => {
        if (TL.on) tl(`art-deliver ${book.id}`);
        if (alive) setArt({ key, art: a });
      });
    }).catch((e) => {
      console.warn('book art failed', book.id, String(e?.message ?? e));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  if (art && art.key === key) return art.art;
  // 장정을 바꾸는 동안(새 그림을 기록하는 사이)에는 직전 그림을 그대로 보여 준다(빈 표지가 잠깐 보이지 않게)
  return artCache.peek(key) ?? art?.art ?? null;
}
