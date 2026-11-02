// 갈피 보드의 카드 한 장(2026-11-02 사용자 시안): 글은 종이 + 테이프 + 쪽수 + 명조 문장, 사진은 인화지 + 테이프 + 쪽수. 눌러서 크게 읽는 건 보드가 맡는다(여기서는 터치를 받지 않는다).
import { Image, StyleSheet, Text, View } from 'react-native';

import { BOARD_CARD_W, BOARD_MAX_LINES } from '@/domain/bookmark-board';
import type { Bookmark } from '@/domain/library';
import { colors, fonts } from '@/ui/screenTheme';
import { CARD_PAPER, paperTone } from './BookmarkCard';
import { BookmarkPaper } from './BookmarkPaper';
import { BookmarkTape } from './BookmarkTape';

export function BoardCard({ mark, color, minHeight }: { mark: Bookmark; color: string; minHeight: number }) {
  const tone = paperTone(color);
  const page = mark.page ? `p. ${mark.page}` : null;
  if (mark.photoUri) {
    const r = Math.max(0.9, Math.min(1.5, mark.photoRatio && mark.photoRatio > 0 ? mark.photoRatio : 1.3));
    const inner = BOARD_CARD_W - 20;
    return (
      <View style={[st.print, { minHeight }]} pointerEvents="none">
        <View style={{ width: inner, height: inner / r, backgroundColor: '#ECE9E4' }}>
          <Image source={{ uri: mark.photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="갈피 사진" />
        </View>
        <Text style={st.caption} numberOfLines={1}>{page ?? mark.text.trim() ?? ''}</Text>
        <View style={st.printTape}>
          <BookmarkTape color={tone.tape} seed={`${mark.id}-tape`} width={40} height={30} paperEdge={10} />
        </View>
      </View>
    );
  }
  return (
    <View style={[st.note, { minHeight }]} pointerEvents="none">
      <BookmarkPaper color={CARD_PAPER} radius={3} seed={`${mark.id}-front`} />
      <View style={st.pageRow}>
        <View style={[st.bar, { backgroundColor: tone.ink }]} />
        <Text style={st.page}>{page ?? '남긴 문장'}</Text>
      </View>
      <Text style={st.quote} numberOfLines={BOARD_MAX_LINES}>{mark.text}</Text>
      <View style={st.noteTape}>
        <BookmarkTape color={tone.tape} seed={`${mark.id}-tape`} width={40} height={32} paperEdge={11} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  note: { width: BOARD_CARD_W, backgroundColor: CARD_PAPER, borderRadius: 3, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(60,50,45,0.10)' }, { offsetX: 0, offsetY: 4, blurRadius: 10, color: 'rgba(60,50,45,0.07)' }] },
  print: { width: BOARD_CARD_W, backgroundColor: '#FFFFFF', padding: 10, paddingBottom: 8, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(60,50,45,0.12)' }, { offsetX: 0, offsetY: 5, blurRadius: 12, color: 'rgba(60,50,45,0.09)' }] },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  bar: { width: 3, height: 15, borderRadius: 1.5 },
  page: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, includeFontPadding: false },
  caption: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, marginTop: 8, includeFontPadding: false },
  quote: { fontFamily: fonts.reading, fontSize: 18, lineHeight: 29, color: colors.ink, letterSpacing: -0.3, marginTop: 10, includeFontPadding: false },
  noteTape: { position: 'absolute', right: 16, top: -11, transform: [{ rotate: '6deg' }] },
  printTape: { position: 'absolute', left: -4, top: -12, transform: [{ rotate: '-28deg' }] },
});
