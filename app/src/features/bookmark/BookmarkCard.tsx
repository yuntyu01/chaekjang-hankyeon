import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { RealCover } from '@/ui/kit';
import { PaperSurface } from '@/ui/PaperSurface';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';
import { Bookmark } from '@/ui/icons';

export const CARD_PAPER = screenTheme.paper;
export const PAGE_BG = colors.bg;
export type BookmarkCardData = { text: string; title: string; author?: string; page?: number; date: string; memo?: string; color: string; coverUri?: string; book?: Book };

export function quoteType(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 36) return { size: 25, lh: 43 };
  if (n <= 80) return { size: 24, lh: 40 };
  if (n <= 160) return { size: 21, lh: 36 };
  return { size: 19, lh: 33 };
}

export function WordWrap({ text, style, maxLines }: { text: string; style: StyleProp<TextStyle>; maxLines?: number }) {
  return <Text style={style} numberOfLines={maxLines} textBreakStrategy="highQuality">{text}</Text>;
}

function paperTone(color: string) {
  const c = /^#([\da-f]{6})$/i.exec(color)?.[1];
  if (!c) return { paper: '#ABC3D4', tape: '#9BBAD3', ink: '#739BB8' };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (g > r && g > b) return { paper: '#BBC6AA', tape: '#B4C19D', ink: '#728366' };
  if (b > r || b > g) return { paper: '#ABC3D4', tape: '#9BBAD3', ink: '#739BB8' };
  return { paper: '#EFBEA6', tape: '#EDB49B', ink: '#D9967B' };
}

export function BookmarkCard({ data, showMemo, width, seed, compact = false, rasterizeBook = false, onCoverReady, onOpen, saved = false, onToggleSaved }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string; compact?: boolean; rasterizeBook?: boolean; onCoverReady?: () => void; onOpen?: () => void; saved?: boolean; onToggleSaved?: () => void }) {
  const qt = compact ? { size: 23.5, lh: 36 } : quoteType(data.text);
  const cardW = compact ? width - 8 : width * 0.857;
  const coverW = compact ? 67 : 97;
  const tone = paperTone(data.color);
  const date = compact ? data.date.replace(/^\d{4}[.\-/](\d{1,2})[.\-/](\d{1,2}).*$/, (_, m, d) => `${Number(m)}월 ${Number(d)}일`) : data.date;
  return (
    <View style={{ width, paddingTop: compact ? 17 : 37, paddingBottom: compact ? 15 : 38, alignItems: 'center' }}>
      <View style={[st.sheet, { width: cardW - (compact ? 5 : 36), transform: [{ translateX: compact ? 0 : 6 }, { rotate: compact ? '-3deg' : '-10deg' }], top: compact ? 23 : 15, bottom: compact ? 18 : 28, backgroundColor: '#F3E4CE' }]}>
        <PaperSurface pigmented color="#F3E4CE" grain={0.08} radius={8} />
      </View>
      <View style={[st.sheet, { width: cardW - (compact ? -1 : 17), transform: [{ rotate: compact ? '2.5deg' : '7deg' }], top: compact ? 15 : 30, bottom: compact ? 16 : 34, backgroundColor: tone.paper }]}>
        <PaperSurface pigmented color={tone.paper} grain={0.12} radius={8} />
      </View>
      <View style={[st.card, { width: cardW, borderRadius: compact ? 12 : 9, transform: [{ translateX: compact ? 0 : 8 }, { rotate: compact ? '-0.7deg' : '-1deg' }] }]}>
        <PaperSurface grain={0.065} radius={compact ? 12 : 9} />
        <Pressable disabled={!onOpen} onPress={onOpen} accessible={!!onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? `${data.text}, ${data.title}` : undefined} style={({ pressed }) => ({ paddingHorizontal: compact ? 28 : 32, paddingTop: compact ? 20 : 36, paddingBottom: compact ? 12 : 38, opacity: pressed ? 0.75 : 1 })}>
        <View style={[st.tape, { backgroundColor: tone.tape, width: compact ? 39 : 44, height: compact ? 41 : 45, right: compact ? 20 : 16, top: compact ? -16 : -13 }]}>
          <PaperSurface pigmented color={tone.tape} grain={0.19} radius={2} />
          <Svg pointerEvents="none" width="100%" height={2} viewBox="0 0 44 2" preserveAspectRatio="none" style={{ position: 'absolute', bottom: -0.8 }}><Path d="M0 0H44V.4L40 .8L36 .5L32 1.2L27 .6L23 1L19 .4L15 .9L10 .5L6 1.1L2 .6L0 .8Z" fill={tone.tape} /></Svg>
        </View>
        <View style={[st.pageRow, compact && { minHeight: 24 }]}><View style={[st.bar, { backgroundColor: tone.ink, height: compact ? 19 : 27 }]} /><Text style={st.pageTop}>{data.page ? `p. ${data.page}` : '남긴 문장'}</Text></View>
        <View style={{ marginTop: compact ? 16 : 33 }}>
          <WordWrap text={data.text} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} maxLines={compact ? 4 : undefined} />
        </View>
        <View style={[st.rule, { marginTop: compact ? 15 : 31, marginBottom: compact ? 10 : 17 }]} />
        <View style={[st.srcRow, { gap: compact ? 13 : 16 }]}>
          {data.book ? <BookVisual book={data.book} width={coverW} rasterize={rasterizeBook} onReady={onCoverReady} /> : <RealCover uri={data.coverUri} title={data.title} color={data.color} width={coverW} />}
          <View style={{ flex: 1, gap: compact ? 3 : 8, marginTop: compact ? 0 : -4, paddingRight: compact && onToggleSaved ? 32 : 0 }}>
            <Text style={[st.srcTitle, { fontSize: compact ? 13.5 : 14 }]} numberOfLines={compact ? 2 : undefined}>{data.title}{data.author ? ` · ${data.author}` : ''}</Text>
            {!compact && data.page ? <Text style={st.meta}>p. {data.page}</Text> : null}
            <Text style={st.meta}>{date}</Text>
          </View>
        </View>
        {showMemo && data.memo ? <><View style={[st.rule, { marginTop: 18, marginBottom: 20 }]} /><WordWrap text={data.memo} style={st.memo} /></> : null}
        </Pressable>
        {compact && onToggleSaved ? <Pressable onPress={onToggleSaved} accessibilityRole="button" accessibilityLabel={saved ? '아껴둔 갈피에서 빼기' : '갈피 아껴두기'} accessibilityState={{ selected: saved }} style={st.save}><Bookmark size={22} strokeWidth={1.45} color="#716A61" fill={saved ? '#897369' : 'none'} /></Pressable> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { position: 'absolute', borderRadius: 8, borderTopWidth: 0.75, borderLeftWidth: 0.75, borderColor: 'rgba(255,255,255,0.8)', boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 4, color: 'rgba(128,89,47,0.10)' }, { offsetX: 1, offsetY: 10, blurRadius: 14, color: 'rgba(141,98,55,0.10)' }] },
  card: { backgroundColor: CARD_PAPER, borderWidth: 0.8, borderTopWidth: 1, borderColor: '#FFFDFA', borderRadius: 10, boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 2, color: 'rgba(118,78,42,0.12)' }, { offsetX: 1, offsetY: 8, blurRadius: 17, color: 'rgba(123,79,37,0.16)' }] },
  save: { position: 'absolute', bottom: 14, right: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tape: { position: 'absolute', borderRadius: 2, borderTopWidth: 0.8, borderLeftWidth: 0.5, borderColor: 'rgba(255,255,255,0.55)', transform: [{ rotate: '0.7deg' }], boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 1.5, color: 'rgba(83,68,42,0.12)' }, { offsetX: 0, offsetY: 5, blurRadius: 4, color: 'rgba(118,84,44,0.12)' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 17, minHeight: 28, marginLeft: -9 },
  bar: { width: 3, borderRadius: 1.5 },
  pageTop: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 22, color: '#9D958E', includeFontPadding: false },
  quote: { fontFamily: fonts.serif, color: '#292725', letterSpacing: -0.45, includeFontPadding: false },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: '#D4CDC4' },
  srcRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -3 },
  srcTitle: { fontFamily: fonts.serif, color: '#34302C', lineHeight: 24, includeFontPadding: false, letterSpacing: -0.2 },
  meta: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 20, color: '#A09891', includeFontPadding: false },
  memo: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 26, color: '#38332D', includeFontPadding: false },
});
