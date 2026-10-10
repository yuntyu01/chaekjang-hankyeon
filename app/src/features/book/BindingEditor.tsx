// 재장정 미리보기·편집(책 추가 확인 화면과 책 상세가 함께 쓴다).
// 책장과 같은 3D 책 렌더러로 책등·정면을 그린다(실제 도서 표지 사진은 쓰지 않는다).
// 색 5개 추천 중 선택 + 재질(무광 종이·천·코팅지) + 표지 그림(기본 정면 장정 6종, 없으면 단색) + 모티프 바꾸기 + 책등 조판 변형.
// 저장하면 사용자 오버라이드(source 'custom')가 된다.
// "실물 표지로 보기"는 이번 범위 밖이라 자리만 둔다(비활성).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { artworkCover, COVER_ARTWORKS } from '@/domain/cover-artworks';
import { ESTIMATED_PAGES, ESTIMATED_SIZE, type Binding, type SizeMm } from '@/domain/library';
import { MOTIF_SLOTS } from '@/domain/motif-slots';
import { BOOK_COLORS, LAYOUT_VARIANTS, layoutArt, suggestColors, tonesFor, type LayoutVariant } from '@/domain/rebinding';
import { BINDING_MATERIALS, type BindingMaterial, type Book } from '@/domain/types';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { Btn, Muted, Row } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

export type BindingDraft = Pick<Binding, 'spineColor' | 'motif' | 'seed' | 'source' | 'inkColor' | 'accentColor' | 'layout' | 'material' | 'coverArtId'>;

const LAYOUT_NAMES: Record<LayoutVariant, string> = { spine_a: '가', spine_b: '나', spine_c: '다' };
const MATERIAL_NAMES: Record<BindingMaterial, string> = { paper: '무광 종이', cloth: '천', coated: '코팅지' };

export function previewBook(p: { title: string; author?: string; size?: SizeMm; pages?: number; binding: BindingDraft }): Book {
  const size = p.size ?? ESTIMATED_SIZE;
  const cover = artworkCover(p.binding.coverArtId, p.binding.spineColor);
  return {
    id: 'preview',
    title: p.title || '제목',
    author: p.author || undefined,
    themeColor: p.binding.spineColor,
    heightClass: 'medium',
    thicknessClass: 'medium',
    coverAspectRatio: size.widthMm / size.heightMm,
    physical: { ...size, pages: p.pages ?? ESTIMATED_PAGES },
    art: { motif: p.binding.motif, inkColor: p.binding.inkColor, accentColor: p.binding.accentColor, material: p.binding.material, vectorCover: !cover, ...layoutArt(p.binding.layout ?? 'spine_a') },
    cover,
  };
}

// 장정 디자인 후보: 없음 + 모티프 슬롯 30개. 맨 아래 목록을 옆으로 드래그해 고르면 위 미리보기에 바로 반영된다.
const MOTIF_PAGES: { id: string; name: string }[] = [{ id: 'none', name: '없음' }, ...MOTIF_SLOTS.map((m) => ({ id: m.id, name: m.name }))];
const GAP = 10;

export function BindingEditor({ title, author, size, pages, value, recommended, onChange }: { title: string; author?: string; size?: SizeMm; pages?: number; value: BindingDraft; recommended: BindingDraft; onChange: (v: BindingDraft) => void }) {
  // 추천 5가지(이 책 색 기준)가 맨 앞, 그 뒤로 어울리는 색 목록(중복 제외)
  const swatches = useMemo(() => {
    const rec = suggestColors(recommended.spineColor).map((hex, i) => ({ hex, name: i === 0 ? '추천' : `추천 ${i + 1}` }));
    const have = new Set(rec.map((c) => c.hex));
    return [...rec, ...BOOK_COLORS.filter((c) => !have.has(c.hex))];
  }, [recommended.spineColor]);
  const custom = (patch: Partial<BindingDraft>): BindingDraft => ({ ...value, ...patch, source: 'custom' });
  const material = value.material ?? 'paper';
  const same = value.spineColor === recommended.spineColor && value.motif === recommended.motif && value.layout === recommended.layout && material === (recommended.material ?? 'paper') && !value.coverArtId;
  const book = useMemo(() => previewBook({ title, author, size, pages, binding: value }), [title, author, size, pages, value]);
  const [w, setW] = useState(0);
  const list = useRef<FlatList>(null);
  const index = Math.max(0, MOTIF_PAGES.findIndex((m) => m.id === value.motif));
  const itemW = w > 0 ? (w - GAP * 2) / 3.15 : 0; // 한 화면에 3개 + 다음 것이 살짝 보이게
  const step = itemW + GAP;
  // 바깥에서 값이 바뀌면(추천으로 되돌리기) 그 디자인이 보이는 곳으로 이동
  const lastIndex = useRef(index);
  useEffect(() => {
    if (step > 0 && lastIndex.current !== index) {
      lastIndex.current = index;
      list.current?.scrollToOffset({ offset: Math.max(0, index * step - step), animated: true });
    }
  }, [index, step]);
  return (
    <View>
      <View style={st.stage} accessibilityLabel="장정 미리보기: 책등과 정면">
        <View style={st.col}>
          <StandaloneBook book={book} pose="spine" scale={1.25} />
          <Text style={st.cap}>책등</Text>
        </View>
        <View style={st.col}>
          <StandaloneBook book={book} pose="front" scale={1.25} />
          <Text style={st.cap}>정면</Text>
        </View>
      </View>
      {!size || !pages ? (
        <Muted style={{ marginTop: 8 }}>
          {`${!pages && !size ? '쪽수·판형' : !pages ? '쪽수' : '판형'}을 몰라 흔한 크기(${ESTIMATED_SIZE.widthMm}×${ESTIMATED_SIZE.heightMm}mm · ${ESTIMATED_PAGES}쪽)로 만든 모양이에요. 도서 정보에는 ‘확인 전’으로 남아요.`}
        </Muted>
      ) : null}
      <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={st.real}>
        <Text style={st.realText}>실물 표지로 보기 · 준비 중</Text>
      </Pressable>

      <Text style={st.h}>책 색 <Text style={st.hint}>옆으로 넘겨 골라요 · {swatches.length}색</Text></Text>
      <FlatList
        data={swatches}
        extraData={value.spineColor}
        keyExtractor={(c) => c.hex}
        horizontal
        removeClippedSubviews={false}
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -2 }}
        contentContainerStyle={{ paddingHorizontal: 2, paddingVertical: 4 }}
        renderItem={({ item: c }) => (
          <Pressable onPress={() => onChange(custom({ spineColor: c.hex, ...tonesFor(c.hex) }))} accessibilityRole="button" accessibilityLabel={`책 색 ${c.name}`} accessibilityState={{ selected: value.spineColor === c.hex }} style={st.swatchCell}>
            <View style={[st.swatch, { backgroundColor: c.hex }, value.spineColor === c.hex && st.swatchOn]} />
            <Text style={[st.swatchName, value.spineColor === c.hex && { color: colors.ink }]}>{c.name}</Text>
          </Pressable>
        )}
      />

      <Text style={st.h}>재질</Text>
      <Row gap={10}>
        {BINDING_MATERIALS.map((m) => (
          <Pressable key={m} onPress={() => onChange(custom({ material: m }))} accessibilityRole="button" accessibilityLabel={`재질 ${MATERIAL_NAMES[m]}`} accessibilityState={{ selected: material === m }} style={[st.chip, material === m && st.chipOn, { minWidth: 56 }]}>
            <Text style={[st.chipText, material === m && st.chipTextOn]}>{MATERIAL_NAMES[m]}</Text>
          </Pressable>
        ))}
      </Row>

      <Text style={st.h}>표지 그림 <Text style={st.hint}>정면에 입혀요 · 책등은 책 색 그대로</Text></Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ paddingHorizontal: 2, paddingVertical: 4, gap: 10 }}>
        <Pressable onPress={() => onChange(custom({ coverArtId: undefined }))} accessibilityRole="button" accessibilityLabel="표지 그림 없음(단색 정면)" accessibilityState={{ selected: !value.coverArtId }} style={st.artCell}>
          <View style={[st.artThumb, { backgroundColor: value.spineColor }, !value.coverArtId && st.artOn]} />
          <Text style={[st.swatchName, !value.coverArtId && { color: colors.ink }]}>단색</Text>
        </Pressable>
        {COVER_ARTWORKS.map((a) => {
          const on = value.coverArtId === a.id;
          return (
            <Pressable key={a.id} onPress={() => onChange(custom({ coverArtId: a.id }))} accessibilityRole="button" accessibilityLabel={`표지 그림 ${a.name}`} accessibilityState={{ selected: on }} style={st.artCell}>
              <Image source={a.thumb} style={[st.artThumb, on && st.artOn]} resizeMode="cover" />
              <Text style={[st.swatchName, on && { color: colors.ink }]}>{a.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={st.h}>책등 조판</Text>
      <Row gap={10}>
        {LAYOUT_VARIANTS.map((v) => (
          <Pressable key={v} onPress={() => onChange(custom({ layout: v }))} accessibilityRole="button" accessibilityLabel={`책등 조판 ${LAYOUT_NAMES[v]}`} accessibilityState={{ selected: (value.layout ?? 'spine_a') === v }} style={[st.chip, (value.layout ?? 'spine_a') === v && st.chipOn, { minWidth: 56 }]}>
            <Text style={[st.chipText, (value.layout ?? 'spine_a') === v && st.chipTextOn]}>{LAYOUT_NAMES[v]}</Text>
          </Pressable>
        ))}
      </Row>

      <Text style={st.h}>장정 디자인 <Text style={st.hint}>옆으로 넘겨 골라요 · {MOTIF_PAGES[index].name} {index + 1}/{MOTIF_PAGES.length}</Text></Text>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ marginHorizontal: -2 }}>
        {w > 0 ? (
          <FlatList
            ref={list}
            data={MOTIF_PAGES}
            extraData={value}
            keyExtractor={(m) => m.id}
            horizontal
            removeClippedSubviews={false}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.max(0, index - 1)}
            getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
            initialNumToRender={4}
            windowSize={5}
            maxToRenderPerBatch={3}
            snapToInterval={step}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 2 }}
            renderItem={({ item }) => {
              const on = item.id === value.motif;
              return (
                <Pressable
                  onPress={() => onChange(custom({ motif: item.id }))}
                  accessibilityRole="button"
                  accessibilityLabel={`장정 디자인 ${item.name}`}
                  accessibilityState={{ selected: on }}
                  style={[st.design, { width: itemW, marginRight: GAP }, on && st.designOn]}>
                  <View pointerEvents="none" style={{ height: itemW * 1.3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <StandaloneBook book={previewBook({ title, author, size, pages, binding: { ...value, motif: item.id } })} pose="front" scale={itemW / 125} />
                  </View>
                  <Text style={[st.designName, on && { color: colors.ink, fontFamily: fonts.serifMedium }]}>{item.name}</Text>
                </Pressable>
              );
            }}
          />
        ) : null}
      </View>

      <Btn label="추천 장정으로 되돌리기" kind="secondary" disabled={same && value.source !== 'custom'} style={{ marginTop: 22 }} onPress={() => onChange({ ...recommended, seed: value.seed, source: 'default' })} />
    </View>
  );
}

const st = StyleSheet.create({
  stage: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 28, paddingVertical: 18, borderRadius: 14, backgroundColor: '#F4EDE2' },
  artCell: { alignItems: 'center', width: 62 },
  artThumb: { width: 54, height: 81, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  artOn: { borderColor: '#594541' },
  design: { borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: '#F4EDE2', paddingBottom: 8, alignItems: 'center' },
  designOn: { borderColor: '#594541', backgroundColor: '#F7F0E4' },
  designName: { fontFamily: fonts.serif, fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  col: { alignItems: 'center', gap: 6 },
  cap: { fontSize: 12, color: colors.inkSoft },
  real: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: '#DDD4C6', opacity: 0.55 },
  realText: { fontSize: 12.5, color: colors.inkSoft },
  h: { fontFamily: fonts.serifMedium, fontSize: 16, color: colors.ink, marginTop: 22, marginBottom: 10 },
  hint: { fontFamily: fonts.serif, fontSize: 12, color: colors.inkSoft },
  swatchCell: { alignItems: 'center', marginRight: 12, width: 52 },
  swatchName: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.inkSoft, marginTop: 5 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#DDD4C6', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF6EE' },
  chipOn: { backgroundColor: '#594541', borderColor: '#594541' },
  chipText: { fontSize: 14, color: colors.ink },
  chipTextOn: { color: '#FBF6EE' },
});
