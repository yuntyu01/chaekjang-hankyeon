import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { RealCover } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';
import { Bookmark } from '@/ui/icons';
import { BookmarkPaper } from './BookmarkPaper';
import { BookmarkTape } from './BookmarkTape';

export const CARD_PAPER = '#FCF7F0';
export const PAGE_BG = colors.bg;
export type BookmarkCardData = { text: string; title: string; author?: string; page?: number; date: string; memo?: string; color: string; coverUri?: string; book?: Book };

export function quoteType(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 36) return { size: 27.5, lh: 46 };
  if (n <= 80) return { size: 25, lh: 41 };
  if (n <= 160) return { size: 22, lh: 37 };
  return { size: 19, lh: 33 };
}

export function WordWrap({ text, style, maxLines }: { text: string; style: StyleProp<TextStyle>; maxLines?: number }) {
  return <Text style={style} numberOfLines={maxLines} textBreakStrategy="highQuality">{text}</Text>;
}

function paperTone(color: string) {
  const c = /^#([\da-f]{6})$/i.exec(color)?.[1];
  if (!c) return { paper: '#ABC4D6', tape: '#99B6CF', ink: '#6896B5' };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (g > r && g > b) return { paper: '#BAC5AB', tape: '#A5B195', ink: '#718569' };
  if (b > r || b > g) return { paper: '#ABC4D6', tape: '#99B6CF', ink: '#6896B5' };
  return { paper: '#EDC0A9', tape: '#ECC0AA', ink: '#E0A08A' };
}

export function BookmarkCard({ data, showMemo, width, seed, compact = false, rasterizeBook = false, onCoverReady, onOpen, saved = false, onToggleSaved }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string; compact?: boolean; rasterizeBook?: boolean; onCoverReady?: () => void; onOpen?: () => void; saved?: boolean; onToggleSaved?: () => void }) {
  const qt = compact ? { size: 25, lh: 36 } : quoteType(data.text);
  const cardW = compact ? width - 8 : width * 0.857;
  const coverW = compact ? 67 : 97;
  const tone = paperTone(data.color);
  const date = compact ? data.date.replace(/^\d{4}[.\-/](\d{1,2})[.\-/](\d{1,2}).*$/, (_, m, d) => `${Number(m)}월 ${Number(d)}일`) : data.date;
  return (
    <View style={{ width, paddingTop: compact ? 17 : 37, paddingBottom: compact ? 15 : 38, alignItems: 'center' }}>
      {/* In the list, cream tapers behind the front sheet on the left; colour
          projects at the upper right and lower left, as in the reference. */}
      <View style={[st.sheet, { width: cardW - (compact ? 14 : 36), borderRadius: compact ? 5 : 8, transform: [{ translateX: compact ? -8 : 6 }, { rotate: compact ? '-5.2deg' : '-10deg' }], top: compact ? 20 : 15, bottom: compact ? 19 : 28, backgroundColor: '#F3E6D4' }]}>
        <BookmarkPaper color="#F3E6D4" colored radius={compact ? 5 : 8} seed={`${seed}-back`} />
      </View>
      <View style={[st.sheet, { width: cardW - (compact ? -5 : 17), transform: [{ translateX: compact ? -1 : 0 }, { rotate: compact ? '3.6deg' : '7deg' }], top: compact ? 20 : 30, bottom: compact ? 11.5 : 34, backgroundColor: tone.paper }]}>
        <BookmarkPaper color={tone.paper} colored radius={8} seed={`${seed}-color`} />
      </View>
      <View style={[st.card, compact && st.compactShadow, { width: cardW, borderRadius: compact ? 12 : 9, transform: [{ translateX: compact ? 0 : 8 }, { rotate: compact ? '-0.7deg' : '-1deg' }] }]}>
        <BookmarkPaper color={CARD_PAPER} radius={compact ? 12 : 9} seed={`${seed}-front`} />
        <Pressable disabled={!onOpen} onPress={onOpen} accessible={!!onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? `${data.text}, ${data.title}` : undefined} style={({ pressed }) => ({ paddingHorizontal: compact ? 30 : 33, paddingTop: compact ? 20 : 36, paddingBottom: compact ? 12 : 34, opacity: pressed ? 0.75 : 1 })}>
        <View pointerEvents="none" style={[st.tape, { right: compact ? 20 : 16, top: compact ? -16 : -13 }]}>
          <BookmarkTape color={tone.tape} seed={`${seed}-tape`} width={compact ? 39 : 44} height={compact ? 43 : 45} paperEdge={compact ? 16 : 13} />
        </View>
        <View style={[st.pageRow, compact && { minHeight: 24 }]}><View style={[st.bar, { backgroundColor: tone.ink, height: compact ? 19 : 27 }]} /><Text style={st.pageTop}>{data.page ? `p. ${data.page}` : '남긴 문장'}</Text></View>
        <View style={{ marginTop: compact ? 16 : 33 }}>
          <WordWrap text={data.text} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} maxLines={compact ? 4 : undefined} />
        </View>
        <View style={[st.rule, { marginTop: compact ? 15 : 30, marginBottom: compact ? 10 : 17 }]} />
        <View style={[st.srcRow, { gap: compact ? 13 : 16 }]}>
          {data.book ? <BookVisual book={data.book} width={coverW} rasterize={rasterizeBook} onReady={onCoverReady} /> : <RealCover uri={data.coverUri} title={data.title} color={data.color} width={coverW} />}
          <View style={{ flex: 1, gap: compact ? 3 : 8, marginTop: compact ? 0 : -4, paddingRight: compact && onToggleSaved ? 32 : 0 }}>
            <Text style={[st.srcTitle, { fontSize: compact ? 14.5 : 15.5 }]} numberOfLines={compact ? 2 : undefined}>{data.title}{data.author ? ` · ${data.author}` : ''}</Text>
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
  sheet: { position: 'absolute', borderRadius: 8, borderTopWidth: 0.7, borderLeftWidth: 0.5, borderBottomWidth: 0.6, borderColor: 'rgba(255,253,245,0.65)', borderBottomColor: 'rgba(144,117,85,0.20)', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(119,88,57,0.14)' }, { offsetX: 1, offsetY: 7, blurRadius: 15, color: 'rgba(143,107,67,0.17)' }] },
  // A narrow contact shadow holds the sheets together; the soft lower shadow
  // describes their lift from the page without darkening the illuminated top.
  card: { backgroundColor: CARD_PAPER, borderWidth: 0.7, borderTopWidth: 1, borderColor: '#FFFDFA', borderBottomColor: '#E8DCCB', borderRadius: 10, boxShadow: [{ offsetX: 0, offsetY: 1.2, blurRadius: 2.2, color: 'rgba(118,85,55,0.16)' }, { offsetX: 1.5, offsetY: 11, blurRadius: 25, color: 'rgba(139,101,60,0.30)' }, { offsetX: 0, offsetY: 18, blurRadius: 36, color: 'rgba(146,111,72,0.085)' }] },
  compactShadow: { boxShadow: [{ offsetX: 0, offsetY: 1.2, blurRadius: 2.2, color: 'rgba(118,85,55,0.15)' }, { offsetX: 1, offsetY: 7, blurRadius: 16, color: 'rgba(139,101,60,0.20)' }] },
  save: { position: 'absolute', bottom: 14, right: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tape: { position: 'absolute', transform: [{ rotate: '0.7deg' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 17, minHeight: 28, marginLeft: -9 },
  bar: { width: 3, borderRadius: 1.5 },
  pageTop: { fontFamily: fonts.serif, fontSize: 14, lineHeight: 22, color: '#9D958E', includeFontPadding: false },
  quote: { fontFamily: fonts.serif, color: '#292725', letterSpacing: -0.45, includeFontPadding: false },
  rule: { height: 0.65, backgroundColor: '#D8D0C6' },
  srcRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -3 },
  srcTitle: { fontFamily: fonts.serif, color: '#34302C', lineHeight: 24, includeFontPadding: false, letterSpacing: -0.2 },
  meta: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 20, color: '#A09891', includeFontPadding: false },
  memo: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 28, color: '#38332D', includeFontPadding: false },
});
