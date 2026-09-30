// 장정 미리보기·편집(책 추가 마지막 단계와 책 상세의 장정 편집이 함께 쓴다).
// 책장과 같은 3D 책 렌더러로 책등·정면을 보여 준다. 그림(AI)은 평평한 표지·책등 그림만, 제목 조판·몸체·명암은 코드가 그린다.
// AI가 연결되지 않은 지금은 기본 장정(책등 색 + 모티프)을 만들고, '다시 만들기'는 다른 조합을 고른다(생성 결과는 저장해 재사용).
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { defaultBinding, ESTIMATED_PAGES, ESTIMATED_SIZE, MOTIF_CHOICES, SPINE_PALETTE, type Binding, type SizeMm } from '@/domain/library';
import type { Book, MotifId } from '@/domain/types';
import { aiBinding } from '@/services/connectors';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';
import { Btn, Chip, H2, Muted, Row } from '@/ui/kit';
import { colors } from '@/ui/theme';

export type BindingDraft = Pick<Binding, 'spineColor' | 'motif' | 'seed' | 'source'>;

const MOTIF_NAMES: Record<MotifId, string> = { leaf: '잎', sprig: '가지', cotton: '목화', moon: '달', star: '별', wave: '물결', flower: '꽃', pine: '소나무', bud: '꽃봉오리' };

export function previewBook(p: { title: string; author?: string; size?: SizeMm; pages?: number; binding: BindingDraft }): Book {
  const size = p.size ?? ESTIMATED_SIZE;
  return {
    id: 'preview',
    title: p.title || '제목',
    author: p.author || undefined,
    themeColor: p.binding.spineColor,
    heightClass: 'medium',
    thicknessClass: 'medium',
    coverAspectRatio: size.widthMm / size.heightMm,
    physical: { ...size, pages: p.pages ?? ESTIMATED_PAGES },
    art: { motif: p.binding.motif },
  };
}

export function BindingEditor({ title, author, size, pages, value, onChange }: { title: string; author?: string; size?: SizeMm; pages?: number; value: BindingDraft; onChange: (v: BindingDraft) => void }) {
  const book = useMemo(() => previewBook({ title, author, size, pages, binding: value }), [title, author, size, pages, value]);
  return (
    <View>
      <View style={st.stage} accessibilityLabel={`장정 미리보기: 책등과 정면`}>
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
      <Muted style={{ marginTop: 8 }}>{aiBinding.available ? 'AI 재장정 그림을 쓰고 있어요.' : `기본 장정이에요. ${aiBinding.reason}`}</Muted>

      <H2>책등 색</H2>
      <Row gap={10}>
        {SPINE_PALETTE.map((c) => (
          <Pressable
            key={c}
            onPress={() => onChange({ ...value, spineColor: c })}
            accessibilityRole="button"
            accessibilityLabel={`책등 색 ${c}`}
            accessibilityState={{ selected: value.spineColor === c }}
            style={[st.swatch, { backgroundColor: c }, value.spineColor === c && st.swatchOn]}
          />
        ))}
      </Row>

      <H2>모티프</H2>
      <Row>
        <Chip label="없음" on={value.motif === 'none'} onPress={() => onChange({ ...value, motif: 'none' })} />
        {MOTIF_CHOICES.map((m) => (
          <Chip key={m} label={MOTIF_NAMES[m]} on={value.motif === m} onPress={() => onChange({ ...value, motif: m })} />
        ))}
      </Row>

      <Btn
        label="다시 만들기"
        kind="secondary"
        style={{ marginTop: 18 }}
        onPress={() => {
          const next = defaultBinding('preview', title, value.seed + 1, '');
          onChange({ spineColor: next.spineColor, motif: next.motif, seed: next.seed, source: 'default' });
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  stage: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 28, paddingVertical: 18, borderRadius: 14, backgroundColor: '#F4EDE2' },
  col: { alignItems: 'center', gap: 6 },
  cap: { fontSize: 12, color: colors.inkSoft },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
});
