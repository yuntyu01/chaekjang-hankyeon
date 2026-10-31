// 재장정 미리보기·편집(책 추가 확인 화면과 책 상세가 함께 쓴다). 2026-10-10 시안: 책 미리보기 → 그림·색상·재질 탭 → 그 탭의 옵션.
// 책장과 같은 3D 책 렌더러로 같은 책의 책등·정면을 함께 그리고 고른 장정이 바로 반영된다(실제 도서 표지 사진은 쓰지 않는다).
// - 그림: 기본 정면 장정 6종(3열) + '그림 없음'(단색 정면, 그때만 정면 무늬를 고른다). 그림을 골라도 책 색은 그대로
// - 색상: 이 책 추천 색 + 모든 색. 고른 색에 테두리와 체크
// - 재질: 무광 종이·천·코팅지 + 책등 글자 배치
// 탭을 바꿔도 고르던 값은 그대로다(값은 부모가 가진다). 저장하면 사용자 오버라이드(source 'custom')가 된다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { artworkCover, COVER_ARTWORKS } from '@/domain/cover-artworks';
import { ESTIMATED_PAGES, ESTIMATED_SIZE, type Binding, type SizeMm } from '@/domain/library';
import { MOTIF_SLOTS } from '@/domain/motif-slots';
import { BOOK_COLORS, LAYOUT_VARIANTS, layoutArt, suggestColors, tonesFor, type LayoutVariant } from '@/domain/rebinding';
import { BINDING_MATERIALS, type BindingMaterial, type Book } from '@/domain/types';
import { noRibbon, RotatableBook, StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { frameBBox, standaloneFrame } from '@/domain/shelf-scene';
import { frameCam } from '@/ui/book3d/StandaloneBook';
import { Check } from '@/ui/icons';
import { colors, fonts, shape, space, type } from '@/ui/screenTheme';
import { TextLink } from '@/ui/kit';

export type BindingDraft = Pick<Binding, 'spineColor' | 'motif' | 'seed' | 'source' | 'inkColor' | 'accentColor' | 'layout' | 'material' | 'coverArtId'>;

const LAYOUT_NAMES: Record<LayoutVariant, string> = { spine_a: '기본', spine_b: '제목 낮게', spine_c: '무늬 낮게' };
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

// 단색 정면 무늬 후보: 없음 + 모티프 슬롯 30개(그림 없음일 때만 정면에 그려진다)
const MOTIF_PAGES: { id: string; name: string }[] = [{ id: 'none', name: '없음' }, ...MOTIF_SLOTS.map((m) => ({ id: m.id, name: m.name }))];
const GAP = 10;
type Tab = 'art' | 'color' | 'material';
const TABS: { id: Tab; label: string }[] = [
  { id: 'art', label: '그림' },
  { id: 'color', label: '색상' },
  { id: 'material', label: '재질' },
];
const INK = colors.accent; // 고른 것 표시(공통 강조색)

// current: 아직 아무것도 고르지 않았을 때 보여 줄 지금 모습(책장에 놓인 그대로). 하나라도 고르면 고른 장정으로 바뀐다
export function BindingEditor({ title, author, size, pages, value, recommended, current, onChange }: { title: string; author?: string; size?: SizeMm; pages?: number; value: BindingDraft; recommended: BindingDraft; current?: Book; onChange: (v: BindingDraft) => void }) {
  const [tab, setTab] = useState<Tab>('art');
  const { width } = useWindowDimensions();
  const custom = (patch: Partial<BindingDraft>): BindingDraft => ({ ...value, ...patch, source: 'custom' });
  const book = useMemo(() => previewBook({ title, author, size, pages, binding: value }), [title, author, size, pages, value]);
  const shown = useMemo(() => (current ? noRibbon(current) : book), [current, book]);
  // 미리보기 크기: 정면 폭을 화면 폭에 맞춘다(책 치수·카메라는 그대로, 그리는 배율만)
  const frontWidth = Math.min(170, width * 0.39);
  return (
    <View>
      <View style={st.stage}>
        <RotatableBook book={shown} frontWidth={frontWidth} initialSpin={32} shadow />
        <Text style={st.cap}>드래그해서 돌려보세요</Text>
      </View>

      <View style={st.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} style={[st.tab, tab === t.id && st.tabOn]}>
            <Text style={[st.tabText, tab === t.id && st.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'art' ? <ArtPane showingCurrent={!!current} title={title} author={author} size={size} pages={pages} value={value} custom={custom} onChange={onChange} /> : null}
      {tab === 'color' ? <ColorPane value={value} recommended={recommended} custom={custom} onChange={onChange} /> : null}
      {tab === 'material' ? <MaterialPane title={title} author={author} size={size} pages={pages} value={value} custom={custom} onChange={onChange} /> : null}
    </View>
  );
}

type PaneProps = { value: BindingDraft; custom: (patch: Partial<BindingDraft>) => BindingDraft; onChange: (v: BindingDraft) => void };

// 그림: 6종 3열. 고른 그림만 얇은 테두리 + 작은 체크. 아래에 '그림 없음'(단색 정면)과 그때 쓰는 정면 무늬
function ArtPane({ title, author, size, pages, value, custom, onChange, showingCurrent }: PaneProps & { title: string; author?: string; size?: SizeMm; pages?: number; showingCurrent?: boolean }) {
  // 책장 모습 그대로 보여 주는 중이면(시안 예시 표지 등) 아무것도 고르지 않은 상태로 둔다
  const none = !value.coverArtId && !showingCurrent;
  return (
    <View>
      <View style={st.artGrid}>
        {COVER_ARTWORKS.map((a) => {
          const on = value.coverArtId === a.id;
          return (
            <Pressable key={a.id} onPress={() => onChange(custom({ coverArtId: a.id }))} accessibilityRole="button" accessibilityLabel={`표지 그림 ${a.name}`} accessibilityState={{ selected: on }} style={st.artCell}>
              <View style={[st.artFrame, on && st.artFrameOn]}>
                <Image source={a.thumb} style={st.artImage} resizeMode="cover" />
                {on ? (
                  <View style={st.check}>
                    <Check size={13} color={colors.onAccent} strokeWidth={2.4} />
                  </View>
                ) : null}
              </View>
              <Text style={[st.artName, on && st.nameOn]}>{a.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={() => onChange(custom({ coverArtId: undefined }))} accessibilityRole="button" accessibilityLabel="그림 없음, 단색 정면" accessibilityState={{ selected: none }} style={[st.noneRow, none && st.noneRowOn]}>
        <View style={[st.noneSwatch, { backgroundColor: value.spineColor }]} />
        <Text style={[st.noneText, none && st.nameOn]}>그림 없음 · 단색 정면</Text>
        {none ? <Check size={16} color={INK} strokeWidth={2.2} /> : null}
      </Pressable>
      {none ? <MotifPicker title={title} author={author} size={size} pages={pages} value={value} custom={custom} onChange={onChange} /> : null}
    </View>
  );
}

// 단색 정면 무늬(예전 '장정 디자인'): 옆으로 넘겨 고른다
function MotifPicker({ title, author, size, pages, value, custom, onChange }: PaneProps & { title: string; author?: string; size?: SizeMm; pages?: number }) {
  const [w, setW] = useState(0);
  const list = useRef<FlatList>(null);
  const index = Math.max(0, MOTIF_PAGES.findIndex((m) => m.id === value.motif));
  const itemW = w > 0 ? (w - GAP * 2) / 3.15 : 0; // 한 화면에 3개 + 다음 것이 살짝 보이게
  const step = itemW + GAP;
  const lastIndex = useRef(index);
  useEffect(() => {
    if (step > 0 && lastIndex.current !== index) {
      lastIndex.current = index;
      list.current?.scrollToOffset({ offset: Math.max(0, index * step - step), animated: true });
    }
  }, [index, step]);
  return (
    <View>
      <Text style={st.h}>정면 무늬 <Text style={st.hint}>{MOTIF_PAGES[index].name}</Text></Text>
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
                  accessibilityLabel={`정면 무늬 ${item.name}`}
                  accessibilityState={{ selected: on }}
                  style={[st.design, { width: itemW, marginRight: GAP }, on && st.designOn]}>
                  <View pointerEvents="none" style={{ height: itemW * 1.3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <StandaloneBook book={previewBook({ title, author, size, pages, binding: { ...value, motif: item.id } })} pose="front" scale={itemW / 125} />
                  </View>
                  <Text style={[st.designName, on && st.nameOn]}>{item.name}</Text>
                </Pressable>
              );
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

// 색상: 이 책 추천 색 + 모든 색(이름은 읽기용으로만). 고른 색에 테두리와 체크. 맨 아래 추천 장정으로 되돌리기
function ColorPane({ value, recommended, custom, onChange }: PaneProps & { recommended: BindingDraft }) {
  const rec = useMemo(() => suggestColors(recommended.spineColor), [recommended.spineColor]);
  const rest = useMemo(() => BOOK_COLORS.filter((c) => !rec.includes(c.hex)), [rec]);
  const material = value.material ?? 'paper';
  const same = value.spineColor === recommended.spineColor && value.motif === recommended.motif && value.layout === recommended.layout && material === (recommended.material ?? 'paper') && !value.coverArtId;
  const swatch = (hex: string, name: string) => {
    const on = value.spineColor === hex;
    return (
      <Pressable key={hex} onPress={() => onChange(custom({ spineColor: hex, ...tonesFor(hex) }))} accessibilityRole="button" accessibilityLabel={`책 색 ${name}`} accessibilityState={{ selected: on }} style={st.swatchCell}>
        <View style={[st.swatch, { backgroundColor: hex }, on && st.swatchOn]}>{on ? <Check size={16} color={tonesFor(hex).inkColor} strokeWidth={2.4} /> : null}</View>
      </Pressable>
    );
  };
  return (
    <View>
      <Text style={st.h}>이 책에 어울리는 색</Text>
      <View style={st.swatches}>{rec.map((hex, i) => swatch(hex, i === 0 ? '추천' : `추천 ${i + 1}`))}</View>
      <Text style={st.h}>모든 색</Text>
      <View style={st.swatches}>{rest.map((c) => swatch(c.hex, c.name))}</View>
      <TextLink label="추천 장정으로 되돌리기" tone="soft" disabled={same && value.source !== 'custom'} onPress={() => onChange({ ...recommended, seed: value.seed, source: 'default' })} style={st.reset} />
    </View>
  );
}

// 재질: 무광 종이·천·코팅지(이 책 색에 그 재질의 결을 크게 그린 견본) + 책등 글자 배치(이 책 책등)
function MaterialPane({ value, custom, onChange, title, author, size, pages }: PaneProps & { title: string; author?: string; size?: SizeMm; pages?: number }) {
  const { width } = useWindowDimensions();
  const tile = (width - 40 - 24) / 3;
  const material = value.material ?? 'paper';
  const layout = value.layout ?? 'spine_a';
  const base = useMemo(() => previewBook({ title, author, size, pages, binding: value }), [title, author, size, pages, value]);
  // 책등 배율: 칸 높이에 맞게
  const zoom = useMemo(() => {
    const sp = standaloneFrame(base, 'spine');
    return { spine: (tile * 0.8) / frameBBox(sp, frameCam(sp)).height };
  }, [base, tile]);
  return (
    <View>
      <Text style={st.h}>표면</Text>
      <View style={st.tiles}>
        {BINDING_MATERIALS.map((m) => {
          const on = material === m;
          return (
            <Pressable key={m} onPress={() => onChange(custom({ material: m }))} accessibilityRole="button" accessibilityLabel={`재질 ${MATERIAL_NAMES[m]}`} accessibilityState={{ selected: on }} style={{ width: tile, alignItems: 'center' }}>
              <View style={[st.tile, { width: tile, height: tile * 0.86 }, on && st.tileOn]}>
                <MaterialSwatch material={m} color={value.spineColor} w={tile - 4} h={tile * 0.86 - 4} />
                {on ? <View style={st.check}><Check size={15} color={colors.onAccent} strokeWidth={2.6} /></View> : null}
              </View>
              <Text style={[st.artName, on && st.nameOn]}>{MATERIAL_NAMES[m]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={st.h}>책등 글자</Text>
      <View style={st.tiles}>
        {LAYOUT_VARIANTS.map((v) => {
          const on = layout === v;
          return (
            <Pressable key={v} onPress={() => onChange(custom({ layout: v }))} accessibilityRole="button" accessibilityLabel={`책등 글자 ${LAYOUT_NAMES[v]}`} accessibilityState={{ selected: on }} style={{ width: tile, alignItems: 'center' }}>
              <View style={[st.tile, st.spineTile, { width: tile, height: tile * 0.86 }, on && st.tileOn]}>
                <View pointerEvents="none" style={st.tileInner}>
                  <StandaloneBook book={previewBook({ title, author, size, pages, binding: { ...value, layout: v } })} pose="spine" scale={zoom.spine} />
                </View>
                {on ? <View style={st.check}><Check size={15} color={colors.onAccent} strokeWidth={2.6} /></View> : null}
              </View>
              <Text style={[st.artName, on && st.nameOn]}>{LAYOUT_NAMES[v]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  stage: { alignItems: 'center', paddingTop: 4 },
  cap: { ...type.caption, marginTop: 2 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between' },
  tile: { borderRadius: shape.input, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  spineTile: { backgroundColor: colors.surface },
  tileInner: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tileOn: { borderColor: INK },
  tabs: { flexDirection: 'row', marginTop: 16, padding: 3, borderRadius: shape.input + 3, backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: 42, borderRadius: shape.input, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: INK },
  tabText: { ...type.row, fontSize: 15, color: colors.inkSoft },
  tabTextOn: { fontFamily: fonts.uiBold, color: colors.onAccent },
  artGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16, marginTop: 18 },
  artCell: { width: '31.5%', alignItems: 'center' },
  artFrame: { width: '100%', aspectRatio: 1, borderRadius: 8, padding: 3, borderWidth: 1.5, borderColor: 'transparent', overflow: 'hidden' },
  artFrameOn: { borderColor: INK },
  // 정적 자산 Image는 원본 크기(180px)를 기본 너비로 잡아 칸을 넘친다: 틀 안을 꽉 채우도록 크기를 못박는다
  artImage: { width: '100%', height: '100%', borderRadius: 5 },
  check: { position: 'absolute', top: 7, right: 7, width: 20, height: 20, borderRadius: 10, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  artName: { ...type.caption, marginTop: 6 },
  nameOn: { fontFamily: fonts.uiBold, color: colors.ink },
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, minHeight: 50, paddingHorizontal: 14, borderRadius: shape.input, borderWidth: shape.border, borderColor: colors.input, backgroundColor: colors.input },
  noneRowOn: { borderColor: INK },
  noneSwatch: { width: 22, height: 30, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'rgba(0,0,0,0.12)' },
  noneText: { ...type.sub, flex: 1 },
  design: { borderRadius: shape.input, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surface, paddingBottom: 8, alignItems: 'center' },
  designOn: { borderColor: INK, backgroundColor: colors.accentSoft },
  designName: { ...type.caption, marginTop: 2 },
  h: { ...type.section, marginTop: space.group + 4, marginBottom: space.item },
  hint: { ...type.caption },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatchCell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 2.5, borderColor: INK },
  reset: { alignSelf: 'flex-start', marginTop: space.group },
  chip: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, borderRadius: 22, borderWidth: shape.border, borderColor: colors.input, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipText: { ...type.sub, fontSize: 15, color: colors.ink },
  chipTextOn: { color: colors.onAccent },
});

// 재질 견본: 책 렌더러의 결은 아주 은은해서 작은 칸에서는 셋이 똑같아 보인다. 견본은 결을 과장해 차이가 보이게 그린다
// 무광 종이 = 고른 잔 얼룩, 천 = 가로세로 실 짜임, 코팅지 = 비스듬한 광택
function MaterialSwatch({ material, color, w, h }: { material: BindingMaterial; color: string; w: number; h: number }) {
  const speck = useMemo(() => {
    let x = 7;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 140 }, () => ({ cx: rnd() * w, cy: rnd() * h, r: 0.5 + rnd() * 1.4, o: 0.05 + rnd() * 0.08, d: rnd() > 0.25 }));
  }, [w, h]);
  const weave = useMemo(() => {
    const step = 3;
    let d = '';
    for (let y = 1; y < h; y += step) d += `M0 ${y.toFixed(1)}H${w.toFixed(1)}`;
    let v = '';
    for (let x = 1; x < w; x += step) v += `M${x.toFixed(1)} 0V${h.toFixed(1)}`;
    return { d, v };
  }, [w, h]);
  return (
    <Svg width={w} height={h} style={{ borderRadius: 10 }}>
      <Defs>
        <LinearGradient id="gloss" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.2" />
          <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.04" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.22" />
        </LinearGradient>
        <LinearGradient id="soft" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.06" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.08" />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={h} rx={10} fill={color} />
      {material === 'paper' ? speck.map((p, i) => <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.d ? '#000000' : '#FFFFFF'} opacity={p.d ? p.o : p.o * 0.5} />) : null}
      {material === 'cloth' ? (
        <>
          <Path d={weave.d} stroke="#000000" strokeOpacity={0.22} strokeWidth={1.1} />
          <Path d={weave.v} stroke="#FFFFFF" strokeOpacity={0.14} strokeWidth={1.1} />
        </>
      ) : null}
      <Rect width={w} height={h} rx={10} fill={material === 'coated' ? 'url(#gloss)' : 'url(#soft)'} />
    </Svg>
  );
}
