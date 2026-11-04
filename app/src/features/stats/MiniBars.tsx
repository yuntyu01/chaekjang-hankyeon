// 내 기록의 작은 막대그래프 하나(읽은 시간대·요일·한 번에 읽는 길이): 제목 + 요약 한 줄 + 둥근 막대. 가장 큰 칸과 누른 칸만 테마색이다.
// 칸을 누르면 요약 줄에 그 칸의 값이 나온다. 숫자는 모두 실제 기록으로 계산한다(features/stats/chart-data).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { colors, fonts, tidyType as type } from '@/ui/screenTheme';

export type MiniBar = { key: string; name: string; value: number };

const PLOT_H = 110;
const LABEL_H = 24;
const BAR_MAX = 26;

export function MiniBars({ title, bars, labels, emptyText, summary, valueText }: {
  title: string;
  bars: MiniBar[];
  labels: { at: number; text: string }[]; // 가로 글자: 칸 번호(at, 칸 가운데)와 글자
  emptyText: string;
  summary: (peak: MiniBar) => string; // 아무 칸도 누르지 않았을 때 요약
  valueText: (bar: MiniBar) => string; // 칸의 값 글자
}) {
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);
  const peak = max > 0 ? bars.find((b) => b.value === max)! : null;
  const chosen = bars.find((b) => b.key === picked && b.value > 0) ?? null;
  const shown = chosen ?? peak;
  const cell = bars.length ? w / bars.length : 0;
  const barW = Math.max(3, Math.min(BAR_MAX, cell * 0.62));
  const barH = (v: number) => Math.max(barW, (v / max) * (PLOT_H - 6)); // 아주 작은 값도 둥근 점으로 보이게
  return (
    <View>
      <Text style={type.section} accessibilityRole="header">{title}</Text>
      <Text style={[type.sub, st.note]}>{!shown ? emptyText : chosen ? `${chosen.name} · ${valueText(chosen)}` : summary(shown)}</Text>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: PLOT_H + LABEL_H }}>
        {w > 0 ? (
          <>
            <Svg width={w} height={PLOT_H + 2} style={StyleSheet.absoluteFill}>
              <Line x1={0} x2={w} y1={PLOT_H} y2={PLOT_H} stroke={colors.line} strokeWidth={1} />
              {bars.map((b, i) => {
                if (b.value <= 0) return null;
                const bh = barH(b.value);
                return <Rect key={b.key} x={cell * (i + 0.5) - barW / 2} y={PLOT_H - bh} width={barW} height={bh} rx={Math.min(barW / 2, 6)} fill={shown && b.key === shown.key ? colors.accent : colors.track} />;
              })}
            </Svg>
            {labels.map((l) => (
              <Text key={l.at} style={[st.label, { left: cell * (l.at + 0.5) - 24, top: PLOT_H + 6 }]} numberOfLines={1}>{l.text}</Text>
            ))}
            {bars.map((b, i) => (
              <Pressable
                key={b.key}
                disabled={b.value <= 0}
                onPress={() => setPicked(b.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: !!shown && b.key === shown.key, disabled: b.value <= 0 }}
                accessibilityLabel={`${b.name} ${valueText(b)}`}
                importantForAccessibility={b.value > 0 ? 'auto' : 'no'}
                style={{ position: 'absolute', left: cell * i, width: cell, top: 0, height: PLOT_H + LABEL_H }}
              />
            ))}
          </>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  note: { marginTop: 2, marginBottom: 14 },
  label: { position: 'absolute', width: 48, textAlign: 'center', fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, includeFontPadding: false },
});
