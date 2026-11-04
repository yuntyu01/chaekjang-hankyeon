// 내 기록 달력(2026-11-02 사용자가 보여 준 사진): 날짜마다 그날 읽은 책 표지를 겹쳐 놓는다. 오래 읽은 책이 맨 앞, 나머지는 왼쪽 아래로 조금씩 밀려 보인다.
// 표지는 실제 표지 사진(작은 그림 M, 못 받으면 저장된 주소), 없거나 못 읽으면 책 색 종이. 책 없이 읽은 날은 빈 종이 한 장. 기록이 있는 날을 누르면 그 날을 고른다.
import { memo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { coverAtSize } from '@/domain/cover-url';
import { formatDuration, type Library } from '@/domain/library';
import { colors, fonts, press } from '@/ui/theme';
import { calendarWeeks, type DayBooks } from './chart-data';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_LAYERS = 4; // 겹쳐 보이는 권수
const STEP_X = 4; // 뒤 책이 밀리는 만큼(왼쪽)
const STEP_Y = 2; // 뒤 책이 밀리는 만큼(아래)
const COVER_H = 46; // 표지 높이: 5주 달력 아래 요약까지 한 화면에 들어오는 값(2026-11-05 사용자 시안, 한 줄 약 90)
const COVER_RATIO = 1.42; // 표지 높이/폭
const NUM_H = 24;

function Paper({ uris = [], color, w, h }: { uris?: (string | undefined)[]; color: string; w: number; h: number }) {
  const [failed, setFailed] = useState(0);
  const tries = [...new Set(uris.filter((u): u is string => !!u))];
  const uri = tries[failed];
  return (
    <View style={[st.paper, { width: w, height: h, backgroundColor: color }]}>
      {uri ? <Image key={uri} source={{ uri }} style={st.photo} resizeMode="cover" onError={() => setFailed((n) => n + 1)} /> : null}
    </View>
  );
}

const DayCell = memo(function DayCell({ lib, day, row, cell, selected, today, onSelect }: { lib: Library; day: string; row?: DayBooks; cell: number; selected: boolean; today: boolean; onSelect: (day: string) => void }) {
  const n = Number(day.slice(8));
  const h = COVER_H;
  const w = Math.min(Math.round(h / COVER_RATIO), Math.max(16, cell - 4));
  const side = (cell - w) / 2; // 맨 앞 표지는 칸 가운데(날짜 아래)
  const ids = (row?.books ?? []).filter((id) => lib.books[id]).slice(0, MAX_LAYERS);
  const titles = ids.map((id) => lib.editions[lib.books[id].editionId]?.title).filter(Boolean);
  const label = row ? `${n}일, ${titles.length ? `${titles[0]}${(row.books.length > 1) ? ` 외 ${row.books.length - 1}권` : ''}, ` : ''}${formatDuration(row.ms)}` : `${n}일, 기록 없음`;
  return (
    <Pressable
      disabled={!row}
      onPress={() => onSelect(day)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !row }}
      style={({ pressed }) => [{ width: cell }, pressed && press]}>
      <View style={st.numRow}>
        {/* collapsable: 바탕색이 나중에 붙을 때 안드로이드가 뷰를 새로 만들며 둥근 모서리를 잃어 네모로 그렸다(2026-11-02 에뮬) */}
        <View collapsable={false} style={[st.num, selected && st.numOn]}>
          <Text style={[st.numText, today && st.numToday, selected && st.numTextOn]}>{n}</Text>
        </View>
      </View>
      <View style={{ height: h + (MAX_LAYERS - 1) * STEP_Y }}>
        {/* 뒤 책부터 그린다 */}
        {[...ids].reverse().map((id) => {
          const i = ids.indexOf(id);
          const b = lib.books[id];
          const e = lib.editions[b.editionId];
          const color = (b.bindingId && lib.bindings[b.bindingId]?.spineColor) || colors.input;
          return (
            <View key={id} style={{ position: 'absolute', right: side + i * STEP_X, top: i * STEP_Y }}>
              <Paper uris={[coverAtSize(e?.coverUri, 'M'), e?.coverUri]} color={color} w={w} h={h} />
            </View>
          );
        })}
        {!ids.length && row ? (
          <View style={{ position: 'absolute', right: side, top: 0 }}>
            <Paper color={colors.input} w={w} h={h} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

export function ReadingCalendar({ lib, y, m, days, selected, today, onSelect }: { lib: Library; y: number; m: number; days: Map<string, DayBooks>; selected: string | null; today: string; onSelect: (day: string) => void }) {
  const [width, setWidth] = useState(0);
  const cell = width / 7;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={st.wrap}>
      <View style={st.weekRow}>
        {WEEK.map((d) => (
          <Text key={d} style={[st.week, { width: `${100 / 7}%` }]}>{d}</Text>
        ))}
      </View>
      {cell > 0
        ? calendarWeeks(y, m).map((week, i) => (
            <View key={i} style={st.row}>
              {week.map((day, j) =>
                day ? <DayCell key={day} lib={lib} day={day} row={days.get(day)} cell={cell} selected={selected === day} today={today === day} onSelect={onSelect} /> : <View key={`e${j}`} style={{ width: cell }} />,
              )}
            </View>
          ))
        : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { marginTop: 8 },
  weekRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.track },
  week: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, textAlign: 'center' },
  row: { flexDirection: 'row', paddingTop: 6, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  numRow: { height: NUM_H, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  num: { minWidth: NUM_H, height: NUM_H, borderRadius: NUM_H / 2, alignItems: 'center', justifyContent: 'center' },
  numOn: { backgroundColor: colors.accent },
  numText: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft, fontVariant: ['tabular-nums'], includeFontPadding: false },
  numToday: { fontFamily: fonts.uiBold, color: colors.ink },
  numTextOn: { fontFamily: fonts.uiBold, color: colors.onAccent },
  // 흰 표지도 바탕과 갈리게 얇은 선 + 옅은 그림자
  paper: { borderRadius: 2.5, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(25,31,40,0.14)', shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1.5 },
  photo: { ...StyleSheet.absoluteFill, borderRadius: 2.5 },
});
