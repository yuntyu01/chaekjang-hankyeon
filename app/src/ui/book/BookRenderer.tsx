// 책 한 권 렌더링. 형태(책등/가로/정면)만 그리고 회전·외부 그림자는 부모(ShelfRow)가 맡는다.
// 레이어: 기본 형태(얕은 옆면·윗면) → 일러스트 → 제목(앱 조판) → 내부 명암 → 종이 결.
// 시안에서 뽑은 샘플 그림(book.sample)이 그 형태의 것이면 그림을 그대로 쓰고 제목만 얹는다.
import { memo, useId } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { inkFor, shade } from '@/domain/color';
import { bookHeight, bookThickness, FRONT_SIDE, frontWidth, TOP_FACE } from '@/domain/geometry';
import { layoutVerticalTitle } from '@/domain/title-layout';
import type { Book, Pose, SampleArt } from '@/domain/types';
import { MotifArt } from '@/ui/art/motifs';
import { SCENE_TITLE, SceneArt, spineCropViewBox } from '@/ui/art/scenes';
import { PAPER_GRAIN } from '@/ui/art/texture';
import { fonts } from '@/ui/theme';

type Props = { book: Book; pose: Pose; scale: number };

const DARK_INK = '#1F2533';
const PAGE = '#F3EBDC'; // 속지(종이 단면)
const PAGE_LINE = '#DCCDB5';
const LIGHT_INK = '#F2EADB';

export function renderedSize(book: Book, pose: Pose) {
  const h = bookHeight(book);
  const t = bookThickness(book);
  if (pose === 'spine') return { width: t, height: h };
  if (pose === 'horizontal') return { width: h, height: t + TOP_FACE };
  return { width: frontWidth(book) + FRONT_SIDE, height: h };
}

const inkOf = (book: Book) => book.art.inkColor ?? (inkFor(book.themeColor) === '#2A2A2C' ? DARK_INK : LIGHT_INK);
const accentOf = (book: Book) => book.art.accentColor ?? inkOf(book);

function Grain({ opacity = 1 }: { opacity?: number }) {
  return <Image source={PAPER_GRAIN} resizeMode="repeat" style={[StyleSheet.absoluteFill, { opacity }]} />;
}

// 내부 명암: 왼쪽 위 빛, 오른쪽·아래로 약한 어둠(제본 곡면).
function InnerShade({ w, h, horizontal }: { w: number; h: number; horizontal?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2={horizontal ? '0' : '1'} y2={horizontal ? '1' : '0'}>
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.16} />
          <Stop offset="0.12" stopColor="#FFFFFF" stopOpacity={0.03} />
          <Stop offset="0.7" stopColor="#000000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.12} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
    </Svg>
  );
}

// 책등 그림 윗경계를 책 색으로 부드럽게 녹인다.
function FadeTop({ color, top, width, height }: { color: string; top: number; width: number; height: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={{ position: 'absolute', left: 0, top }} width={width} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id}f)`} />
    </Svg>
  );
}

// 그림을 세로로 3단으로 나눠 가운데 빈 띠(band)만 늘린다. 위(제목 자리)·아래(그림) 조각은 원래 비율.
// natural: 그림 원래 높이(px), target: 그려야 할 높이(px)
function BandImage({ source, width, natural, target, band, radius }: { source: SampleArt['image']; width: number; natural: number; target: number; band?: [number, number]; radius?: number }) {
  const extra = target - natural;
  if (!band || Math.abs(extra) < 0.5) {
    return <Image source={source} style={{ width, height: target, borderRadius: radius }} resizeMode="stretch" />;
  }
  const b0 = band[0] * natural;
  const b1 = band[1] * natural;
  const mid = b1 - b0;
  const k = (mid + extra) / mid;
  return (
    <View style={{ width, height: target, borderRadius: radius, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, width, height: b0 + 0.5, overflow: 'hidden' }}>
        <Image source={source} style={{ width, height: natural }} resizeMode="stretch" />
      </View>
      <View style={{ position: 'absolute', left: 0, top: b0, width, height: mid + extra + 0.5, overflow: 'hidden' }}>
        <Image source={source} style={{ position: 'absolute', top: -b0 * k, width, height: natural * k }} resizeMode="stretch" />
      </View>
      <View style={{ position: 'absolute', left: 0, top: b1 + extra, width, height: natural - b1, overflow: 'hidden' }}>
        <Image source={source} style={{ position: 'absolute', top: -b1, width, height: natural }} resizeMode="stretch" />
      </View>
    </View>
  );
}

// 갈피: 저장된 문장이 있는 책에만. 문장 수만큼(최대 2개) 책 위로 8DU 돌출된 끈. 책 몸체 뒤에 그려 아래쪽은 가려진다.
export const RIBBON_OUT = 8;
function Ribbons({ book, cx, scale: s }: { book: Book; cx: number; scale: number }) {
  const n = Math.min(2, book.quotes ?? 0);
  if (!n) return null;
  const color = book.art.ribbon ?? shade(book.themeColor, 0.25);
  const w = 5.4 * s;
  const gap = 1.4 * s;
  const total = n * w + (n - 1) * gap;
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: cx - total / 2 + i * (w + gap),
            top: -(RIBBON_OUT - (i ? 1.8 : 0)) * s,
            width: w,
            height: (RIBBON_OUT + 6) * s,
            backgroundColor: i ? shade(color, 0.18) : color,
            borderTopLeftRadius: 0.8 * s,
            borderTopRightRadius: 0.8 * s,
          }}
        >
          <Grain />
        </View>
      ))}
    </>
  );
}

// 둥근 책등: 원통처럼 가장자리는 어둡고 왼쪽 1/4 지점이 가장 밝다(광원 좌상단).
function SpineShade({ w, h }: { w: number; h: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#000000" stopOpacity={0.16} />
          <Stop offset="0.07" stopColor="#FFFFFF" stopOpacity={0.05} />
          <Stop offset="0.27" stopColor="#FFFFFF" stopOpacity={0.14} />
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="0.86" stopColor="#000000" stopOpacity={0.08} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.2} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}c)`} />
    </Svg>
  );
}

// 속지 띠: 앞뒤 표지판 사이로 보이는 종이 단면. 가는 결 몇 줄.
function PageBand({ width, height, vertical }: { width: number; height: number; vertical?: boolean }) {
  const n = 3;
  return (
    <View style={{ width, height, backgroundColor: PAGE, overflow: 'hidden' }}>
      {Array.from({ length: n }, (_, i) => (
        <View
          key={i}
          style={
            vertical
              ? { position: 'absolute', left: ((i + 1) * width) / (n + 1), top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: PAGE_LINE }
              : { position: 'absolute', top: ((i + 1) * height) / (n + 1), left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: PAGE_LINE }
          }
        />
      ))}
    </View>
  );
}

// 세로 조판: 글자를 바로 세워 쌓는다. 쉼표·마침표는 앞 글자 옆에 붙인다(시안의 "튼,").
function VerticalText({ columns, fs, color, line = 1.14 }: { columns: string[]; fs: number; color: string; line?: number }) {
  return (
    <>
      {[...columns].reverse().map((col, i) => {
        const cells: { ch: string; punct?: string }[] = [];
        for (const ch of col) {
          if ((ch === ',' || ch === '.') && cells.length) cells[cells.length - 1].punct = ch;
          else if (ch === ' ' && cells.at(-1)?.punct) continue;
          else cells.push({ ch });
        }
        return (
          <View key={i} style={{ alignItems: 'center', width: fs * 1.2 }}>
            {cells.map((c, j) =>
              c.ch === ' ' ? (
                <View key={j} style={{ height: fs * 0.45 }} />
              ) : (
                <View key={j} style={{ height: fs * line, justifyContent: 'center' }}>
                  <Text allowFontScaling={false} style={{ fontFamily: fonts.bookTitle, fontSize: fs, lineHeight: fs * line, color, textAlign: 'center' }}>
                    {c.ch}
                  </Text>
                  {c.punct ? (
                    <Text allowFontScaling={false} style={{ position: 'absolute', right: -fs * 0.42, bottom: fs * 0.02, fontFamily: fonts.bookTitle, fontSize: fs, color }}>
                      {c.punct}
                    </Text>
                  ) : null}
                </View>
              ),
            )}
          </View>
        );
      })}
    </>
  );
}

function Spine({ book, scale: s }: { book: Book; scale: number }) {
  const w = bookThickness(book) * s;
  const h = bookHeight(book) * s;
  const sample = book.sample;
  if (sample?.kind === 'spine') {
    const fs = sample.titleSize * s;
    const cap = (sample.cap ?? 0) * s;
    const capColor = sample.capColor ?? sample.color;
    const capW = (sample.capW ?? 1) * w;
    return (
      <View style={{ width: w, height: h }}>
        <Ribbons book={book} cx={w * 0.52} scale={s} />
        {/* 잘라낸 윗부분: 둥근 머리 + 얕은 윗면을 책 색으로 다시 그린다 */}
        <View style={[styles.body, { position: 'absolute', left: 0, top: 0, width: capW, height: cap + 2, backgroundColor: capColor, borderTopLeftRadius: 3.2 * s, borderTopRightRadius: 3.2 * s }]}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.min(cap * 0.55, 2.6 * s), backgroundColor: shade(capColor, 0.1) }} />
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: capW * 0.1, backgroundColor: shade(capColor, -0.1) }} />
          <Grain />
        </View>
        <View style={{ position: 'absolute', left: 0, top: cap }}>
          <BandImage source={sample.image} width={w} natural={(sample.h - (sample.cap ?? 0)) * s} target={h - cap} band={sample.band} />
        </View>
        <View style={{ position: 'absolute', top: (sample.titleTop ?? 0.2) * sample.h * s, left: (sample.titleCx ?? 0.5) * w - w, width: w * 2, flexDirection: 'row', justifyContent: 'center' }}>
          <VerticalText columns={[book.title]} fs={fs} color={sample.ink} />
        </View>
      </View>
    );
  }
  const side = Math.max(2, w * 0.1);
  const face = w - side;
  const ink = inkOf(book);
  const topFace = 3.4 * s; // 얕은 윗면(표지판 + 속지 띠)
  const board = Math.max(1, w * 0.09); // 표지판 두께
  const artTop = h * (sample?.kind === 'cover' || book.art.scene ? 0.6 : 0.55);
  const artH = h * 0.93 - artTop;
  const textTop = h * 0.19;
  const showAuthor = !!book.author && face / s >= 34 && book.author.length <= 6;
  const authorFs = 7 * s; // 최소 가독 크기
  const textH = artTop - textTop - h * 0.03 - (showAuthor ? authorFs * book.author!.length * 1.1 + 4 * s : 0);
  const base = face / s < 30 ? 10 : 11.5;
  const title = layoutVerticalTitle(book.title, textH / s, face / s, [base, base - 1, base - 1.8]);
  const coverW = sample?.kind === 'cover' ? (artH / 0.55) * (sample.w / sample.h) : 0;
  return (
    <View style={{ width: w, height: h }}>
      <Ribbons book={book} cx={face * 0.55} scale={s} />
      <View
        style={[
          styles.body,
          {
            width: w,
            height: h,
            backgroundColor: book.themeColor,
            borderTopLeftRadius: 3.5 * s,
            borderTopRightRadius: 3.5 * s,
            borderBottomLeftRadius: 1.5 * s,
            borderBottomRightRadius: 1.5 * s,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: 'rgba(40, 28, 16, 0.18)',
          },
        ]}>
        {/* 얕은 오른쪽 옆면 */}
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: side, backgroundColor: shade(book.themeColor, -0.11) }} />
        <View style={{ position: 'absolute', right: side, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: shade(book.themeColor, -0.22) }} />
        {/* 얕은 윗면: 앞뒤 표지판이 속지보다 살짝 돌출 */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: topFace, backgroundColor: shade(book.themeColor, 0.06) }} />
        <View style={{ position: 'absolute', left: board, top: 0.9 * s, width: w - board * 2 - side * 0.4 }}>
          <PageBand width={w - board * 2 - side * 0.4} height={topFace - 0.9 * s} vertical />
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, top: topFace, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.18)' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 * s, backgroundColor: shade(book.themeColor, -0.08) }} />
        <View style={{ position: 'absolute', left: 0, width: face, top: artTop, height: artH, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
          {book.spineArtUri ? (
            <Image source={{ uri: book.spineArtUri }} style={{ width: face, height: artH }} resizeMode="cover" />
          ) : sample?.kind === 'cover' ? (
            // 표지 그림의 아래쪽을 책등 폭만큼 크롭(찌그러뜨리지 않음)
            <Image
              source={sample.image}
              style={{ position: 'absolute', bottom: 0, height: artH / 0.55, width: coverW, left: -(coverW - face) * (book.art.spineCropX ?? 0.5) }}
              resizeMode="stretch"
            />
          ) : book.art.scene ? (
            <SceneArt scene={book.art.scene} width={face} height={artH} viewBox={spineCropViewBox(face, artH, book.art.spineCropX)} />
          ) : book.motifImage ? (
            <Image source={book.motifImage} style={{ width: face * 0.86, height: artH }} resizeMode="contain" />
          ) : (
            <MotifArt motif={book.art.motif} width={face * 0.8} height={artH * 0.9} color={accentOf(book)} />
          )}
        </View>
        {sample?.kind === 'cover' || book.art.scene || book.spineArtUri ? <FadeTop color={book.themeColor} top={artTop} width={face} height={artH * 0.14} /> : null}
        <View style={{ position: 'absolute', top: textTop, left: 0, width: face, flexDirection: 'row', justifyContent: 'center' }}>
          <VerticalText columns={title.columns} fs={title.fontSize * s} color={ink} />
        </View>
        {showAuthor ? (
          <View style={{ position: 'absolute', bottom: h - artTop + 2 * s, left: 0, width: face, flexDirection: 'row', justifyContent: 'center', opacity: 0.75 }}>
            <VerticalText columns={[book.author!]} fs={authorFs} color={ink} line={1.08} />
          </View>
        ) : null}
        <SpineShade w={w} h={h} />
        <Grain />
      </View>
    </View>
  );
}

function Horizontal({ book, scale: s }: { book: Book; scale: number }) {
  const len = bookHeight(book) * s;
  const t = bookThickness(book) * s;
  const face = TOP_FACE * s;
  const sample = book.sample?.kind === 'horizontal' ? book.sample : undefined;
  const topColor = sample?.topFace ?? shade(book.themeColor, 0.1);
  const end = Math.max(3 * s, len * 0.03);
  const ink = sample?.ink ?? inkOf(book);
  const fsDU = sample?.titleSize ?? Math.max(8, Math.min(11, bookThickness(book) * 0.27));
  const fs = fsDU * s;
  return (
    <View style={{ width: len, height: t + face }}>
      {/* 윗면(표지 면)이 얕게 보인다 */}
      {sample?.topImage ? (
        <Image source={sample.topImage} style={{ position: 'absolute', left: 3 * s, right: 2 * s, top: 1 * s, height: face + 3 * s, borderTopLeftRadius: 3 * s, borderTopRightRadius: 3 * s }} resizeMode="stretch" />
      ) : <View
        style={[
          styles.body,
          { position: 'absolute', left: 2 * s, right: 1 * s, top: 0, height: face + 4 * s, backgroundColor: topColor, borderTopLeftRadius: 3 * s, borderTopRightRadius: 3 * s },
        ]}>
        <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: end, backgroundColor: shade(topColor, -0.08) }} />
        <Grain />
      </View>}
      <View style={[styles.body, { position: 'absolute', top: face, width: len, height: t, backgroundColor: book.themeColor, borderRadius: 3 * s }]}>
        {sample ? (
          <Image source={sample.image} style={{ width: len, height: t, borderRadius: 3 * s }} resizeMode="stretch" />
        ) : (
          <>
            {/* 오른쪽 끝: 앞뒤 표지판 사이의 속지 단면 */}
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: end, backgroundColor: shade(book.themeColor, -0.12) }}>
              <View style={{ position: 'absolute', top: 1.1 * s, bottom: 1.1 * s, left: 0.6 * s, right: 0 }}>
                <PageBand width={end - 0.6 * s} height={t - 2.2 * s} />
              </View>
            </View>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 * s, backgroundColor: shade(book.themeColor, -0.1) }} />
            <View style={{ position: 'absolute', right: end + len * 0.05, top: t * 0.12, height: t * 0.76, width: t * 0.9, alignItems: 'center', justifyContent: 'center' }}>
              {book.motifImage ? (
                <Image source={book.motifImage} style={{ width: t * 0.9, height: t * 0.76 }} resizeMode="contain" />
              ) : (
                <MotifArt motif={book.art.motif} width={t * 0.5} height={t * 0.76} color={accentOf(book)} />
              )}
            </View>
            <InnerShade w={len} h={t} horizontal />
            <Grain />
          </>
        )}
        <View
          style={{
            position: 'absolute',
            left: (sample?.titleLeft ?? 0.08) * len,
            right: sample ? 0 : end + len * 0.05 + t,
            top: (sample?.titleCy ?? 0.52) * t - fs * 0.75,
            height: fs * 1.5,
            justifyContent: 'center',
          }}>
          <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: fonts.bookTitle, fontSize: fs, lineHeight: fs * 1.5, color: ink, letterSpacing: 0.3 * s }}>
            {book.title}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Front({ book, scale: s }: { book: Book; scale: number }) {
  const fw = frontWidth(book) * s;
  const h = bookHeight(book) * s;
  const side = FRONT_SIDE * s;
  const sample = book.sample?.kind === 'cover' ? book.sample : undefined;
  if (sample) {
    const lines = (sample.coverLines ?? book.title).split('\n');
    const fs = sample.titleSize * s;
    const lh = fs * (sample.titleLine ?? 1.4);
    const full = fw + side;
    return (
      <View style={{ width: full, height: h }}>
        <Ribbons book={book} cx={full * 0.6} scale={s} />
        <BandImage source={sample.image} width={full} natural={sample.h * s} target={h} band={sample.band} radius={3 * s} />
        <View style={{ position: 'absolute', top: (sample.titleTop ?? 0.2) * sample.h * s - (lh - fs) / 2, left: (sample.titleCx ?? 0.5) * full - full, width: full * 2, alignItems: 'center' }}>
          {lines.map((l, i) => (
            <Text key={i} allowFontScaling={false} style={{ fontFamily: fonts.bookTitle, fontSize: fs, lineHeight: lh, color: sample.ink, letterSpacing: lines.length === 1 ? fs * 0.08 : 0 }}>
              {l}
            </Text>
          ))}
        </View>
      </View>
    );
  }
  const scene = book.art.scene;
  const titleStyle = scene ? SCENE_TITLE[scene] : { ink: inkOf(book), top: 0.2 };
  const long = book.title.length > 9;
  const text = long ? splitTwoLines(book.title) : book.title;
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  const fs = Math.max(8, Math.min(14, (frontWidth(book) * 0.78) / (longest * 1.02))) * s;
  return (
    <View style={{ width: fw + side, height: h }}>
      <Ribbons book={book} cx={fw * 0.6} scale={s} />
      {/* 얇은 옆면(오른쪽): 뒤표지판 + 속지 단면 */}
      <View
        style={{
          position: 'absolute',
          left: fw - 2 * s,
          top: 1.5 * s,
          width: side + 2 * s,
          height: h - 1.5 * s,
          backgroundColor: shade(book.themeColor, -0.2),
          borderTopRightRadius: 2 * s,
          borderBottomRightRadius: 2 * s,
          overflow: 'hidden',
        }}>
        <View style={{ position: 'absolute', left: 2 * s, top: 1.2 * s, bottom: 2 * s }}>
          <PageBand width={side - 1.2 * s} height={h - 4.7 * s} vertical />
        </View>
      </View>
      <View style={[styles.body, { width: fw, height: h, backgroundColor: book.themeColor, borderRadius: 3 * s }]}>
        {book.coverArtUri ? (
          <Image source={{ uri: book.coverArtUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : scene ? (
          <SceneArt scene={scene} width={fw} height={h} />
        ) : (
          <View style={{ position: 'absolute', bottom: h * 0.1, left: 0, right: 0, alignItems: 'center' }}>
            {book.motifImage ? (
              <Image source={book.motifImage} style={{ width: fw * 0.5, height: h * 0.45 }} resizeMode="contain" />
            ) : (
              <MotifArt motif={book.art.motif} width={fw * 0.4} height={h * 0.42} color={accentOf(book)} />
            )}
          </View>
        )}
        <View style={{ position: 'absolute', top: h * titleStyle.top, left: fw * 0.08, right: fw * 0.08 }}>
          <Text
            allowFontScaling={false}
            numberOfLines={2}
            style={{ fontFamily: fonts.bookTitle, fontSize: fs, lineHeight: fs * 1.5, color: titleStyle.ink, textAlign: 'center', letterSpacing: long ? 0 : fs * 0.08 }}>
            {text}
          </Text>
        </View>
        {book.author && !scene ? (
          <Text allowFontScaling={false} numberOfLines={1} style={{ position: 'absolute', bottom: h * 0.045, left: fw * 0.1, right: fw * 0.1, textAlign: 'center', fontFamily: fonts.serif, fontSize: Math.max(7, fs / s * 0.6) * s, color: titleStyle.ink, opacity: 0.75 }}>
            {book.author}
          </Text>
        ) : null}
        <View style={{ position: 'absolute', left: fw * 0.05, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.1)' }} />
        <InnerShade w={fw} h={h} />
        <Grain />
      </View>
    </View>
  );
}

// 긴 표지 제목은 단어 경계에서 두 줄로 나눈다(단어 중간에서 끊기지 않게).
export function splitTwoLines(title: string) {
  const words = title.split(' ');
  if (words.length < 2) return title;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

export const BookRenderer = memo(function BookRenderer({ book, pose, scale }: Props) {
  if (pose === 'spine') return <Spine book={book} scale={scale} />;
  if (pose === 'horizontal') return <Horizontal book={book} scale={scale} />;
  return <Front book={book} scale={scale} />;
});

const styles = StyleSheet.create({
  body: { overflow: 'hidden' },
});
