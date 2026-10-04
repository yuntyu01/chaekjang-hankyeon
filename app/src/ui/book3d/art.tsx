// 책 면 그림과 조판을 Skia Picture로 한 번 기록해 두고(책·배율마다 캐시), 매 프레임은 면 변환만 바꿔 그린다.
// - 책등 면: 무광 바탕과 미세한 명암. 작은 장식은 제목과 함께 자세별로 기록한다.
// - 책등 제목: 조판 두 가지를 따로 기록한다. 세운 책등은 세로(글자를 바로 세워 쌓음), 눕힌 책등은 가로 한 줄.
//   둘 다 책등 면 그림 좌표에 고정되어 몸체와 함께 돈다(글자를 따로 돌리지 않는다). 어느 쪽을 보일지는 자세가 정한다(BookNode).
// - 표지 면: 표지 그림(달·풍경 등) + 제목(시안처럼 제목만. 저자는 표지에 쓰지 않는다)
// - 갈피: 머리 뒤에서 나오는 끈(원점 = 아래 가운데)
import { BlurMask, ColorType, AlphaType, Group, LinearGradient, PaintStyle, StrokeJoin, ImageSVG, Path, Picture, Rect, Skia, Text, vec, drawAsPicture, useImage, useTypeface, type SkFont, type SkImage, type SkPicture, type SkTypeface } from '@shopify/react-native-skia';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { rgbHex, shade, TITLE_LIGHT, titleInk } from '@/domain/color';
import { COVER_LINE_H, COVER_SPACE, COVER_TRACK, coverTitleLayout, LYING_TRACK, lyingTitleLayout, SPINE_SPACE, spineTitleLayout } from '@/domain/title-layout';
import type { Book } from '@/domain/types';
import { motifSvg } from '@/ui/art/motifs';
import { bootMark } from '@/ui/boot-trace';
import { GROOVE, rigOf } from '@/domain/book-parts';
import { jacketColor, jacketFor, LANDSCAPES } from '@/domain/book-design';
import { hasRibbon, ribbonDesign } from '@/domain/ribbon-design';
import { CoverFaceArt, PAGE_BASE, PAGE_RIM, SpineFaceArt, withAlpha as withAlphaHex } from '@/ui/book/BookBody';
import { ReferenceCover } from './ReferenceCover';
import { ReferenceBinding, referenceBinding, bindingSurfaceTone } from './ReferenceBinding';
import { MaterialGrain } from './MaterialGrain';
import { ORIGINAL_ART, ReferenceGlyph, ReferenceMotif, ReferencePrint, drawOriginalGlyph, hasOriginalGlyph, hasReferenceMotif, referencePrint } from './ReferencePrint';

const REGULAR = require('@expo-google-fonts/gowun-batang/400Regular/GowunBatang_400Regular.ttf');

// 제목은 보통 굵기 + 윤곽 덧그리기로 굵기를 정하므로 Skia에는 보통 굵기 글꼴 하나만 읽는다(굵은 글꼴 8MB를 따로 읽지 않는다)
export type Shared = { regular: SkTypeface | null; original: SkImage | null };
const Ctx = createContext<Shared>({ regular: null, original: null });

// 앱 뿌리에 한 번: 제목 글꼴
export function BookArtProvider({ children }: { children: ReactNode }) {
  const regular = useTypeface(REGULAR);
  const original = useImage(ORIGINAL_ART);
  useEffect(() => {
    if (regular) bootMark('skia-font-regular');
  }, [regular]);
  return <Ctx.Provider value={{ regular, original }}>{children}</Ctx.Provider>;
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
  prelitCover: boolean;
  prelitSpine: boolean;
  spineHorizontal: boolean;
};

// 책 몸체 색 하나: 표지판·책등·판 끝이 모두 같은 색이다(같은 책의 판 두 장과 책등). 표지 그림이 있는 책은 그 판 색(가장자리 색)을 쓴다.
const faceOf = (b: Book) => jacketColor(b.cover?.edge ?? b.body?.face ?? b.themeColor);
export const inkOf = (b: Book) => b.art.inkColor ?? titleInk(faceOf(b));

// 제목 획 두께: 보통 굵기 글꼴에 글자 크기의 일부만큼 같은 색 윤곽을 더해 중간 굵기로(글자 모양·크기는 그대로).
// 시안의 제목 획은 보통 굵기보다 약 30% 두껍고, 가는 획은 실제 표시 크기에서 바탕에 묻혀 옅어 보인다.
// 어두운 바탕의 밝은 글자는 번져 보여 같은 두께도 더 굵게 읽히므로 덧그리는 두께를 조금 줄인다(바탕·글자색에 따른 공통 규칙).
// 책등·눕힘 제목: 시안 책장 같은 글자(모순·데미안·어린 왕자)의 잉크 면적에 맞춘 중간 굵기(예전 0.03/0.022는 17~26% 굵었다)
export const TITLE_WEIGHT = 0.014;
export const TITLE_WEIGHT_LIGHT = 0.010;
// 앞표지 제목: 시안 표지 제목 획은 글자 높이의 약 10%(보통 굵기 약 8%)라 조금 더 굵게
export const COVER_WEIGHT = 0.017;
const weightFor = (ink: string) => (ink === TITLE_LIGHT ? TITLE_WEIGHT_LIGHT : TITLE_WEIGHT);
function Glyph({ x, y, text, font, color, weight, original }: { x: number; y: number; text: string; font: SkFont; color: string; weight: number; original: SkImage }) {
  if (hasOriginalGlyph(text)) return <ReferenceGlyph image={original} text={text} font={font} x={x} y={y} color={color} />;
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
      const gw = font.measureText(cell.ch).width;
      const cy = y + ch / 2;
      if (!drawOriginalGlyph(c,original,cell.ch,font,cx-gw/2,cy+gy,ink)) for (const p of paints) c.drawText(cell.ch,cx-gw/2,cy+gy,p,font);
      if (cell.punct) for (const p of paints) c.drawText(cell.punct,cx+gw/2-fs*0.05,cy+fs*0.5,p,font);
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
export const toneOf = (b: Book, _cover?: boolean) => bindingSurfaceTone(faceOf(b));

export const SPINE_FACE = 0.94; // 세운 책등 제목 크기를 정할 때 쓰는 폭(책등 폭의 94%. 글자는 책등 가운데)

// 갈피 끈: 시안처럼 한 가닥, 곧게 선 납작한 띠(위 끝 모서리만 작게 둥글림). 균일한 무광 색(외곽선·광택 없음).
// 원점 = 책 머리 가운데, 위가 음수. 뿌리는 머리 면 속지 사이로 조금 묻힌다.
function Ribbons({ book, s }: { book: Book; s: number }) {
  const color = book.art.ribbon ?? shade(book.themeColor, 0.25);
  const design = ribbonDesign(book);
  const w = design.width * s;
  const hidden = 1.2 * s;
  const top = -design.out * s;
  const r = 1.5 * s;
  const path = Skia.PathBuilder.Make();
  path.moveTo(-w / 2, hidden);
  path.lineTo(-w / 2, top + r);
  path.quadTo(-w / 2, top, -w / 2 + r, top);
  path.lineTo(w / 2 - r, top);
  path.quadTo(w / 2, top, w / 2, top + r);
  path.lineTo(w / 2, hidden);
  path.close();
  return (
    <Group transform={[{ translateX: design.x * s }, { translateY: design.y * s }]}>
      {/* 갈피가 종이 묶음 사이로 들어가는 자리: 아주 옅은 틈 그늘 */}
      <Rect x={-w / 2 - 0.4 * s} y={hidden - 0.7 * s} width={w + 0.8 * s} height={1.2 * s} color="rgba(96,74,52,0.12)">
        <BlurMask blur={0.45 * s} style="normal" />
      </Rect>
      <Path path={path.detach()} color={color} />
    </Group>
  );
}

// 속지 면(판 사이, 판 끝보다 안쪽). w×h DU를 배율 s로. 밝은 아이보리 바탕 + 판(과 책등 띠) 쪽 좁은 그늘(결 줄은 두지 않는다:
// 휴대폰 크기에서 머리 면을 나누는 이음선처럼 보였다). 그늘은 책 좌표에 붙어 있어 세우기·눕히기·돌리기에도 같은 자리다. 밝기는 그릴 때 면마다 덧칠한다.
function PageArt({ w, h, s, spineBand }: { w: number; h: number; s: number; spineBand: boolean }) {
  const W = w * s;
  const H = h * s;
  // 판 쪽 그늘은 아주 좁고 옅게(시안 머리 면에는 베이지 안쪽 띠가 없다)
  const band = Math.max(0.3, Math.min(0.6, w * 0.12)) * s;
  const rim = withAlphaHex(PAGE_RIM, 0.06);
  return (
    <Group clip={Skia.XYWHRect(0, 0, W, H)}>
      <Rect x={0} y={0} width={W} height={H} color={PAGE_BASE} />
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient start={vec(0, 0)} end={vec(W, 0)} colors={['#EAD9BE', '#FBF2E2', '#FFF6E7', '#F0E2CC']} positions={[0, 0.16, 0.72, 1]} />
      </Rect>
      {Array.from({ length: spineBand ? 0 : Math.max(1, Math.floor(w / 2.8)) }, (_, i) => (
        <Rect key={i} x={(1.1 + i * 2.8) * s} y={0} width={0.12 * s} height={H} color="rgba(158,132,98,0.06)" />
      ))}
      <MaterialGrain w={W} h={H} s={s} strength={0.12} />
      <Rect x={-band} y={-band} width={2 * band} height={H + 2 * band} color={rim}>
        <BlurMask blur={0.4 * s} style="normal" />
      </Rect>
      <Rect x={W - band} y={-band} width={2 * band} height={H + 2 * band} color={rim}>
        <BlurMask blur={0.4 * s} style="normal" />
      </Rect>
      {spineBand ? (
        <Rect x={-band} y={-band} width={W + 2 * band} height={2 * band} color={rim}>
          <BlurMask blur={0.4 * s} style="normal" />
        </Rect>
      ) : null}
    </Group>
  );
}

async function record(el: ReactNode, w: number, h: number) {
  return drawAsPicture(<Group>{el}</Group>, Skia.XYWHRect(-w, -h, w * 3, h * 3));
}

// 그림 기록 키에 넣는 디자인 판(조판·몸체 규칙을 바꾸면 올린다: 빠른 새로고침에서도 예전 규칙으로 기록한 그림을 다시 쓰지 않게)
const DESIGN_REV = 'continuous-jacket-light-10';
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
  // 책등: 공통 바탕 + 자세별 제목과 장식. 눕힐 때 장식도 바로 선다.
  const w = dims.T * s;
  const h = dims.H * s;
  const spineMotif = book.art.motif === 'none' ? null : Skia.SVG.MakeFromString(motifSvg(book.art.motif, book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C')));
  const compactMotif = ['moon', 'crescent', 'star', 'star-solid', 'asterisk', 'cloud', 'wave', 'book'].includes(book.art.motif);
  const motifCap = ({ asterisk: 12.5, 'star-solid': 12.5, cloud: 15.5, book: 15 } as Record<string, number>)[book.art.motif] ?? (compactMotif ? 17 : 14);
  const motifW = Math.min(w * (compactMotif ? 0.58 : 0.45), motifCap * s) * (book.art.motifScale ?? 1);
  const motifH = motifW * 2.5;
  const motifCenter = ({ 'star-solid': 0.71, cloud: 0.785, wave: 0.875, book: 0.87 } as Record<string, number>)[book.art.motif] ?? 0.835;
  const motifY = compactMotif ? h * motifCenter - motifH / 2 : h * (book.art.motifBottom ?? 0.90) - motifH;
  // 실제 사용자 제목은 길이가 달라진다. 장식의 윗끝보다 먼저 조판을
  // 끝내서 마지막 글자와 잎·꽃이 겹치지 않도록 공간을 먼저 확보한다.
  const textEnd = book.art.titleTop !== undefined ? 0.79 : book.art.motif === 'none' ? 0.88 : Math.max(0.50, (motifY + (compactMotif ? motifH * 0.28 : 0) - 4 * s) / h);
  const binding = referenceBinding(face);
  const spine = await record(binding ? <ReferenceBinding material={binding} w={w} h={h} s={s} /> : <SpineFaceArt w={w} h={h} face={face} s={s} />, w, h);
  const motifGlyph = hasReferenceMotif(book.art.motif) ? <ReferenceMotif image={shared.original!} id={book.art.motif} color={book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C')} /> : spineMotif ? <ImageSVG svg={spineMotif} x={0} y={0} width={24} height={60} /> : null;
  const print = referencePrint(book.title);
  const printV = print?.pose === 'spine' ? print : undefined;
  const printH = print?.pose === 'horizontal' ? print : undefined;
  const accent = book.art.accentColor ?? (ink === TITLE_LIGHT ? '#F4DCA3' : '#8B9C7C');
  const titleV = await record(<Group>
    {printV ? <ReferencePrint image={shared.original!} template={printV} w={w} h={h} ink={ink} accent={accent} decoration={printV.motif === book.art.motif} /> : <Picture picture={verticalTitlePicture(book.title, dims, s, regular, ink, shared.original!, book.art.titleTop, textEnd)} />}
    {printV?.motif === book.art.motif ? null : <Group transform={[{ translateX: (w - motifW) / 2 }, { translateY: motifY }, { scale: motifW / 24 }]}>{motifGlyph}</Group>}
  </Group>, w, h);
  // Counter-rotate the small illustration so it stays upright on a lying spine.
  const lyingMotifW = Math.min(12.5 * s, w * 0.39) * (book.art.motifScale ?? 1);
  const titleH = await record(<Group>
    {printH ? <ReferencePrint image={shared.original!} template={printH} w={w} h={h} ink={ink} accent={accent} decoration={printH.motif === book.art.motif} /> : <Picture picture={lyingTitlePicture(book.title, dims, s, regular, ink, shared.original!, !!spineMotif)} />}
    {printH?.motif === book.art.motif ? null : <Group transform={[{ translateX: w / 2 }, { translateY: h * 0.89 }, { rotate: Math.PI / 2 }]}>
      <Group transform={[{ translateX: -lyingMotifW / 2 }, { translateY: -lyingMotifW * 1.25 }, { scale: lyingMotifW / 24 }]}>{motifGlyph}</Group>
    </Group>}
  </Group>, w, h);
  // 표지(앞표지 그림 + 제목). 시안 표지에는 저자가 없다.
  const cw = dims.W * s;
  const cover = jacketFor(book);
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
  const band = coverImg && !cover.sourceRect ? bandColor(coverImg, cw, h, cx0 - bandW / 2, top, cx0 + bandW / 2, top + lines.length * lh) : null;
  const cink = cover.sourceRect ? cover.ink : band ? titleInk(band) : titleInk(face);
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
    const mH = h * 0.4;
    const mw = Math.min(cw * 0.4, (mH * 24) / 60);
    if (svg) coverMotif = <ImageSVG svg={svg} x={cw / 2 - mw / 2} y={h * 0.9 - (mw * 60) / 24} width={mw} height={(mw * 60) / 24} />;
  }
  const originalCover = !!coverImg && !!cover.sourceRect;
  const retainTitle = originalCover && book.title.replace(/\s/g, '') === cover.printedTitle?.replace(/\s/g, '');
  const coverPic = await record(
    <Group>
      {originalCover ? <ReferenceCover image={coverImg!} cover={cover} w={cw} h={h} retainTitle={retainTitle} /> : <CoverFaceArt w={cw} h={h} s={s} face={toneOf(book)} tone={toneOf(book)} image={coverImg} motif={book.body ? motif : null} />}
      {coverMotif}
      {book.art.plainCover || retainTitle ? null : lineEls}
    </Group>,
    cw,
    h,
  );
  const ribbons = hasRibbon(book) ? await record(<Ribbons book={book} s={s} />, 40 * s, 30 * s) : null;
  // 속지 면(book-parts와 같은 치수): 머리·꼬리는 책등 띠 쪽에도 그늘, 책배는 판 쪽만
  const rig = rigOf(dims);
  const pw = dims.T - 2 * rig.bd;
  const pageEnd = await record(<PageArt w={pw} h={dims.W - rig.sq - rig.sp} s={s} spineBand />, pw * s, (dims.W - rig.sq - rig.sp) * s);
  const pageFore = await record(<PageArt w={pw} h={dims.H - 2 * rig.sq} s={s} spineBand={false} />, pw * s, (dims.H - 2 * rig.sq) * s);
  return { spine, titleV, titleH, cover: coverPic, ribbons, pageEnd, pageFore, prelitCover: originalCover, prelitSpine: !!binding, spineHorizontal: binding?.horizontal ?? false };
}

// 책 한 권의 기록된 그림(없으면 null → 다음 렌더에서 채워진다)
// shared는 캔버스 밖에서 읽어 넘긴다(Skia 캔버스 안은 별도 렌더러라 React 컨텍스트가 닿지 않는다)
export function useBookArt(book: Book, s: number, dims: { T: number; H: number; W: number }, shared: Shared): BookArt | null {
  // 기존 비트맵 모티프는 표지용. 책등의 작은 장식은 벡터로 기록한다.
  const needMotif = !!book.body?.motif && !book.cover?.image;
  const cover = jacketFor(book);
  const needCover = !!cover.image && !book.art.plainCover;
  const motif = useImage(needMotif ? (book.body?.motif ?? null) : null);
  const customCoverImg = useImage(book.art.plainCover || cover.sourceRect ? null : cover.image);
  const coverImg = book.art.plainCover ? null : cover.sourceRect ? shared.original : customCoverImg;
  const ready = shared.regular && shared.original && (!needMotif || motif) && (!needCover || coverImg);
  // 장정(책 색·모티프)·저자가 바뀌면 다시 기록한다(같은 책 id라도)
  const key = `${DESIGN_REV}|${book.id}|${s.toFixed(4)}|${dims.T.toFixed(3)}|${dims.H.toFixed(3)}|${dims.W.toFixed(3)}|${book.title}|${book.quotes ?? 0}|${faceOf(book)}|${book.art.motif}|${book.art.ribbonVisible ?? 'auto'}|${book.art.ribbon ?? ''}|${book.art.accentColor ?? ''}|${book.art.titleTop ?? ''}|${book.art.motifScale ?? ''}|${book.art.motifBottom ?? ''}|${book.art.plainCover ?? false}|${inkOf(book)}|${cover.image}|${cover.titleTop}|${JSON.stringify(cover.sourceRect)}`;
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
