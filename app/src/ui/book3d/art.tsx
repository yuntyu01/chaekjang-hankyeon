// 책 면 그림과 조판을 Skia Picture로 한 번 기록해 두고(책·배율마다 캐시), 매 프레임은 면 변환만 바꿔 그린다.
// - 책등 면: 책 색 한 가지(균일한 무광. 장식 그림·질감 없음)
// - 책등 제목: 조판 두 가지를 따로 기록한다. 세운 책등은 세로(글자를 바로 세워 쌓음), 눕힌 책등은 가로 한 줄.
//   둘 다 책등 면 그림 좌표에 고정되어 몸체와 함께 돈다(글자를 따로 돌리지 않는다). 어느 쪽을 보일지는 자세가 정한다(BookNode).
// - 표지 면: 표지 그림(달·풍경 등) + 제목·저자
// - 갈피: 머리 뒤에서 나오는 끈(원점 = 아래 가운데)
import { BlurMask, ColorType, AlphaType, Group, PaintStyle, StrokeJoin, ImageSVG, Path, Rect, Skia, Text, drawAsPicture, useImage, useTypeface, type SkFont, type SkImage, type SkPicture, type SkTypeface } from '@shopify/react-native-skia';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { rgbHex, shade, TITLE_LIGHT, titleInk } from '@/domain/color';
import { COVER_LINE_H, coverTitleLayout, LYING_TRACK, lyingTitleLayout, spineTitleLayout } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { motifSvg } from '@/ui/art/motifs';
import { bootMark } from '@/ui/boot-trace';
import { rigOf } from '@/domain/book-parts';
import { CoverFaceArt, PAGE_BASE, PAGE_LINE, PAGE_RIM, SpineFaceArt, withAlpha as withAlphaHex } from '@/ui/book/BookBody';

const REGULAR = require('@expo-google-fonts/gowun-batang/400Regular/GowunBatang_400Regular.ttf');

// 제목은 보통 굵기 + 윤곽 덧그리기로 굵기를 정하므로 Skia에는 보통 굵기 글꼴 하나만 읽는다(굵은 글꼴 8MB를 따로 읽지 않는다)
export type Shared = { regular: SkTypeface | null };
const Ctx = createContext<Shared>({ regular: null });

// 앱 뿌리에 한 번: 제목 글꼴
export function BookArtProvider({ children }: { children: ReactNode }) {
  const regular = useTypeface(REGULAR);
  useEffect(() => {
    if (regular) bootMark('skia-font-regular');
  }, [regular]);
  return <Ctx.Provider value={{ regular }}>{children}</Ctx.Provider>;
}

export const useBookShared = () => useContext(Ctx);

export type BookArt = {
  spine: SkPicture; // 책등 면(책 색)
  titleV: SkPicture; // 세운 책등 제목(세로 조판, 책등 면 그림 좌표)
  titleH: SkPicture; // 눕힌 책등 제목(가로 한 줄, 책등 면 그림 좌표에서 머리 → 꼬리 방향으로 읽힌다)
  cover: SkPicture;
  ribbons: SkPicture | null;
  pageEnd: SkPicture; // 머리·꼬리 속지 면(두께 × 책등 띠 뒤 ~ 책배 판 끝 안쪽)
  pageFore: SkPicture; // 책배 속지 면(두께 × 머리·꼬리 판 끝 안쪽)
};

// 책 몸체 색 하나: 표지판·책등·판 끝이 모두 같은 색이다(같은 책의 판 두 장과 책등). 표지 그림이 있는 책은 그 판 색(가장자리 색)을 쓴다.
const faceOf = (b: Book) => b.cover?.edge ?? b.body?.face ?? b.themeColor;
export const inkOf = (b: Book) => b.art.inkColor ?? titleInk(faceOf(b));

// 제목 획 두께: 보통 굵기 글꼴에 글자 크기의 일부만큼 같은 색 윤곽을 더해 중간 굵기로(글자 모양·크기는 그대로).
// 시안의 제목 획은 보통 굵기보다 약 30% 두껍고, 가는 획은 실제 표시 크기에서 바탕에 묻혀 옅어 보인다.
// 어두운 바탕의 밝은 글자는 번져 보여 같은 두께도 더 굵게 읽히므로 덧그리는 두께를 조금 줄인다(바탕·글자색에 따른 공통 규칙).
export const TITLE_WEIGHT = 0.03;
export const TITLE_WEIGHT_LIGHT = 0.022;
const weightFor = (ink: string) => (ink === TITLE_LIGHT ? TITLE_WEIGHT_LIGHT : TITLE_WEIGHT);
function Glyph({ x, y, text, font, color, weight }: { x: number; y: number; text: string; font: SkFont; color: string; weight: number }) {
  return (
    <>
      <Text x={x} y={y} text={text} font={font} color={color} />
      <Text x={x} y={y} text={text} font={font} color={color} style="stroke" strokeWidth={weight} strokeJoin="round" />
    </>
  );
}

// 글자 칠 + 같은 색 윤곽(중간 굵기)
function inkPaints(ink: string, fs: number) {
  const fill = Skia.Paint();
  fill.setColor(Skia.Color(ink));
  fill.setAntiAlias(true);
  const stroke = fill.copy();
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeWidth(fs * weightFor(ink));
  stroke.setStrokeJoin(StrokeJoin.Round);
  return [fill, stroke];
}

// 세운 책등 제목(세로 조판): 글자를 바로 세워 열로 쌓는다. 책등 폭 가운데. 쉼표·마침표는 앞 글자 오른쪽 아래.
function verticalTitlePicture(title: string, dims: { T: number; H: number }, s: number, regular: SkTypeface, ink: string) {
  const w = dims.T * s;
  const h = dims.H * s;
  // 장식 그림 자리를 두지 않는다(제목만): 그림 칸을 책 아래 끝 가까이로(조판 규칙의 시작 위치·크기·간격은 그대로)
  const t = spineTitleLayout(title, dims.H, dims.T * SPINE_FACE, 0.9, 0.93);
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
    let y = t.textTop * h;
    for (const cell of list) {
      if (cell.ch === ' ') {
        // 띄어쓰기(쉼표 뒤도): 시안처럼 반 글자 남짓 띄운다
        y += fs * 0.5;
        continue;
      }
      const ch = fs * t.pitch;
      const gw = font.measureText(cell.ch).width;
      const cy = y + ch / 2;
      for (const p of paints) {
        c.drawText(cell.ch, cx - gw / 2, cy + gy, p, font);
        if (cell.punct) c.drawText(cell.punct, cx + gw / 2 - fs * 0.05, cy + fs * 0.5, p, font);
      }
      y += ch;
    }
  }
  return rec.finishRecordingAsPicture();
}

// 눕힌 책등 제목(가로 한 줄): 책등 면 그림 좌표에서 머리(위) → 꼬리(아래) 방향으로 쓰고, 글자 위쪽은 앞표지 쪽(그림 오른쪽)을 향한다.
// 눕힘(roll −90)에서 머리가 왼쪽·앞표지가 위라 화면에서 왼쪽 → 오른쪽으로 바로 읽힌다. 두께 방향 가운데.
function lyingTitlePicture(title: string, dims: { T: number; H: number }, s: number, regular: SkTypeface, ink: string) {
  const w = dims.T * s;
  const h = dims.H * s;
  const t = lyingTitleLayout(title, dims.H, dims.T);
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
    for (const p of paints) c.drawText(ch, x, gy, p, font);
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
export const toneOf = (b: Book, _cover?: boolean) => faceOf(b);

export const RIBBON_OUT = 12; // 시안: 갈피가 책 위로 약 13DU
export const SPINE_FACE = 0.94; // 세운 책등 제목 크기를 정할 때 쓰는 폭(책등 폭의 94%. 글자는 책등 가운데)

// 갈피 끈: 균일한 무광 색(외곽선·광택 없음). 두 번째 가닥은 조금 짧고 살짝 어둡다.
function Ribbons({ book, s }: { book: Book; s: number }) {
  const n = Math.min(2, book.quotes ?? 0);
  const color = book.art.ribbon ?? shade(book.themeColor, 0.25);
  const w = 6.8 * s;
  const gap = 2.4 * s;
  const hidden = 1.2 * s; // 뿌리: 머리 면에 살짝 묻힌다
  const total = n * w + (n - 1) * gap;
  return (
    <Group>
      {/* 갈피가 종이 묶음 사이로 들어가는 자리: 좁고 옅은 틈 그늘(갈피가 종이 사이에 끼워진 얇은 끈으로 보이게) */}
      {Array.from({ length: n }, (_, i) => {
        const x = -total / 2 + i * (w + gap);
        return (
          <Rect key={`slit${i}`} x={x - 0.4 * s} y={hidden - 0.7 * s} width={w + 0.8 * s} height={1.2 * s} color="rgba(96,74,52,0.18)">
            <BlurMask blur={0.45 * s} style="normal" />
          </Rect>
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const x = -total / 2 + i * (w + gap);
        const out = (RIBBON_OUT - (i ? 2 : 0)) * s; // 두 번째 가닥은 조금 짧다
        const top = hidden - out; // 원점(0) = 책 머리, 위로 음수
        const cut = (i ? -2.2 : 2.4) * s; // 끝을 비스듬히
        const pts = [
          { x: x + 0.2 * s, y: hidden },
          { x, y: top + Math.max(0, cut) + 0.6 * s - hidden },
          { x: x + w, y: top + Math.max(0, -cut) - hidden },
          { x: x + w - 0.2 * s, y: hidden },
        ];
        const tone = i ? shade(color, -0.06) : color;
        const path = Skia.Path.Polygon(pts, true);
        return (
          <Group key={i} transform={[{ translateX: x + w / 2 }, { translateY: hidden }, { rotate: ((i ? 4 : -6) * Math.PI) / 180 }, { translateX: -(x + w / 2) }, { translateY: -hidden }]}>
            <Path path={path} color={tone} />
          </Group>
        );
      })}
    </Group>
  );
}

// 속지 면(판 사이, 판 끝보다 안쪽). w×h DU를 배율 s로. 밝은 아이보리 바탕 + 판과 나란한 옅은 종이 결 두 줄 + 판(과 책등 띠) 쪽 좁은 그늘.
// 결·그늘은 책 좌표에 붙어 있어 세우기·눕히기·돌리기에도 같은 자리다. 밝기는 그릴 때 면마다 덧칠한다.
function PageArt({ w, h, s, spineBand }: { w: number; h: number; s: number; spineBand: boolean }) {
  const W = w * s;
  const H = h * s;
  const band = Math.max(0.8, Math.min(2.0, w * 0.12)) * s;
  const rim = withAlphaHex(PAGE_RIM, 0.26);
  return (
    <Group clip={Skia.XYWHRect(0, 0, W, H)}>
      <Rect x={0} y={0} width={W} height={H} color={PAGE_BASE} />
      {[0.36, 0.68].map((u) => (
        <Rect key={u} x={W * u - 0.25} y={1 * s} width={0.5} height={Math.max(0, H - 2 * s)} color={PAGE_LINE} opacity={0.16} />
      ))}
      <Rect x={-band} y={-band} width={2 * band} height={H + 2 * band} color={rim}>
        <BlurMask blur={0.8 * s} style="normal" />
      </Rect>
      <Rect x={W - band} y={-band} width={2 * band} height={H + 2 * band} color={rim}>
        <BlurMask blur={0.8 * s} style="normal" />
      </Rect>
      {spineBand ? (
        <Rect x={-band} y={-band} width={W + 2 * band} height={2 * band} color={rim}>
          <BlurMask blur={0.8 * s} style="normal" />
        </Rect>
      ) : null}
    </Group>
  );
}

async function record(el: ReactNode, w: number, h: number) {
  return drawAsPicture(<Group>{el}</Group>, Skia.XYWHRect(-w, -h, w * 3, h * 3));
}

const cache = new Map<string, Promise<BookArt>>();
const done = new Map<string, BookArt>(); // 이미 기록된 것(다시 그릴 때 한 프레임도 비지 않게)
let queue: Promise<unknown> = Promise.resolve();
// 측정: 기록 대기 중인 책 수와 누적 기록 시간
let pendingArt = 0;
let builtArt = 0;
let artMs = 0;

async function buildArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared, motif: SkImage | null, coverImg: SkImage | null): Promise<BookArt> {
  const regular = shared.regular!;
  const face = faceOf(book);
  const ink = inkOf(book);
  // 책등: 책 색 면 + 제목 두 가지(세로·가로). 장식 그림은 두지 않는다.
  const w = dims.T * s;
  const h = dims.H * s;
  const spine = await record(<SpineFaceArt w={w} h={h} face={face} />, w, h);
  const titleV = verticalTitlePicture(book.title, dims, s, regular, ink);
  const titleH = lyingTitlePicture(book.title, dims, s, regular, ink);
  // 표지(앞표지 그림 + 제목·저자)
  const cw = dims.W * s;
  const cover = book.cover;
  const ct = coverTitleLayout(book.title, dims.W, dims.H);
  const lines = ct.lines;
  const cfs = ct.fontSize * s;
  const cfont = Skia.Font(regular, cfs);
  const spacing = cfs * 0.06;
  const lh = cfs * COVER_LINE_H;
  const cm = cfont.getMetrics();
  // 제목 칸 위치: 그림 자산의 제목 자리(titleTop)를 따르되 표지 위 끝에 붙지 않게(시안: 위에서 약 15~25%)
  const top = Math.max(0.15, cover?.titleTop ?? 0.2) * h;
  // 제목 색: 제목이 놓이는 그림 띠의 실제 색에 대해 공통 규칙으로(밝으면 먹색, 어두우면 따뜻한 밝은색)
  const bandW = Math.min(cw * 0.84, Math.max(...lines.map((l) => cfont.measureText(l).width)) + cfs);
  const band = coverImg ? bandColor(coverImg, cw, h, cw / 2 - bandW / 2, top, cw / 2 + bandW / 2, top + lines.length * lh + cfs) : null;
  const cink = band ? titleInk(band) : titleInk(face);
  const lineEls = lines.map((line, i) => {
    const chars = [...line];
    const ws = chars.map((c) => (c === ' ' ? cfs * 0.32 : cfont.measureText(c).width));
    const total = ws.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = cw / 2 - total / 2;
    const base = top + i * lh + lh / 2 - (cm.ascent + cm.descent) / 2;
    return chars.map((c, j) => {
      const el = <Glyph key={`${i}-${j}`} x={x} y={base} text={c} font={cfont} color={cink} weight={cfs * weightFor(cink)} />;
      x += ws[j] + spacing;
      return el;
    });
  });
  let authorEl: ReactNode = null;
  if (book.author) {
    // 저자는 제목보다 훨씬 작게, 표지 가운데 폭 안에만(그림 가장자리의 나무·잎에 걸리지 않게)
    let afs = Math.max(6, (cfs / s) * 0.62) * s;
    let afont = Skia.Font(regular, afs);
    const maxW = cw * 0.5;
    let aw = afont.measureText(book.author).width;
    if (aw > maxW) {
      afs = Math.max(afs * 0.7, (afs * maxW) / aw);
      afont = Skia.Font(regular, afs);
      aw = afont.measureText(book.author).width;
    }
    const am = afont.getMetrics();
    const ay = top + lines.length * lh + cfs * 0.2 - am.ascent;
    authorEl = <Text x={cw / 2 - aw / 2} y={ay} text={book.author} font={afont} color={cink} opacity={0.8} />;
  }
  // 표지 장식(그림이 없는 책): 모티프는 표지에만 둔다(책등에는 제목만)
  let coverMotif: ReactNode = null;
  if (!cover && !book.body && book.art.motif !== 'none') {
    const svg = Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? ink));
    const mH = h * 0.4;
    const mw = Math.min(cw * 0.4, (mH * 24) / 60);
    if (svg) coverMotif = <ImageSVG svg={svg} x={cw / 2 - mw / 2} y={h * 0.9 - (mw * 60) / 24} width={mw} height={(mw * 60) / 24} />;
  }
  const coverPic = await record(
    <Group>
      <CoverFaceArt w={cw} h={h} s={s} face={face} tone={face} image={coverImg} motif={book.body ? motif : null} />
      {coverMotif}
      {lineEls}
      {authorEl}
    </Group>,
    cw,
    h,
  );
  const ribbons = (book.quotes ?? 0) > 0 ? await record(<Ribbons book={book} s={s} />, 40 * s, 30 * s) : null;
  // 속지 면(book-parts와 같은 치수): 머리·꼬리는 책등 띠 쪽에도 그늘, 책배는 판 쪽만
  const rig = rigOf(dims);
  const pw = dims.T - 2 * rig.bd;
  const pageEnd = await record(<PageArt w={pw} h={dims.W - rig.sq - rig.sp} s={s} spineBand />, pw * s, (dims.W - rig.sq - rig.sp) * s);
  const pageFore = await record(<PageArt w={pw} h={dims.H - 2 * rig.sq} s={s} spineBand={false} />, pw * s, (dims.H - 2 * rig.sq) * s);
  return { spine, titleV, titleH, cover: coverPic, ribbons, pageEnd, pageFore };
}

// 책 한 권의 기록된 그림(없으면 null → 다음 렌더에서 채워진다)
// shared는 캔버스 밖에서 읽어 넘긴다(Skia 캔버스 안은 별도 렌더러라 React 컨텍스트가 닿지 않는다)
export function useBookArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared): BookArt | null {
  // 모티프 그림은 표지에만 쓴다(그림 없는 표지의 장식). 책등에는 제목만.
  const needMotif = !!book.body?.motif && !book.cover?.image;
  const needCover = !!book.cover?.image;
  const motif = useImage(needMotif ? (book.body?.motif ?? null) : null);
  const coverImg = useImage((book.cover?.image as number) ?? null);
  const ready = shared.regular && (!needMotif || motif) && (!needCover || coverImg);
  // 장정(책 색·모티프)·저자가 바뀌면 다시 기록한다(같은 책 id라도)
  const key = `${book.id}|${s.toFixed(4)}|${dims.T.toFixed(3)}|${dims.H.toFixed(3)}|${dims.W.toFixed(3)}|${book.title}|${book.author ?? ''}|${book.quotes ?? 0}|${faceOf(book)}|${book.art.motif}|${book.art.ribbon ?? ''}`;
  const [art, setArt] = useState<{ key: string; art: BookArt } | null>(() => (done.has(key) ? { key, art: done.get(key)! } : null));
  useEffect(() => {
    if (!ready) return;
    let p = cache.get(key);
    if (!p) {
      // 한 권씩 차례로 기록한다(한꺼번에 하면 앱이 멈춘다)
      pendingArt++;
      p = queue.then(async () => {
        const t0 = Date.now();
        const a = await buildArt(book, s, dims, shared, motif, coverImg);
        artMs += Date.now() - t0;
        builtArt++;
        pendingArt--;
        if (builtArt === 1) bootMark('art-first', `${Date.now() - t0}ms`);
        if (pendingArt === 0) bootMark(`art-idle-${builtArt}`, `books=${builtArt} build=${artMs}ms`);
        return a;
      });
      queue = p.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 0)));
      cache.set(key, p);
    }
    let alive = true;
    p.then((a) => {
      done.set(key, a);
      if (alive) setArt({ key, art: a });
    }).catch((e) => {
      console.warn('book art failed', book.id, String(e?.message ?? e));
      cache.delete(key);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  if (art && art.key === key) return art.art;
  return done.get(key) ?? null;
}
