// 스토어(2026-11-04 사용자 '우상단 스토어 아이콘, 선반·벽지·벽 여부를 골라 바꾸게'): 부품을 고르고 '적용하기'를 누르면 앱을 다시 켜 책장 전체에 반영한다.
// 스킨은 시작할 때 정해지는 값이다(카메라·빛 맞추기·그림 재료가 모두 여기서 나온다). 고른 값은 시작 설정에 저장한다(scene-config/skin SKIN_KEY).
import { reloadAppAsync } from 'expo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FRAME_SKINS, PLANK_SKINS, SKIN_CHOICE, SKIN_KEY, skinToString, WALL_SKINS, type SkinChoice } from '@/scene-config/skin';
import { writeBootSetting } from '@/scene-config/boot-store';
import { ko } from '@/i18n/ko';
import { Btn, Choice, H2, Muted, Screen } from '@/ui/kit';
import { colors, shape, space } from '@/ui/theme';

type Part = keyof SkinChoice;

function Options<K extends string>({ part, table, value, onPick, noneLabel }: { part: Part; table: Record<K, { name: string; color: string } | null>; value: K; onPick: (part: Part, k: K) => void; noneLabel?: string }) {
  return (
    <View style={st.grid}>
      {(Object.keys(table) as K[]).map((k) => {
        const skin = table[k];
        return (
          <Choice key={k} compact label={skin?.name ?? noneLabel ?? ''} selected={value === k} onPress={() => onPick(part, k)} style={st.cell}>
            <View style={[st.swatch, skin ? { backgroundColor: skin.color } : st.swatchNone]} />
          </Choice>
        );
      })}
    </View>
  );
}

// 고른 색으로 그린 작은 책장(실제 그림은 적용한 뒤 빛까지 계산된다)
function Preview({ choice }: { choice: SkinChoice }) {
  const plank = PLANK_SKINS[choice.plank].color;
  const frame = FRAME_SKINS[choice.frame];
  const wall = WALL_SKINS[choice.wall].color;
  const row = (key: string, books: [number, string][]) => (
    <View key={key} style={st.previewRow}>
      <View style={st.previewBooks}>
        {books.map(([h, c], i) => <View key={i} style={{ width: 12, height: h, backgroundColor: c, borderRadius: 1 }} />)}
      </View>
      <View style={[st.previewPlank, { backgroundColor: plank }]} />
    </View>
  );
  return (
    <View style={[st.preview, { backgroundColor: wall }]} accessible accessibilityLabel={ko.store.preview}>
      <View style={[st.previewNiche, frame ? { borderColor: frame.color, borderWidth: 6, backgroundColor: wall } : null]}>
        {row('a', [[44, colors.chipOn], [52, '#D9A7A8'], [38, '#2F7D5B']])}
        {row('b', [[48, '#7D95BF'], [40, '#D8D5CC'], [52, '#5276B3']])}
      </View>
    </View>
  );
}

export default function StoreScreen() {
  const [choice, setChoice] = useState<SkinChoice>(SKIN_CHOICE);
  const changed = skinToString(choice) !== skinToString(SKIN_CHOICE);
  const pick = (part: Part, k: string) => setChoice((c) => ({ ...c, [part]: k }));
  const apply = () => {
    writeBootSetting(SKIN_KEY, skinToString(choice));
    void reloadAppAsync('스킨 적용');
  };
  return (
    <Screen title={ko.store.title} footer={<Btn label={ko.store.apply} size="l" disabled={!changed} onPress={apply} />}>
      <Preview choice={choice} />
      <H2>{ko.store.plank}</H2>
      <Options part="plank" table={PLANK_SKINS} value={choice.plank} onPick={pick} />
      <H2>{ko.store.wall}</H2>
      <Options part="wall" table={WALL_SKINS} value={choice.wall} onPick={pick} />
      <H2>{ko.store.frame}</H2>
      <Options part="frame" table={FRAME_SKINS} value={choice.frame} onPick={pick} noneLabel={ko.store.noFrame} />
      <Muted style={{ marginTop: space.l }}>{ko.store.note}</Muted>
    </Screen>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  cell: { width: '48%' },
  swatch: { height: 28, borderRadius: shape.tag, marginBottom: space.s, borderWidth: shape.hairline, borderColor: colors.border },
  swatchNone: { backgroundColor: colors.bg, borderStyle: 'dashed', borderWidth: shape.border },
  preview: { height: 190, borderRadius: shape.sheet, padding: space.m, alignItems: 'center', justifyContent: 'center', borderWidth: shape.hairline, borderColor: colors.border, overflow: 'hidden' },
  previewNiche: { width: '72%', height: '100%', borderRadius: 8, paddingHorizontal: 10, paddingTop: 6, justifyContent: 'space-around' },
  previewRow: { justifyContent: 'flex-end' },
  previewBooks: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, paddingLeft: 6 },
  previewPlank: { height: 6, borderRadius: 1 },
});
