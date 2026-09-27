// 책 한 권 렌더링. 형태(책등/가로/정면)만 그리고 회전·외부 그림자는 부모(ShelfRow)가 맡는다.
// 레이어: 기본 형태 → 일러스트 → 제목(앱 조판) → 내부 명암.
import { memo, useId } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { inkFor, shade } from '@/domain/color';
import { bookHeight, bookThickness, FRONT_SIDE, frontWidth, TOP_FACE } from '@/domain/geometry';
import { layoutVerticalTitle } from '@/domain/title-layout';
import type { Book, Pose } from '@/domain/types';
import { MotifArt } from '@/ui/art/motifs';
import { SCENE_TITLE, SceneArt, spineCropViewBox } from '@/ui/art/scenes';
import { fonts } from '@/ui/theme';

type Props = { book: Book; pose: Pose; scale: number };

export function renderedSize(book: Book, pose: Pose) {
  const h = bookHeight(book);
  const t = bookThickness(book);
  if (pose === 'spine') return { width: t, height: h };
  if (pose === 'horizontal') return { width: h, height: t + TOP_FACE };
  return { width: frontWidth(book) + FRONT_SIDE, height: h };
}

function accentOf(book: Book) {
  return book.art.accentColor ?? inkFor(book.themeColor);
}

// 내부 명암: 왼쪽 위 빛, 오른쪽·아래 제본선 쪽 약한 어둠.
function InnerShade({ w, h, horizontal }: { w: number; h: number; horizontal?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} pointerEvents="none">
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2={horizontal ? '0' : '1'} y2={horizontal ? '1' : '0'}>
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
          <Stop offset="0.16" stopColor="#FFFFFF" stopOpacity={0.04} />
          <Stop offset="0.6" stopColor="#000000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.2} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${id}g)`} />
    </Svg>
  );
}

function Spine({ book, scale }: { book: Book; scale: number }) {
  const w = bookThickness(book) * scale;
  const h = bookHeight(book) * scale;
  const ink = book.art.inkColor ?? inkFor(book.themeColor);
  const artH = h * (book.art.scene ? 0.36 : 0.3);
  const textTop = h * 0.09;
  const textH = h - textTop - artH - h * 0.05;
  const base = w < 30 * scale ? 11 : 12.5;
  const title = layoutVerticalTitle(book.title, textH / scale, w / scale, [base, base - 1, base - 1.8]);
  const fs = title.fontSize * scale;
  return (
    <View style={[styles.body, { width: w, height: h, backgroundColor: book.themeColor, borderRadius: 2.5 * scale }]}>
      <View style={[styles.cap, { height: 3.5 * scale, backgroundColor: shade(book.themeColor, 0.16) }]} />
      <View style={[styles.verticalTitle, { top: textTop, height: textH }]}>
        {[...title.columns].reverse().map((col, i) => (
          <View key={i} style={{ alignItems: 'center', width: fs * 1.18 }}>
            {[...col].map((ch, j) =>
              ch === ' ' ? (
                <View key={j} style={{ height: fs * 0.45 }} />
              ) : (
                <Text
                  key={j}
                  allowFontScaling={false}
                  style={{ fontFamily: fonts.serif, fontSize: fs, lineHeight: fs * 1.12, color: ink, textAlign: 'center' }}>
                  {ch}
                </Text>
              ),
            )}
          </View>
        ))}
      </View>
      <View style={[styles.art, { height: artH }]}>
        {book.spineArtUri ? (
          <Image source={{ uri: book.spineArtUri }} style={{ width: w, height: artH }} resizeMode="cover" />
        ) : book.art.scene ? (
          <SceneArt scene={book.art.scene} width={w} height={artH} viewBox={spineCropViewBox(w, artH, book.art.spineCropX)} />
        ) : (
          <MotifArt motif={book.art.motif} width={w * 0.78} height={artH * 0.86} color={accentOf(book)} />
        )}
      </View>
      <View style={[styles.ridge, { top: h * 0.055, backgroundColor: shade(book.themeColor, -0.12) }]} />
      <InnerShade w={w} h={h} />
    </View>
  );
}

function Horizontal({ book, scale }: { book: Book; scale: number }) {
  const len = bookHeight(book) * scale;
  const t = bookThickness(book) * scale;
  const face = TOP_FACE * scale;
  const ink = book.art.inkColor ?? inkFor(book.themeColor);
  // 가로 제목: 한 줄에 맞게 제한 범위 안에서만 줄이고, 그래도 넘치면 말줄임
  const availDU = bookHeight(book) - 12 - bookThickness(book) * 0.9;
  const fitDU = Math.max(9.5, Math.min(12.5, bookThickness(book) * 0.4, availDU / (book.title.length * 0.98)));
  const fs = fitDU * scale;
  const twoLines = bookThickness(book) >= 40 && book.title.length * fitDU > availDU;
  return (
    <View style={{ width: len, height: t + face }}>
      {/* 윗면(표지 면)을 얕게 보여준다 */}
      <View
        style={{
          position: 'absolute',
          left: 1.5 * scale,
          right: 0,
          top: 0,
          height: face + 2 * scale,
          backgroundColor: shade(book.themeColor, 0.14),
          borderTopLeftRadius: 3 * scale,
          borderTopRightRadius: 3 * scale,
        }}
      />
      <View style={[styles.body, { position: 'absolute', top: face, width: len, height: t, backgroundColor: book.themeColor, borderRadius: 2.5 * scale }]}>
        <View style={{ position: 'absolute', left: 12 * scale, right: t * 0.9, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Text
            allowFontScaling={false}
            numberOfLines={twoLines ? 2 : 1}
            style={{ fontFamily: fonts.serif, fontSize: fs, lineHeight: fs * 1.25, color: ink }}>
            {book.title}
          </Text>
        </View>
        <View style={{ position: 'absolute', right: 6 * scale, bottom: t * 0.08, height: t * 0.84, width: t * 0.5, alignItems: 'center' }}>
          {book.spineArtUri ? (
            <Image source={{ uri: book.spineArtUri }} style={{ width: t * 0.5, height: t * 0.84 }} resizeMode="contain" />
          ) : (
            <MotifArt motif={book.art.motif} width={t * 0.5} height={t * 0.84} color={accentOf(book)} />
          )}
        </View>
        <InnerShade w={len} h={t} horizontal />
      </View>
    </View>
  );
}

function Front({ book, scale }: { book: Book; scale: number }) {
  const fw = frontWidth(book) * scale;
  const h = bookHeight(book) * scale;
  const side = FRONT_SIDE * scale;
  const scene = book.art.scene;
  const titleStyle = scene ? SCENE_TITLE[scene] : { ink: book.art.inkColor ?? inkFor(book.themeColor), top: 0.14 };
  const long = book.title.length > 9;
  const text = long ? splitTwoLines(book.title) : book.title;
  // 가장 긴 줄이 표지 폭(80%)에 들어가는 크기. 9 아래로는 줄이지 않는다.
  const longest = Math.max(...text.split('\n').map((l) => l.length));
  const fs = Math.max(9, Math.min(14.5, (frontWidth(book) * 0.8) / (longest * 1.02))) * scale;
  return (
    <View style={{ width: fw + side, height: h }}>
      {/* 얇은 옆면(오른쪽) */}
      <View
        style={{
          position: 'absolute',
          left: fw - 2 * scale,
          top: 2 * scale,
          width: side + 2 * scale,
          height: h - 2 * scale,
          backgroundColor: shade(book.themeColor, -0.28),
          borderTopRightRadius: 2 * scale,
          borderBottomRightRadius: 2 * scale,
        }}
      />
      <View style={[styles.body, { width: fw, height: h, backgroundColor: book.themeColor, borderRadius: 3 * scale }]}>
        {book.coverArtUri ? (
          <Image source={{ uri: book.coverArtUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : scene ? (
          <SceneArt scene={scene} width={fw} height={h} />
        ) : (
          <View style={{ position: 'absolute', bottom: h * 0.1, left: 0, right: 0, alignItems: 'center' }}>
            <MotifArt motif={book.art.motif} width={fw * 0.4} height={h * 0.42} color={accentOf(book)} />
          </View>
        )}
        <View style={{ position: 'absolute', top: h * titleStyle.top, left: fw * 0.1, right: fw * 0.1 }}>
          <Text
            allowFontScaling={false}
            numberOfLines={2}
            style={{
              fontFamily: fonts.serif,
              fontSize: fs,
              lineHeight: fs * 1.4,
              color: titleStyle.ink,
              textAlign: 'center',
              letterSpacing: long ? 0 : 1.5 * scale,
            }}>
            {text}
          </Text>
        </View>
        {/* 제본선 */}
        <View style={{ position: 'absolute', left: fw * 0.055, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(0,0,0,0.12)' }} />
        <View style={{ position: 'absolute', left: fw * 0.055 + 1, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <InnerShade w={fw} h={h} />
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
  cap: { position: 'absolute', left: 0, right: 0, top: 0 },
  ridge: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0.6 },
  verticalTitle: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  art: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
});
