// 갈피 색 고르기(2026-11-05 사용자 '갈피 색 수정 기능'): 책마다 하나. 책장 갈피 탭·갈피 카드 뒤 종이·테이프가 함께 바뀐다.
// 자동 = 표지에서 뽑은 색(domain/color). 표지 색 몇 개와 기본 색 중에서 고를 수 있고, 자동으로 되돌릴 수 있다.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isNeutralColor, paperColors, RIBBON_PALETTE, tabColors } from '@/domain/color';
import { coverAtSize } from '@/domain/cover-url';
import { memoShelfBook } from '@/domain/library';
import { coverSwatches } from '@/domain/rebinding';
import { coverPalette } from '@/services/cover-palette';
import { libraryStore, useLibrary } from '@/store/library-store';
import { Check } from '@/ui/icons';
import { FilterGroup, FilterOption, Sheet } from '@/ui/kit';
import { colors, press, space, type } from '@/ui/theme';

const SWATCH = 42;

export function RibbonColorSheet({ bookId, visible, onClose }: { bookId: string; visible: boolean; onClose: () => void }) {
  const { lib } = useLibrary();
  const b = lib.books[bookId];
  const e = b && lib.editions[b.editionId];
  const coverUri = e?.coverUri;
  const [fromCover, setFromCover] = useState<string[]>([]);
  useEffect(() => {
    if (!visible || !coverUri) return;
    let live = true;
    void coverPalette(coverAtSize(coverUri, 'M'), 6).then((p) => {
      if (live) setFromCover(coverSwatches(p).filter((c) => !isNeutralColor(c)));
    });
    return () => {
      live = false;
    };
  }, [visible, coverUri]);
  if (!b) return null;
  const pick = (ribbonColor: string | undefined) => libraryStore.updateBook(bookId, { ribbonColor });
  const shown = memoShelfBook(lib, bookId)?.art.ribbon;
  const { paper, tape } = paperColors(shown, bookId);
  const [tab1, tab2] = tabColors(shown, bookId);
  const swatches = (list: string[]) => (
    <View style={st.grid}>
      {list.map((c) => {
        const on = b.ribbonColor?.toLowerCase() === c.toLowerCase();
        return (
          <Pressable key={c} onPress={() => pick(c)} accessibilityRole="button" accessibilityLabel={`갈피 색 ${c}`} accessibilityState={{ selected: on }} style={({ pressed }) => [st.swatch, { backgroundColor: paperColors(c, bookId).tape }, on && st.swatchOn, pressed && press]}>
            {on ? <Check size={20} color={colors.ink} strokeWidth={2.4} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="갈피 색" description="책장 갈피와 갈피 카드 색이 함께 바뀌어요" scroll maxHeight="85%">
      <View style={st.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={st.tabs}>
          <View style={[st.tab, { backgroundColor: tab2, height: 22 }]} />
          <View style={[st.tab, { backgroundColor: tab1, height: 30 }]} />
        </View>
        <View style={st.cardWrap}>
          <View style={[st.back, { backgroundColor: paper }]} />
          <View style={st.front}><Text style={st.sample} numberOfLines={1}>마음에 남은 문장</Text></View>
          <View style={[st.tape, { backgroundColor: tape }]} />
        </View>
      </View>
      <FilterGroup title="자동" first>
        <FilterOption label="표지에서 고른 색" selected={!b.ribbonColor} onPress={() => pick(undefined)} />
      </FilterGroup>
      {fromCover.length ? <FilterGroup title="표지 색">{swatches(fromCover)}</FilterGroup> : null}
      <FilterGroup title="다른 색">{swatches(RIBBON_PALETTE)}</FilterGroup>
    </Sheet>
  );
}

const st = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xl, paddingTop: space.s, paddingBottom: space.l },
  tabs: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, borderBottomWidth: 3, borderBottomColor: colors.line, paddingHorizontal: space.s },
  tab: { width: 12, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  cardWrap: { width: 150, height: 72 },
  back: { position: 'absolute', left: 3, right: -3, top: 4, bottom: -4, borderRadius: 3, transform: [{ rotate: '1deg' }] },
  front: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: colors.white, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.line, justifyContent: 'center', paddingHorizontal: space.m },
  sample: { ...type.caption, color: colors.ink },
  tape: { position: 'absolute', top: -7, right: 12, width: 28, height: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, paddingVertical: space.s },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.line },
  swatchOn: { borderWidth: 2, borderColor: colors.ink },
});
