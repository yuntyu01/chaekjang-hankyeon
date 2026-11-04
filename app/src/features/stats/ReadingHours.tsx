// 내 기록 '읽은 시간대'(2026-11-04 사용자 '읽은 시간대도, 막대그래프로'): 고른 기간·책의 독서 시간을 하루 24칸에 더한 막대. 가장 많이 읽은 시간과 누른 시간만 테마색이다.
// 칸을 누르면 그 시간의 합이 위 글자에 나온다. 숫자는 모두 실제 기록으로 계산한다(features/stats/chart-data hourBars).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { formatDuration, type Session } from '@/domain/library';
import { colors, fonts, tidyType as type } from '@/ui/screenTheme';
import { hourBars, hourLabel, peakHour } from './chart-data';

const PLOT_H = 110;
const LABEL_H = 24;
const BAR_MAX = 9;
const TICKS = [0, 6, 12, 18]; // 가로 글자(그 시간 칸의 왼쪽 끝)

export function ReadingHours({ sessions }: { sessions: Session[] }) {
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const hours = hourBars(sessions);
  const max = Math.max(...hours, 0);
  const peak = peakHour(hours);
  const shown = picked !== null && hours[picked] > 0 ? picked : peak;
  const cell = w / 24;
  const barW = Math.max(3, Math.min(BAR_MAX, cell * 0.62));
  const barH = (ms: number) => Math.max(barW, (ms / max) * (PLOT_H - 6)); // 아주 짧은 기록도 둥근 점으로 보이게
  return (
    <View>
      <Text style={type.section} accessibilityRole="header">읽은 시간대</Text>
      <Text style={[type.sub, st.note]}>
        {shown === null ? '이 기간에는 기록이 없어요.' : shown === peak && picked === null ? `${hourLabel(shown)}에 가장 많이 읽었어요 · ${formatDuration(hours[shown])}` : `${hourLabel(shown)} · ${formatDuration(hours[shown])}`}
      </Text>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: PLOT_H + LABEL_H }}>
        {w > 0 ? (
          <>
            <Svg width={w} height={PLOT_H + 2} style={StyleSheet.absoluteFill}>
              <Line x1={0} x2={w} y1={PLOT_H} y2={PLOT_H} stroke={colors.line} strokeWidth={1} />
              {hours.map((ms, h) => {
                if (ms <= 0) return null;
                const bh = barH(ms);
                return <Rect key={h} x={cell * (h + 0.5) - barW / 2} y={PLOT_H - bh} width={barW} height={bh} rx={barW / 2} fill={h === shown ? colors.accent : colors.track} />;
              })}
            </Svg>
            {TICKS.map((h) => (
              <Text key={h} style={[st.tick, { left: cell * h, top: PLOT_H + 6 }]}>{h}시</Text>
            ))}
            <Text style={[st.tick, st.tickEnd, { top: PLOT_H + 6 }]}>24시</Text>
            {hours.map((ms, h) => (
              <Pressable
                key={h}
                disabled={ms <= 0}
                onPress={() => setPicked(h)}
                accessibilityRole="button"
                accessibilityState={{ selected: h === shown, disabled: ms <= 0 }}
                accessibilityLabel={`${hourLabel(h)} ${formatDuration(ms)}`}
                importantForAccessibility={ms > 0 ? 'auto' : 'no'}
                style={{ position: 'absolute', left: cell * h, width: cell, top: 0, height: PLOT_H + LABEL_H }}
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
  tick: { position: 'absolute', fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, includeFontPadding: false },
  tickEnd: { right: 0 },
});
