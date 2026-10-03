import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { RealCover } from '@/ui/kit';
import { mix } from '@/ui/book/BookBody';
import { colors, fonts, screenTheme } from '@/ui/screenTheme';

export const CARD_PAPER = '#FFFCF5';
export const PAGE_BG = colors.bg;
export type BookmarkCardData = { text: string; title: string; author?: string; page?: number; date: string; memo?: string; color: string; coverUri?: string; book?: Book };

export function quoteType(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 36) return { size: 27, lh: 44 };
  if (n <= 80) return { size: 24, lh: 40 };
  if (n <= 160) return { size: 21, lh: 36 };
  return { size: 19, lh: 33 };
}

// Native text keeps line limits correct when the system font size changes.
export function WordWrap({ text, style, maxLines }: { text: string; style: StyleProp<TextStyle>; maxLines?: number }) {
  return <Text style={style} numberOfLines={maxLines} textBreakStrategy="highQuality">{text}</Text>;
}

export function BookmarkCard({ data, showMemo, width, seed, compact = false }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string; compact?: boolean }) {
  const qt = compact ? { size: 21, lh: 34 } : quoteType(data.text);
  const cardW = width - (compact ? 14 : 48);
  const coverW = compact ? 47 : 74;
  const accent = mix(data.color, '#A3B8C5', 0.7);
  return (
    <View style={{ width, paddingTop: compact ? 14 : 42, paddingBottom: compact ? 18 : 40, alignItems: 'center' }}>
      <View style={[st.sheet, { width: cardW - 8, backgroundColor: '#EAE1D2', transform: [{ rotate: compact ? '-1.5deg' : '-6deg' }], top: compact ? 14 : 30, bottom: compact ? 13 : 26 }]} />
      <View style={[st.sheet, { width: cardW - 4, backgroundColor: mix(accent, '#FCF8F1', 0.5), transform: [{ rotate: compact ? '1.5deg' : '5deg' }], top: compact ? 10 : 25, bottom: compact ? 19 : 43 }]} />
      <View style={[st.card, { width: cardW, padding: compact ? 23 : 28, paddingBottom: compact ? 21 : 32 }]}>
        <View style={[st.tape, { backgroundColor: accent, width: compact ? 22 : 30, height: compact ? 32 : 44 }]} />
        <View style={st.pageRow}><View style={[st.bar, { backgroundColor: accent }]} /><Text style={st.pageTop}>{data.page ? `p. ${data.page}` : '남긴 문장'}</Text></View>
        <View style={{ marginTop: compact ? 16 : 25 }}>
          <WordWrap text={data.text} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} maxLines={compact ? 5 : undefined} />
        </View>
        <View style={[st.rule, { marginVertical: compact ? 18 : 26 }]} />
        <View style={st.srcRow}>
          {data.book ? <BookVisual book={data.book} width={coverW} /> : <RealCover uri={data.coverUri} title={data.title} color={data.color} width={coverW} />}
          <View style={{ flex: 1, gap: 5, paddingTop: 3 }}>
            <Text style={[st.srcTitle, { fontSize: compact ? 15 : 17 }]} numberOfLines={compact ? 2 : undefined}>{data.title}</Text>
            {data.author ? <Text style={st.meta}>{data.author}</Text> : null}
            {!compact && data.page ? <Text style={st.meta}>p. {data.page}</Text> : null}
            <Text style={[st.meta, { marginTop: compact ? 3 : 6 }]}>{data.date}</Text>
          </View>
        </View>
        {showMemo && data.memo ? <><View style={st.rule} /><WordWrap text={data.memo} style={st.memo} /></> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  sheet: { position: 'absolute', borderRadius: 9 },
  card: { backgroundColor: CARD_PAPER, borderWidth: 1, borderColor: '#FFFDF8', borderRadius: 10, ...screenTheme.shadow },
  tape: { position: 'absolute', right: 22, top: -7, opacity: 0.9, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { width: 3, height: 21, borderRadius: 1 },
  pageTop: { fontSize: 13, color: colors.inkSoft },
  quote: { fontFamily: fonts.serif, color: colors.ink, letterSpacing: -0.3 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: screenTheme.border, marginVertical: 24 },
  srcRow: { flexDirection: 'row', gap: 15, alignItems: 'center' },
  srcTitle: { fontFamily: fonts.serifBold, color: colors.ink, lineHeight: 25 },
  meta: { fontSize: 12.5, color: colors.inkSoft },
  memo: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 28, color: colors.inkSoft },
});
