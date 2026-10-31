import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { RealCover } from '@/ui/kit';
import { colors, fonts, press } from '@/ui/screenTheme';
import { Bookmark } from '@/ui/icons';
import { BookmarkPaper } from './BookmarkPaper';
import { BookmarkTape } from './BookmarkTape';
import { PhotoPlate } from './PhotoPlate';

// 갈피 종이: 화면 바탕(흰색)과 같은 계열. 앞 종이는 흰색(그림자로 구분), 뒤 종이는 노란기 없는 옅은 회백색,
// 책 색에 따른 색 종이·테이프는 원래 색을 흰 바탕 쪽으로 섞어 연하게(종이 45%, 테이프 35%). 왼쪽 막대(ink)는 원래 색.
export const CARD_PAPER = '#FFFFFF';
export const BACK_PAPER = '#F0EDE8';
export const PAGE_BG = colors.bg;
export type BookmarkCardData = { text: string; title: string; author?: string; page?: number; date: string; memo?: string; color: string; coverUri?: string; book?: Book; photoUri?: string; photoRatio?: number };

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
  if (!c) return { paper: '#D0DEE8', tape: '#BCCFDF', ink: '#6896B5' };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (g > r && g > b) return { paper: '#D9DFD0', tape: '#C4CCB9', ink: '#718569' };
  if (b > r || b > g) return { paper: '#D0DEE8', tape: '#BCCFDF', ink: '#6896B5' };
  return { paper: '#F5DCCF', tape: '#F2D6C7', ink: '#E0A08A' };
}

export function BookmarkCard({ data, showMemo, width, seed, compact = false, rasterizeBook = false, onCoverReady, onPhotoReady, onOpen, saved = false, onToggleSaved }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string; compact?: boolean; rasterizeBook?: boolean; onCoverReady?: () => void; onPhotoReady?: () => void; onOpen?: () => void; saved?: boolean; onToggleSaved?: () => void }) {
  const qt = compact ? { size: 25, lh: 36 } : quoteType(data.text);
  const cardW = compact ? width - 8 : width * 0.857;
  const coverW = compact ? 67 : 97;
  const tone = paperTone(data.color);
  const photo = !!data.photoUri;
  const date = compact ? data.date.replace(/^\d{4}[.\-/](\d{1,2})[.\-/](\d{1,2}).*$/, (_, m, d) => `${Number(m)}월 ${Number(d)}일`) : data.date;
  return (
    <View style={{ width, paddingTop: compact ? 17 : 37, paddingBottom: compact ? 15 : 38, alignItems: 'center' }}>
      {/* In the list, cream tapers behind the front sheet on the left; colour
          projects at the upper right and lower left, as in the reference. */}
      <View style={[st.sheet, { width: cardW - (compact ? 14 : 36), borderRadius: compact ? 5 : 8, transform: [{ translateX: compact ? -8 : 6 }, { rotate: compact ? '-5.2deg' : '-10deg' }], top: compact ? 20 : 15, bottom: compact ? 19 : 28, backgroundColor: BACK_PAPER }]}>
        <BookmarkPaper color={BACK_PAPER} colored radius={compact ? 5 : 8} seed={`${seed}-back`} />
      </View>
      <View style={[st.sheet, { width: cardW - (compact ? -5 : 17), transform: [{ translateX: compact ? -1 : 0 }, { rotate: compact ? '3.6deg' : '7deg' }], top: compact ? 20 : 30, bottom: compact ? 11.5 : 34, backgroundColor: tone.paper }]}>
        <BookmarkPaper color={tone.paper} colored radius={8} seed={`${seed}-color`} />
      </View>
      <View style={[st.card, compact && st.compactShadow, { width: cardW, borderRadius: compact ? 12 : 9, transform: [{ translateX: compact ? 0 : 8 }, { rotate: compact ? '-0.7deg' : '-1deg' }] }]}>
        <BookmarkPaper color={CARD_PAPER} radius={compact ? 12 : 9} seed={`${seed}-front`} />
        <Pressable disabled={!onOpen} onPress={onOpen} accessible={!!onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? `${data.text || "사진 갈피"}, ${data.title}` : undefined} style={({ pressed }) => ({ paddingHorizontal: compact ? 30 : 33, paddingTop: compact ? 20 : 36, paddingBottom: compact ? 12 : 34, opacity: pressed ? press.opacity : 1 })}>
        {photo ? null : <View pointerEvents="none" style={[st.tape, { right: compact ? 20 : 16, top: compact ? -16 : -13 }]}>
          <BookmarkTape color={tone.tape} seed={`${seed}-tape`} width={compact ? 39 : 44} height={compact ? 43 : 45} paperEdge={compact ? 16 : 13} />
        </View>}
        <View style={[st.pageRow, compact && { minHeight: 24 }, photo && { justifyContent: 'space-between', marginRight: -3 }]}>
          <View style={st.pageLeft}><View style={[st.bar, { backgroundColor: tone.ink, height: compact ? 19 : 27 }]} /><Text style={[st.pageTop, photo && { fontSize: compact ? 15 : 17, color: '#8F8880' }]}>{photo ? '사진 갈피' : data.page ? `p. ${data.page}` : '남긴 문장'}</Text></View>
          {photo && data.page ? <Text style={st.pageTop}>{data.page}쪽</Text> : null}
        </View>
        {photo ? (
          <View style={{ marginTop: compact ? 12 : 26 }}>
            <PhotoPlate uri={data.photoUri!} ratio={data.photoRatio} width={cardW - (compact ? 60 : 66) + 3} seed={seed} compact={compact} onReady={onPhotoReady} />
            {data.text ? <WordWrap text={data.text} style={[st.photoText, compact && { fontSize: 14, lineHeight: 22 }]} maxLines={compact ? 2 : undefined} /> : null}
          </View>
        ) : (
        <View style={{ marginTop: compact ? 16 : 33 }}>
          <WordWrap text={data.text} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} maxLines={compact ? 4 : undefined} />
        </View>)}
        <View style={[st.rule, { marginTop: compact ? 15 : 30, marginBottom: compact ? 10 : 17 }]} />
        <View style={[st.srcRow, { gap: compact ? 13 : 16 }]}>
          {data.book ? <BookVisual book={data.book} width={coverW} rasterize={rasterizeBook} onReady={onCoverReady} /> : <RealCover uri={data.coverUri} title={data.title} color={data.color} width={coverW} />}
          <View style={{ flex: 1, gap: compact ? 3 : 8, marginTop: compact ? 0 : -4, paddingRight: compact && onToggleSaved ? 32 : 0 }}>
            {photo ? <>
              <Text style={[st.srcTitle, { fontSize: compact ? 16 : 22, lineHeight: compact ? 24 : 32 }]} numberOfLines={compact ? 2 : undefined}>{data.title}</Text>
              <Text style={st.meta}>{[data.author, date].filter(Boolean).join('  ·  ')}</Text>
            </> : <>
            <Text style={[st.srcTitle, { fontSize: compact ? 14.5 : 15.5 }]} numberOfLines={compact ? 2 : undefined}>{data.title}{data.author ? ` · ${data.author}` : ''}</Text>
            {!compact && data.page ? <Text style={st.meta}>p. {data.page}</Text> : null}
            <Text style={st.meta}>{date}</Text></>}
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
  sheet: { position: 'absolute', borderRadius: 8, borderTopWidth: 0.7, borderLeftWidth: 0.5, borderBottomWidth: 0.6, borderColor: 'rgba(255,255,255,0.65)', borderBottomColor: 'rgba(108,83,74,0.18)', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(86,68,60,0.13)' }, { offsetX: 1, offsetY: 7, blurRadius: 15, color: 'rgba(108,83,74,0.15)' }] },
  // A narrow contact shadow holds the sheets together; the soft lower shadow
  // describes their lift from the page without darkening the illuminated top.
  card: { backgroundColor: CARD_PAPER, borderWidth: 0.7, borderTopWidth: 1, borderColor: '#FFFFFF', borderBottomColor: colors.line, borderRadius: 10, boxShadow: [{ offsetX: 0, offsetY: 1.2, blurRadius: 2.2, color: 'rgba(86,68,60,0.15)' }, { offsetX: 1.5, offsetY: 11, blurRadius: 25, color: 'rgba(108,83,74,0.24)' }, { offsetX: 0, offsetY: 18, blurRadius: 36, color: 'rgba(108,83,74,0.07)' }] },
  compactShadow: { boxShadow: [{ offsetX: 0, offsetY: 1.2, blurRadius: 2.2, color: 'rgba(86,68,60,0.14)' }, { offsetX: 1, offsetY: 7, blurRadius: 16, color: 'rgba(108,83,74,0.17)' }] },
  save: { position: 'absolute', bottom: 14, right: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tape: { position: 'absolute', transform: [{ rotate: '0.7deg' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28, marginLeft: -9 },
  pageLeft: { flexDirection: 'row', alignItems: 'center', gap: 17 },
  photoText: { fontFamily: fonts.reading, fontSize: 16, lineHeight: 27, color: '#34302C', marginTop: 14, includeFontPadding: false },
  bar: { width: 3, borderRadius: 1.5 },
  pageTop: { fontFamily: fonts.reading, fontSize: 14, lineHeight: 22, color: '#9D958E', includeFontPadding: false },
  quote: { fontFamily: fonts.reading, color: '#292725', letterSpacing: -0.45, includeFontPadding: false },
  rule: { height: 0.65, backgroundColor: '#D8D0C6' },
  srcRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -3 },
  srcTitle: { fontFamily: fonts.reading, color: '#34302C', lineHeight: 24, includeFontPadding: false, letterSpacing: -0.2 },
  meta: { fontFamily: fonts.reading, fontSize: 13, lineHeight: 20, color: '#A09891', includeFontPadding: false },
  memo: { fontFamily: fonts.reading, fontSize: 16, lineHeight: 28, color: '#38332D', includeFontPadding: false },
});
