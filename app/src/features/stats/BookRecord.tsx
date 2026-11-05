// 책 한 권의 기록 요약(2026-11-05 사용자 '책 선택해서 그 책 읽은 기록 분석, 내용 말고 기록'): 기록 탭에서 책을 고르면 기간과 상관없이 그 책 전체를 맨 위에 보여 준다.
// 쪽을 모르면 읽는 속도·남은 시간 칸을 지어내지 않고 숨긴다(chart-data bookRecord).
import { StyleSheet, Text, View } from 'react-native';

import { formatDuration, type Library } from '@/domain/library';
import { bookRecord } from '@/features/stats/chart-data';
import { LinkedCover } from '@/ui/BookVisual';
import { SectionBand } from '@/ui/kit';
import { colors, fonts, space, type } from '@/ui/theme';

const dot = (day: string) => day.replace(/-/g, '.');

export function StatNumber({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.number} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={type.caption}>{label}</Text>
      <Text style={st.numberValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

export function BookRecord({ lib, id }: { lib: Library; id: string }) {
  const r = bookRecord(lib, id);
  const title = lib.editions[lib.books[id]?.editionId]?.title;
  const span = r.firstDay ? (r.firstDay === r.lastDay ? dot(r.firstDay) : `${dot(r.firstDay)} ~ ${dot(r.lastDay!)}`) : '아직 기록이 없어요';
  return (
    <View style={st.root}>
      <View style={st.head}>
        <View style={st.cover} pointerEvents="none"><LinkedCover lib={lib} id={id} width={40} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.rowStrong} numberOfLines={1} accessibilityRole="header">{title}</Text>
          <Text style={[type.sub, { marginTop: 2 }]} numberOfLines={1}>{span}</Text>
        </View>
      </View>
      <View style={st.numbers}>
        <StatNumber label="총 독서 시간" value={formatDuration(r.readMs)} />
        <StatNumber label="읽은 날" value={`${r.days}일`} />
        <StatNumber label="완독" value={`${r.finished}회`} />
      </View>
      {r.pagesPerMin != null ? (
        <View style={st.numbers}>
          <StatNumber label="읽는 속도" value={`분당 ${r.pagesPerMin.toFixed(1)}쪽`} />
          {r.remainingMs != null ? <StatNumber label="다 읽기까지" value={`약 ${formatDuration(r.remainingMs)}`} /> : <View style={st.number} />}
          <View style={st.number} />
        </View>
      ) : null}
      <SectionBand />
    </View>
  );
}

const st = StyleSheet.create({
  root: { marginTop: space.s },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  cover: { width: 40, alignItems: 'center' },
  numbers: { flexDirection: 'row', gap: space.m, marginTop: space.l },
  number: { flex: 1, gap: space.xs },
  numberValue: { fontFamily: fonts.uiBold, fontSize: 20, lineHeight: 28, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
});
