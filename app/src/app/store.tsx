// 스토어(2026-11-04 사용자 '선반·벽지·벽 여부를 골라 바꾸게'): 부품을 고르면 위 미리보기(홈 책장과 같은 그림, 선반 한 칸 + 예시 책 두 권)가 그 자리에서 바뀌고,
// '적용하기'를 누르면 홈 책장에 바로 반영된다(2026-11-10 사용자 '실시간으로', ui/skin-live). 고르기만 하고 나가면 원래 스킨으로 되돌린다.
// 벽 있음 ↔ '벽 없이 선반만'은 카메라·판 모양·빛 배치가 달라 실행 중에 못 바꾼다: 미리보기 대신 안내를 띄우고, 적용하면 앱을 다시 켠다.
import { reloadAppAsync } from 'expo';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SkinPreview, skinPreviewHeight } from '@/features/store/SkinPreview';
import { FRAME_SKINS, PLANK_SKINS, savedSkin, SKIN_CHOICE, skinToString, WALL_SKINS, type SkinChoice } from '@/scene-config/skin';
import { ko } from '@/i18n/ko';
import { Btn, Choice, H2, Muted, Screen, useContentWidth } from '@/ui/kit';
import { skinLive, useSkinKey } from '@/ui/skin-live';
import { colors, shape, space, type } from '@/ui/theme';

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

export default function StoreScreen() {
  const [saved] = useState(savedSkin);
  const [choice, setChoice] = useState<SkinChoice>(() => ({ ...SKIN_CHOICE }));
  const live = useSkinKey(); // 미리보기는 스킨이 바뀌면 새로 그린다
  const width = useContentWidth();
  const applied = useRef(false);
  // 고르기만 하고 나가면 원래 스킨으로
  useEffect(() => () => {
    if (!applied.current) skinLive.revert();
  }, []);
  const canLive = skinLive.canLive(choice);
  const changed = skinToString(choice) !== skinToString(saved);
  const pick = (part: Part, k: string) => {
    const next = { ...choice, [part]: k } as SkinChoice;
    setChoice(next);
    if (skinLive.canLive(next)) skinLive.preview(next);
  };
  const apply = () => {
    applied.current = true;
    if (skinLive.apply(choice) === 'restart') {
      void reloadAppAsync('스킨 적용');
      return;
    }
    router.back();
  };
  const h = skinPreviewHeight(width);
  return (
    <Screen title={ko.store.title} footer={<Btn label={canLive ? ko.store.apply : ko.store.applyRestart} size="l" disabled={!changed} onPress={apply} />}>
      <View style={[st.preview, { height: h }]} accessible accessibilityLabel={ko.store.preview}>
        {canLive ? (
          <SkinPreview key={live} width={width} />
        ) : (
          <View style={st.restart}>
            <Text style={st.restartTitle}>{choice.frame === 'none' ? ko.store.noFrame : ko.store.withFrame}</Text>
            <Muted style={st.restartBody}>{ko.store.restartNote}</Muted>
          </View>
        )}
      </View>
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
  preview: { borderRadius: shape.sheet, overflow: 'hidden', borderWidth: shape.hairline, borderColor: colors.border, backgroundColor: colors.bg },
  restart: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.l, gap: space.s },
  restartTitle: { ...type.heading, textAlign: 'center' },
  restartBody: { textAlign: 'center' },
});
