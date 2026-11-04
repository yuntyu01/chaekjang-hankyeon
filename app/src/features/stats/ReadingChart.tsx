// 내 기록 막대그래프(2026-11-01 사용자 시안): 날·달마다 둥근 막대, 고른 막대만 갈색 + 위에 '31일 · 1시간 10분' 말풍선, 왼쪽 눈금과 점선.
// 막대를 누르면 그 날을 고른다. 기록 없는 칸은 고를 수 없다. 숫자는 모두 실제 기록으로 계산한다.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { formatDuration } from '@/domain/library';
import { colors, fonts } from '@/ui/theme';
import { tickLabel, xLabels, yTicks, type Bar } from './chart-data';

const PLOT_H = 170; // 막대 영역
const TIP_H = 44; // 말풍선 자리
const AXIS_W = 38; // 왼쪽 눈금 글자
const LABEL_H = 26; // 아래 글자

export function ReadingChart({ bars, selected, unit, onSelect }: { bars: Bar[]; selected: string | null; unit: '일' | '월'; onSelect: (key: string) => void }) {
  const [w, setW] = useState(0);
  const [tipW, setTipW] = useState(0);
  const max = Math.max(...bars.map((b) => b.ms), 0);
  const ticks = yTicks(max);
  const scale = (ms: number) => (max > 0 ? (ms / max) * (PLOT_H - 6) : 0);
  const plotW = Math.max(0, w - AXIS_W);
  const cell = bars.length ? plotW / bars.length : 0;
  const barW = Math.max(3, Math.min(unit === '월' ? 14 : 7, cell * 0.6));
  const cx = (i: number) => AXIS_W + cell * (i + 0.5);
  const sel = bars.findIndex((b) => b.key === selected && b.ms > 0);
  const base = TIP_H + PLOT_H;
  const barH = (ms: number) => Math.max(barW, scale(ms)); // 아주 짧은 기록도 둥근 점으로 보이게
  // 말풍선은 막대 위 가운데, 양 끝에서는 그래프 안쪽에 붙인다(꼬리는 늘 막대 위)
  const tipSide = sel < 0 ? {} : cx(sel) + tipW / 2 > w ? { right: 0 } : { left: Math.max(0, cx(sel) - tipW / 2) };
  const barTop = sel >= 0 ? base - barH(bars[sel].ms) : 0;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: base + LABEL_H }}>
      {w > 0 ? (
        <>
          <Svg width={w} height={base + 6} style={StyleSheet.absoluteFill}>
            {ticks.map((t) => {
              const y = base - scale(t * 60000);
              return <Line key={t} x1={AXIS_W} x2={w} y1={y} y2={y} stroke={colors.line} strokeWidth={1} strokeDasharray="4 4" />;
            })}
            <Line x1={AXIS_W} x2={w} y1={base} y2={base} stroke={colors.line} strokeWidth={1} />
            {bars.map((b, i) => {
              if (b.ms <= 0) return null;
              const h = barH(b.ms);
              return <Rect key={b.key} x={cx(i) - barW / 2} y={base - h} width={barW} height={h} rx={barW / 2} fill={i === sel ? colors.accent : colors.track} />;
            })}
          </Svg>
          {ticks.map((t) => (
            <Text key={t} style={[st.tick, { top: base - scale(t * 60000) - 9 }]}>{tickLabel(t)}</Text>
          ))}
          <Text style={[st.tick, { top: base - 9 }]}>0</Text>
          {xLabels(bars.length).map((n) => (
            <Text key={n} style={[st.xLabel, { left: cx(n - 1) - 15, top: base + 6 }]}>{n}</Text>
          ))}
          {bars.map((b, i) => (
            <Pressable
              key={b.key}
              disabled={b.ms <= 0}
              onPress={() => onSelect(b.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: i === sel, disabled: b.ms <= 0 }}
              accessibilityLabel={`${b.label}${unit} ${formatDuration(b.ms)}`}
              importantForAccessibility={b.ms > 0 ? 'auto' : 'no'}
              style={{ position: 'absolute', left: AXIS_W + cell * i, width: cell, top: TIP_H, height: PLOT_H + LABEL_H }}
            />
          ))}
          {sel >= 0 ? (
            <>
              <View onLayout={(e) => setTipW(e.nativeEvent.layout.width)} style={[st.tip, tipSide, { top: barTop - 42, opacity: tipW ? 1 : 0 }]} pointerEvents="none">
                <Text style={st.tipText}>{bars[sel].label}{unit} · <Text style={st.tipStrong}>{formatDuration(bars[sel].ms)}</Text></Text>
              </View>
              <View style={[st.tipArrow, { left: cx(sel) - 5, top: barTop - 17 }]} pointerEvents="none" />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  tick: { position: 'absolute', left: 0, width: AXIS_W - 6, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, includeFontPadding: false },
  xLabel: { position: 'absolute', width: 30, textAlign: 'center', fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, includeFontPadding: false },
  tip: { position: 'absolute', height: 30, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: colors.accent },
  tipText: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.onAccent, includeFontPadding: false },
  tipStrong: { fontFamily: fonts.uiBold },
  tipArrow: { position: 'absolute', width: 10, height: 10, transform: [{ rotate: '45deg' }], backgroundColor: colors.accent },
});
