// 책 면 그림과 조판을 Skia Picture로 한 번 기록해 두고(책·배율마다 캐시), 매 프레임은 면 변환만 바꿔 그린다.
// - 책등 면: 몸체(명암·붓결·가장자리·장면 그림)
// - 책등 글자 칸·작은 모티프: 칸마다 따로(원점 가운데). 누울 때 바로 세우려고 면과 따로 둔다.
// - 표지 면: 표지 그림 + 제목·저자
// - 갈피: 머리 뒤에서 나오는 끈(원점 = 아래 가운데)
import { AlphaType, ColorType, Group, ImageSVG, LinearGradient, Path, Skia, Text, drawAsPicture, useImage, useTypeface, vec, type SkFont, type SkImage, type SkPicture, type SkTypeface } from '@shopify/react-native-skia';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { BRUSH_DETAIL } from '@/domain/body-art.generated';
import { rgbHex, shade, TITLE_LIGHT, titleInk } from '@/domain/color';
import { COVER_LINE_H, coverTitleLayout, spineTitleLayout } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { motifSvg } from '@/ui/art/motifs';
import { CoverFaceArt, SpineFaceArt, spineMotifRect } from '@/ui/book/BookBody';

const BOLD = require('@expo-google-fonts/gowun-batang/700Bold/GowunBatang_700Bold.ttf');
const REGULAR = require('@expo-google-fonts/gowun-batang/400Regular/GowunBatang_400Regular.ttf');

export type Shared = { bold: SkTypeface | null; regular: SkTypeface | null; grain: SkImage | null };
const Ctx = createContext<Shared>({ bold: null, regular: null, grain: null });

// 앱 뿌리에 한 번: 제목 글꼴과 붓결 질감
export function BookArtProvider({ children }: { children: ReactNode }) {
  const bold = useTypeface(BOLD);
  const regular = useTypeface(REGULAR);
  const grain = useImage(BRUSH_DETAIL);
  return <Ctx.Provider value={{ bold, regular, grain }}>{children}</Ctx.Provider>;
}

export const useBookShared = () => useContext(Ctx);

// 책등 글자 칸: 칸 가운데(cx, cy)에 원점을 둔 글자(x, y = 원점 기준 글자 기준선 위치)
// cyLie: 누웠을 때(가로로 읽힐 때)의 자리. 세로 줄 간격 대신 글자 폭만큼 붙인다.
export type Cell = { cx: number; cy: number; cyLie: number; ch: string; pic: SkPicture };
export type Motif = { cx: number; cy: number; w: number; h: number; image: SkImage | null; svg: ReturnType<typeof Skia.SVG.MakeFromString> };
export type BookArt = {
  spine: SkPicture;
  cells: Cell[];
  font: SkFont; // 책등 글자
  ink: string;
  motif: Motif | null; // 책등 작은 모티프(원점 = 가운데)
  fontDU: number; // 책등 글자 크기(DU)
  cover: SkPicture;
  ribbons: SkPicture | null;
};

const faceOf = (b: Book) => b.body?.face ?? b.themeColor;
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
export const toneOf = (b: Book, cover: boolean) => (cover ? b.cover?.edge : undefined) ?? faceOf(b);

export const RIBBON_OUT = 12; // 시안: 갈피가 책 위로 약 13DU
export const SPINE_FACE = 0.94; // 책등 글자·그림이 놓이는 폭(오른쪽 끝은 옆면으로 꺾이는 곳)

function Ribbons({ book, s }: { book: Book; s: number }) {
  const n = Math.min(2, book.quotes ?? 0);
  const color = book.art.ribbon ?? shade(book.themeColor, 0.25);
  const w = 6.8 * s;
  const gap = 2.4 * s;
  const hidden = 1.2 * s; // 뿌리: 머리 면에 살짝 묻힌다
  const total = n * w + (n - 1) * gap;
  return (
    <Group>
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
        const tone = i ? shade(color, 0.12) : color;
        const path = Skia.Path.Polygon(pts, true);
        const tip = Skia.Path.Polygon([pts[1], pts[2], { x: pts[2].x, y: pts[2].y + 0.9 * s }, { x: pts[1].x, y: pts[1].y + 0.9 * s }], true);
        return (
          <Group key={i} transform={[{ translateX: x + w / 2 }, { translateY: hidden }, { rotate: ((i ? 4 : -6) * Math.PI) / 180 }, { translateX: -(x + w / 2) }, { translateY: -hidden }]}>
            <Path path={path}>
              <LinearGradient start={vec(x, 0)} end={vec(x + w, 0)} colors={[shade(tone, 0.12), tone, shade(tone, -0.1)]} positions={[0, 0.45, 1]} />
            </Path>
            <Path path={path} style="stroke" strokeWidth={0.45 * s} color={shade(tone, -0.25)} opacity={0.55} strokeJoin="round" />
            <Path path={tip} color="#FFFFFF" opacity={0.18} />
          </Group>
        );
      })}
    </Group>
  );
}

async function record(el: ReactNode, w: number, h: number) {
  return drawAsPicture(<Group>{el}</Group>, Skia.XYWHRect(-w, -h, w * 3, h * 3));
}

const cache = new Map<string, Promise<BookArt>>();
const done = new Map<string, BookArt>(); // 이미 기록된 것(다시 그릴 때 한 프레임도 비지 않게)
let queue: Promise<unknown> = Promise.resolve();

async function buildArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared, motif: SkImage | null, coverImg: SkImage | null): Promise<BookArt> {
  const bold = shared.bold!;
  const regular = shared.regular!;
  const face = faceOf(book);
  const ink = inkOf(book);
  // 책등
  const w = dims.T * s;
  const h = dims.H * s;
  const fw = w * SPINE_FACE;
  // 그림이 제목 아래가 아니라 책등 가운데 띠에 잡힌 장정(누운 책 끝 표식처럼 쓰는 모티프)은 제목 뒤 끝에 작게 둔다
  const endMark = !!book.body && book.body.motifTop < 0.3;
  const t = endMark
    ? spineTitleLayout(book.title, dims.H, fw / s, 0.82, 1.12)
    : spineTitleLayout(book.title, dims.H, fw / s, book.body?.motifTop ?? 0.58, book.body?.motifBottom ?? 0.93);
  const art = book.body && t.artTop !== book.body.motifTop ? { ...book.body, motifTop: t.artTop } : book.body;
  const spine = await record(<SpineFaceArt id={book.id} w={w} h={h} s={s} face={face} art={art} grain={shared.grain} motif={motif} />, w, h);
  const fs = t.fontSize * s;
  // 책등 글자: 보통 굵기(시안처럼 획이 가늘어 좁은 책등에서 튀지 않게)
  const font = Skia.Font(regular, fs);
  const cells: Cell[] = [];
  const colW = fs * 1.2;
  const cols = [...t.columns].reverse();
  const x0 = fw / 2 - (cols.length * colW) / 2;
  for (let c = 0; c < cols.length; c++) {
    const list: { ch: string; punct?: string }[] = [];
    for (const ch of cols[c]) {
      if ((ch === ',' || ch === '.') && list.length) list[list.length - 1].punct = ch;
      else list.push({ ch });
    }
    let y = t.textTop * h;
    let yl = t.textTop * h;
    const lieFs = fs * Math.min(1, (0.42 * dims.T) / t.fontSize);
    for (const cell of list) {
      if (cell.ch === ' ') {
        // 띄어쓰기(쉼표 뒤도): 시안처럼 반 글자 남짓 띄운다
        y += fs * 0.5;
        yl += lieFs * 0.35;
        continue;
      }
      const ch = fs * t.pitch;
      const gw = font.measureText(cell.ch).width;
      const fm = font.getMetrics();
      const gy = -(fm.ascent + fm.descent) / 2;
      const pic = await record(
        <Group>
          <Glyph x={-gw / 2} y={gy} text={cell.ch} font={font} color={ink} weight={fs * weightFor(ink)} />
          {cell.punct ? <Glyph x={gw / 2 - fs * 0.05} y={fs * 0.5} text={cell.punct} font={font} color={ink} weight={fs * weightFor(ink)} /> : null}
        </Group>,
        fs * 2,
        fs * 2,
      );
      cells.push({ cx: x0 + (c + 0.5) * colW, cy: y + ch / 2, cyLie: yl + (lieFs * 1.02) / 2, ch: cell.ch, pic });
      y += ch;
      yl += lieFs * 1.02 + (cell.punct ? lieFs * 0.3 : 0);
    }
  }
  // 작은 모티프(바로 세울 수 있게 따로)
  let motifCell: BookArt['motif'] = null;
  const r = spineMotifRect(art, motif, h, fw);
  if (r && motif) {
    motifCell = { image: motif, svg: null, cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h };
  } else if (!book.body) {
    const svg = Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? ink));
    const top = t.artTop * h;
    const mh = (h * 0.93 - top) * 0.9;
    const mw = Math.min(fw * 0.8, (mh * 24) / 60);
    const mH = (mw * 60) / 24;
    if (svg) motifCell = { image: null, svg, cx: fw / 2, cy: h * 0.93 - mH / 2, w: mw, h: mH };
  }
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
  const cink = band ? titleInk(band) : titleInk(toneOf(book, true));
  const ainkc = cink;
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
    authorEl = <Text x={cw / 2 - aw / 2} y={ay} text={book.author} font={afont} color={ainkc} opacity={0.8} />;
  }
  let coverMotif: ReactNode = null;
  if (!cover && !book.body) {
    const svg = Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? ink));
    const mH = h * 0.4;
    const mw = Math.min(cw * 0.4, (mH * 24) / 60);
    if (svg) coverMotif = <ImageSVG svg={svg} x={cw / 2 - mw / 2} y={h * 0.9 - (mw * 60) / 24} width={mw} height={(mw * 60) / 24} />;
  }
  const coverPic = await record(
    <Group>
      <CoverFaceArt id={book.id} w={cw} h={h} s={s} face={face} tone={toneOf(book, true)} image={coverImg} motif={book.body ? motif : null} grain={shared.grain} />
      {coverMotif}
      {lineEls}
      {authorEl}
    </Group>,
    cw,
    h,
  );
  const ribbons = (book.quotes ?? 0) > 0 ? await record(<Ribbons book={book} s={s} />, 40 * s, 30 * s) : null;
  return { spine, cells, font, ink, motif: motifCell, fontDU: t.fontSize, cover: coverPic, ribbons };
}

// 책 한 권의 기록된 그림(없으면 null → 다음 렌더에서 채워진다)
// shared는 캔버스 밖에서 읽어 넘긴다(Skia 캔버스 안은 별도 렌더러라 React 컨텍스트가 닿지 않는다)
export function useBookArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared): BookArt | null {
  const motif = useImage(book.body?.motif ?? null);
  const coverImg = useImage((book.cover?.image as number) ?? null);
  const needMotif = !!book.body?.motif;
  const needCover = !!book.cover?.image;
  const ready = shared.bold && shared.regular && shared.grain && (!needMotif || motif) && (!needCover || coverImg);
  const key = `${book.id}|${s.toFixed(4)}|${dims.T.toFixed(3)}|${dims.H.toFixed(3)}|${dims.W.toFixed(3)}|${book.title}|${book.quotes ?? 0}`;
  const [art, setArt] = useState<{ key: string; art: BookArt } | null>(() => (done.has(key) ? { key, art: done.get(key)! } : null));
  useEffect(() => {
    if (!ready) return;
    let p = cache.get(key);
    if (!p) {
      // 한 권씩 차례로 기록한다(한꺼번에 하면 앱이 멈춘다)
      p = queue.then(() => buildArt(book, s, dims, shared, motif, coverImg));
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
