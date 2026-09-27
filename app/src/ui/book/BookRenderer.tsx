// 책 한 권 렌더링. 형태(책등/가로/정면)는 코드 몸체(BookBody), 재료는 평평한 그림 자산, 제목·저자는 앱이 조판한다.
// 회전·외부 그림자는 부모(ShelfRow)가 맡는다. 같은 책의 모든 자세는 같은 색·모티프·그림을 공유한다.
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { inkFor, shade } from '@/domain/color';
import { bookHeight, bookThickness, FRONT_SIDE, frontWidth, TOP_FACE } from '@/domain/geometry';
import { spineTitleLayout } from '@/domain/title-layout';
import type { Book, Pose } from '@/domain/types';
import { MotifArt } from '@/ui/art/motifs';
import { fonts } from '@/ui/theme';

import { CoverBody, faceWidth, LyingBody, SpineBody, spineView } from './BookBody';

// view: 가운데 시점(-1 왼쪽 끝 ~ 1 오른쪽 끝). 선반 밖(상세·서랍)에서는 0(정면).
type Props = { book: Book; pose: Pose; scale: number; view?: number };

const DARK_INK = '#1F2533';
const LIGHT_INK = '#F2EADB';

export function renderedSize(book: Book, pose: Pose) {
  const h = bookHeight(book);
  const t = bookThickness(book);
  if (pose === 'spine') return { width: t, height: h };
  if (pose === 'horizontal') return { width: h, height: t + TOP_FACE };
  return { width: frontWidth(book) + FRONT_SIDE, height: h };
}

const faceOf = (book: Book) => book.body?.face ?? book.themeColor;
const inkOf = (book: Book) => book.art.inkColor ?? (inkFor(faceOf(book)) === '#2A2A2C' ? DARK_INK : LIGHT_INK);

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

// 갈피: 저장된 문장이 있는 책에만. 문장 수만큼(최대 2개) 책 위로 8DU 돌출된 끈. 책 몸체 뒤에 그려 아래쪽은 가려진다.
export const RIBBON_OUT = 12; // 시안: 갈피가 책 위로 약 13DU
function Ribbons({ book, cx, scale: s }: { book: Book; cx: number; scale: number }) {
  const n = Math.min(2, book.quotes ?? 0);
  if (!n) return null;
  const color = book.art.ribbon ?? shade(book.themeColor, 0.25);
  const w = 8 * s;
  const gap = 2 * s;
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
            overflow: 'hidden',
            borderTopLeftRadius: 0.8 * s,
            borderTopRightRadius: 0.8 * s,
            // 시안처럼 끈이 살짝 벌어져 있다
            transformOrigin: 'center bottom',
            transform: [{ rotate: i ? '3deg' : '-4deg' }],
          }}
        >
          <View style={[StyleSheet.absoluteFill, { borderLeftWidth: 0.5 * s, borderLeftColor: 'rgba(255,255,255,0.22)' }]} />
        </View>
      ))}
    </>
  );
}

// 세운 책: 제목은 앞면 가운데에 세로로, 그림 위에. 긴 제목은 그림을 밀어내고, 그래도 넘치면 두 열·말줄임(최소 9DU).
function Spine({ book, scale: s, view }: { book: Book; scale: number; view: number }) {
  const w = bookThickness(book) * s;
  const h = bookHeight(book) * s;
  const { side, mirror } = spineView(view);
  const fw = faceWidth(w, side);
  const x0 = mirror ? w - fw : 0;
  const ink = inkOf(book);
  const t = spineTitleLayout(book.title, h / s, fw / s, book.body?.motifTop ?? 0.58);
  const art = book.body && t.artTop !== book.body.motifTop ? { ...book.body, motifTop: t.artTop } : book.body;
  const artTop = t.artTop * h;
  return (
    <View style={{ width: w, height: h }}>
      <Ribbons book={book} cx={x0 + fw * 0.55} scale={s} />
      <SpineBody id={book.id} width={w} height={h} scale={s} face={faceOf(book)} art={art} view={view} />
      {!book.body ? (
        <View style={{ position: 'absolute', left: x0, width: fw, top: artTop, height: h * 0.93 - artTop, alignItems: 'center', justifyContent: 'flex-end' }}>
          <MotifArt motif={book.art.motif} width={fw * 0.8} height={(h * 0.93 - artTop) * 0.9} color={book.art.accentColor ?? ink} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', top: t.textTop * h, left: x0, width: fw, flexDirection: 'row', justifyContent: 'center' }}>
        <VerticalText columns={t.columns} fs={t.fontSize * s} color={ink} />
      </View>
    </View>
  );
}

// 누운 책: 같은 몸체를 눕히고, 제목은 가로로 다시 조판(글자를 돌리지 않는다).
function Horizontal({ book, scale: s }: { book: Book; scale: number }) {
  const len = bookHeight(book) * s;
  const t = bookThickness(book) * s;
  const topFace = TOP_FACE * s;
  const H = t + topFace;
  const ink = inkOf(book);
  const faceT = t * 0.9;
  // 제목은 모티프 앞까지. 한 줄에 들어가도록 줄이되 9DU 아래로는 줄이지 않는다(그 이하는 말줄임).
  const availDU = (len * (1 - 0.08) - (t * 0.62 + len * 0.1)) / s;
  const units = [...book.title].reduce((n, ch) => n + (ch === ' ' ? 0.35 : 1), 0);
  const fs = Math.max(9, Math.min(12.5, (faceT / s) * 0.3, availDU / (units * 1.02))) * s;
  return (
    <View style={{ width: len, height: H }}>
      <LyingBody id={book.id} width={len} height={H} scale={s} face={faceOf(book)} art={book.body} topFace={topFace} />
      {!book.body ? (
        <View style={{ position: 'absolute', right: len * 0.07, top: topFace + t * 0.15, width: t * 0.6, height: t * 0.7 }}>
          <MotifArt motif={book.art.motif} width={t * 0.6} height={t * 0.7} color={book.art.accentColor ?? ink} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: len * 0.08, right: t * 0.62 + len * 0.1, top: H - faceT, height: faceT, justifyContent: 'center' }}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: fonts.bookTitle, fontSize: fs, color: ink, letterSpacing: 0.3 * s }}>
          {book.title}
        </Text>
      </View>
    </View>
  );
}

// 표지 전시: 평평한 표지 그림(없으면 책 색 + 모티프) 위에 제목·저자를 가운데 조판.
function Front({ book, scale: s, view }: { book: Book; scale: number; view: number }) {
  const fw = frontWidth(book) * s;
  const h = bookHeight(book) * s;
  const side = FRONT_SIDE * s;
  const cover = book.cover;
  const ink = cover?.ink ?? inkOf(book);
  const mirror = view > 0.02; // 가운데보다 오른쪽이면 왼쪽 옆면이 보인다
  const cx0 = mirror ? side : 0;
  const long = book.title.length > 9;
  const text = long ? splitTwoLines(book.title) : book.title;
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  const fs = Math.max(9, Math.min(15, (frontWidth(book) * 0.8) / (longest * 1.05))) * s;
  return (
    <View style={{ width: fw + side, height: h }}>
      <Ribbons book={book} cx={cx0 + fw * 0.6} scale={s} />
      <CoverBody id={book.id} width={fw} height={h} scale={s} face={faceOf(book)} side={side} cover={cover?.image} art={book.body} mirror={mirror} />
      {!cover && !book.body ? (
        <View style={{ position: 'absolute', bottom: h * 0.1, left: cx0, width: fw, alignItems: 'center' }}>
          <MotifArt motif={book.art.motif} width={fw * 0.4} height={h * 0.4} color={book.art.accentColor ?? ink} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', top: (cover?.titleTop ?? 0.2) * h, left: cx0 + fw * 0.08, width: fw * 0.84, alignItems: 'center' }}>
        <Text allowFontScaling={false} style={{ fontFamily: fonts.bookTitle, fontSize: fs, lineHeight: fs * 1.45, color: ink, textAlign: 'center', letterSpacing: long ? 0 : fs * 0.06 }}>
          {text}
        </Text>
        {book.author ? (
          <Text allowFontScaling={false} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: fs * 0.35, fontFamily: fonts.serif, fontSize: Math.max(7, fs / s * 0.52) * s, color: ink, opacity: 0.85 }}>
            {book.author}
          </Text>
        ) : null}
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

export const BookRenderer = memo(function BookRenderer({ book, pose, scale, view = 0 }: Props) {
  if (pose === 'spine') return <Spine book={book} scale={scale} view={view} />;
  if (pose === 'horizontal') return <Horizontal book={book} scale={scale} />;
  return <Front book={book} scale={scale} view={view} />;
});

