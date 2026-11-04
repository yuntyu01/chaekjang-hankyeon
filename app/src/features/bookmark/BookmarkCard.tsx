import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import type { Book } from '@/domain/types';
import { BookVisual } from '@/ui/BookVisual';
import { RealCover } from '@/ui/kit';
import { colors, fonts, press } from '@/ui/screenTheme';
import { Bookmark } from '@/ui/icons';
import { BookmarkPaper } from './BookmarkPaper';
import { BookmarkTape } from './BookmarkTape';
import { PhotoPlate } from './PhotoPlate';

// 갈피 종이: 화면 바탕(흰색)과 같은 계열. 앞 종이는 흰색(옅은 선·그림자로 구분),
// 책 색에 따른 색 종이·테이프는 원래 색을 흰 바탕 쪽으로 섞어 연하게(종이 45%, 테이프 35%).
export const CARD_PAPER = '#FFFFFF';
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

export function paperTone(color: string) {
  const c = /^#([\da-f]{6})$/i.exec(color)?.[1];
  if (!c) return { paper: '#D0DEE8', tape: '#BCCFDF' };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (g > r && g > b) return { paper: '#D9DFD0', tape: '#C4CCB9' };
  if (b > r || b > g) return { paper: '#D0DEE8', tape: '#BCCFDF' };
  return { paper: '#F5DCCF', tape: '#F2D6C7' };
}

export function BookmarkCard({ data, showMemo, width, seed, compact = false, rasterizeBook = false, onCoverReady, onPhotoReady, onOpen, saved = false, onToggleSaved }: { data: BookmarkCardData; showMemo: boolean; width: number; seed: string; compact?: boolean; rasterizeBook?: boolean; onCoverReady?: () => void; onPhotoReady?: () => void; onOpen?: () => void; saved?: boolean; onToggleSaved?: () => void }) {
  const qt = compact ? { size: 25, lh: 38 } : quoteType(data.text);
  const cardW = compact ? width - 4 : width * 0.857;
  const coverW = compact ? 40 : 56; // 표지는 하단의 작은 출처처럼(목록 40×56dp, 2026-11-01)
  const tone = paperTone(data.color);
  const photo = !!data.photoUri;
  const date = compact ? data.date.replace(/^\d{4}[.\-/](\d{1,2})[.\-/](\d{1,2}).*$/, (_, m, d) => `${Number(m)}월 ${Number(d)}일`) : data.date;
  const padBottom = compact ? 20 : 34;
  return (
    // 얇은 종이에 문장을 붙여 둔 느낌(2026-11-01): 뒷종이 한 장은 앞 종이와 중심을 맞춰 살짝 돌려 네 모서리가 모두 조금씩 보이게(2026-11-01 사용자 '왜 두 모서리만 보이지'), 그림자는 바닥에 닿을 만큼만. 카드와 카드 사이는 넓게(아래 36)
    <View style={{ width, paddingTop: compact ? 20 : 37, paddingBottom: compact ? 36 : 38, alignItems: 'center' }}>
      <View style={[st.sheet, { width: cardW + 4, borderRadius: 7, transform: [{ rotate: compact ? '1.6deg' : '2deg' }], top: compact ? 18 : 35, bottom: compact ? 34 : 36, backgroundColor: tone.paper }]}>
        <BookmarkPaper color={tone.paper} colored radius={7} seed={`${seed}-color`} />
      </View>
      <View style={[st.card, { width: cardW, borderRadius: 8 }]}>
        <BookmarkPaper color={CARD_PAPER} radius={8} seed={`${seed}-front`} />
        <Pressable disabled={!onOpen} onPress={onOpen} accessible={!!onOpen} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={onOpen ? `${data.text || "사진 갈피"}, ${data.title}` : undefined} style={({ pressed }) => ({ paddingHorizontal: compact ? 24 : 33, paddingTop: compact ? 22 : 36, paddingBottom: padBottom, opacity: pressed ? press.opacity : 1 })}>
        {photo ? null : <View pointerEvents="none" style={[st.tape, { right: compact ? 20 : 16, top: compact ? -16 : -13 }]}>
          <BookmarkTape color={tone.tape} seed={`${seed}-tape`} width={compact ? 39 : 44} height={compact ? 43 : 45} paperEdge={compact ? 16 : 13} />
        </View>}
        <View style={[st.pageRow, compact && { minHeight: 24 }, photo && { justifyContent: 'space-between', marginRight: -3 }]}>
          <View style={st.pageLeft}><Text style={st.pageTop}>{photo ? '사진 갈피' : data.page ? `p. ${data.page}` : '남긴 문장'}</Text></View>
          {photo && data.page ? <Text style={st.pageTop}>{data.page}쪽</Text> : null}
        </View>
        {photo ? (
          <View style={{ marginTop: compact ? 14 : 26 }}>
            <PhotoPlate uri={data.photoUri!} ratio={data.photoRatio} width={cardW - (compact ? 48 : 66) + 3} seed={seed} compact={compact} onReady={onPhotoReady} />
            {data.text ? <WordWrap text={data.text} style={[st.photoText, compact && { fontSize: 15, lineHeight: 23 }]} maxLines={compact ? 2 : undefined} /> : null}
          </View>
        ) : (
        <View style={{ marginTop: compact ? 14 : 33 }}>
          <WordWrap text={data.text} style={[st.quote, { fontSize: qt.size, lineHeight: qt.lh }]} maxLines={compact ? 4 : undefined} />
        </View>)}
        <View style={[st.rule, { marginTop: compact ? 20 : 30, marginBottom: compact ? 16 : 20 }]} />
        {/* 표지·제목·저자는 가깝게 한 묶음. 인용문만 명조이고 책 정보는 화면 위쪽과 같은 고딕, 책 이름만 조금 진하게 */}
        <View style={st.srcRow}>
          {/* 연결된 책은 실물 표지(도서 이미지·내가 찍은 사진, 2026-11-01 사용자 '연결된 거 전부 실물로'). 사진이 없는 책만 책장과 같은 장정 그림 */}
          <View style={st.cover}>{data.coverUri || !data.book ? <RealCover uri={data.coverUri} title={data.title} color={data.color} width={coverW} ratio={COVER_RATIO} onReady={onCoverReady} /> : <BookVisual book={data.book} width={coverW} rasterize={rasterizeBook} onReady={onCoverReady} />}</View>
          <View style={{ flex: 1, minWidth: 0, gap: 2, paddingRight: compact && onToggleSaved ? 40 : 0 }}>
            <Text style={st.srcTitle} numberOfLines={compact ? 1 : 2}>{data.title}</Text>
            <Text style={st.meta} numberOfLines={1}>{[data.author, date].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
        {showMemo && data.memo ? <><View style={[st.rule, { marginTop: 18, marginBottom: 20 }]} /><WordWrap text={data.memo} style={st.memo} /></> : null}
        </Pressable>
        {/* 북마크는 출처 줄의 오른쪽 끝(표지 56 높이 가운데) */}
        {compact && onToggleSaved ? <Pressable onPress={onToggleSaved} accessibilityRole="button" accessibilityLabel={saved ? '아껴둔 갈피에서 빼기' : '갈피 아껴두기'} accessibilityState={{ selected: saved }} style={[st.save, { bottom: padBottom + (coverW / COVER_RATIO - 44) / 2 }]}><Bookmark size={22} strokeWidth={1.6} color={colors.inkSoft} fill={saved ? colors.inkSoft : 'none'} /></Pressable> : null}
      </View>
    </View>
  );
}

const COVER_RATIO = 40 / 56;
const st = StyleSheet.create({
  // 뒷종이: 그림자 없이 가장자리 선만(색은 책 색 계열 그대로 또렷하게)
  sheet: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(108,83,74,0.16)' },
  // 앞 종이: 닿는 그림자와 아주 옅은 번짐만(상단의 납작한 화면과 어울리게)
  card: { backgroundColor: CARD_PAPER, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(60,50,45,0.06)' }, { offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(60,50,45,0.05)' }] },
  save: { position: 'absolute', right: 14, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tape: { position: 'absolute', transform: [{ rotate: '0.7deg' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  pageLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoText: { fontFamily: fonts.reading, fontSize: 16, lineHeight: 27, color: '#34302C', marginTop: 14, includeFontPadding: false },
  pageTop: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.inkSoft, includeFontPadding: false },
  quote: { fontFamily: fonts.reading, color: '#292725', letterSpacing: -0.45, includeFontPadding: false },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cover: { borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  srcTitle: { fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21, color: colors.ink, includeFontPadding: false },
  meta: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.inkSoft, includeFontPadding: false },
  memo: { fontFamily: fonts.reading, fontSize: 16, lineHeight: 28, color: '#38332D', includeFontPadding: false },
});
