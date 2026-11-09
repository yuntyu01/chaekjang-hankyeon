// 날짜·시각 고르기(2026-11-09 UX 점검: 회차 시작일·완독일, 독서 기록 날짜·시각을 'YYYY-MM-DD'·'HH:MM'으로 손으로 쳐야 했다).
// 칸은 SelectField와 같은 모양이고, 누르면 하단 시트가 뜬다. 날짜는 한 달 달력에서 하루를 누르면 바로 정해지고(고를 수 없는 날은 흐리게),
// 시각은 시·분 바퀴를 돌려 '확인'으로 정한다. 값은 저장 형식 그대로('YYYY-MM-DD', 'HH:MM') 주고받는다.
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';

import { ChevronLeft, ChevronRight } from '@/ui/icons';
import { Btn, IconButton, SelectField, Sheet, TextLink } from '@/ui/kit';
import { colors, fonts, icon, press, space, type } from '@/ui/theme';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
export const todayKey = (now = new Date()) => dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
// 칸에 보이는 날짜: 좁은 두 칸에도 한 줄로 들어가게 숫자만(2026.11.09)
export const dayLabel = (v: string) => v.replaceAll('-', '.');

type DateProps = {
  label: string;
  value: string; // 'YYYY-MM-DD' 또는 ''(정하지 않음)
  onChange: (v: string) => void; // 지우면 ''
  placeholder?: string;
  min?: string; // 고를 수 있는 첫날(포함)
  max?: string; // 마지막 날(포함). 기본 오늘(기록은 미래가 없다)
  clearable?: boolean; // '날짜 지우기'
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function DateField({ label, value, onChange, placeholder = '날짜 고르기', min, max, clearable, disabled, style }: DateProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SelectField label={label} value={value ? dayLabel(value) : undefined} placeholder={placeholder} onPress={() => setOpen(true)} disabled={disabled} style={style} />
      <DatePickerSheet
        visible={open}
        title={label.replace(/ \(.+\)$/, '')}
        value={value}
        min={min}
        max={max ?? todayKey()}
        onClose={() => setOpen(false)}
        onPick={(v) => {
          setOpen(false);
          if (v !== value) onChange(v);
        }}
        onClear={clearable && value ? () => {
          setOpen(false);
          onChange('');
        } : undefined}
      />
    </>
  );
}

type DateSheetProps = { visible: boolean; title: string; value: string; min?: string; max?: string; onPick: (v: string) => void; onClose: () => void; onClear?: () => void };

export function DatePickerSheet(p: DateSheetProps) {
  // 열 때마다 처음 달을 다시 잡는다(닫히는 동안에도 내용은 그대로 보인다)
  return (
    <Sheet visible={p.visible} onClose={p.onClose} title={p.title}>
      <DateBody key={p.visible ? 'open' : 'closed'} {...p} />
    </Sheet>
  );
}

function DateBody({ value, min, max, onPick, onClear }: DateSheetProps) {
  // 처음 보이는 달: 고른 날, 없으면 마지막으로 고를 수 있는 날(보통 오늘)이 든 달
  const start = value || max || todayKey();
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) }));
  const { y, m } = ym;
  const cells = useMemo(() => {
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const out: (number | null)[] = Array.from({ length: first }, () => null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7) out.push(null);
    return out;
  }, [y, m]);
  const monthKey = (yy: number, mm: number) => `${yy}-${pad2(mm)}`;
  const canPrev = !min || monthKey(y, m) > min.slice(0, 7);
  const canNext = !max || monthKey(y, m) < max.slice(0, 7);
  const shift = (k: number) => {
    const t = new Date(y, m - 1 + k, 1);
    setYm({ y: t.getFullYear(), m: t.getMonth() + 1 });
  };
  const today = todayKey();
  return (
    <>
      <View style={st.monthRow}>
        <IconButton label="이전 달" disabled={!canPrev} onPress={() => shift(-1)}>
          <ChevronLeft size={icon.size} color={canPrev ? colors.ink : colors.inkFaint} strokeWidth={icon.stroke} />
        </IconButton>
        <Text style={st.month} accessibilityRole="header">{y}년 {m}월</Text>
        <IconButton label="다음 달" disabled={!canNext} onPress={() => shift(1)}>
          <ChevronRight size={icon.size} color={canNext ? colors.ink : colors.inkFaint} strokeWidth={icon.stroke} />
        </IconButton>
      </View>
      <View style={st.grid}>
        {WEEK.map((w) => (
          <Text key={w} style={[st.cell, st.week]} importantForAccessibility="no">{w}</Text>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={st.cell} />;
          const k = dayKey(y, m, d);
          const off = (!!min && k < min) || (!!max && k > max);
          const on = k === value;
          return (
            <Pressable
              key={k}
              disabled={off}
              onPress={() => onPick(k)}
              accessibilityRole="button"
              accessibilityLabel={`${m}월 ${d}일 ${WEEK[i % 7]}요일${k === today ? ', 오늘' : ''}`}
              accessibilityState={{ selected: on, disabled: off }}
              style={({ pressed }) => [st.cell, pressed && press]}>
              <View style={[st.day, on && st.dayOn]}>
                <Text style={[st.dayText, k === today && st.today, on && st.dayTextOn, off && { color: colors.inkFaint }]}>{d}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {onClear ? <TextLink label="날짜 지우기" tone="soft" onPress={onClear} style={{ alignSelf: 'center', marginTop: space.s }} /> : null}
    </>
  );
}

// 시각 칸: 'HH:MM'
export function TimeField({ label, value, onChange, style }: { label: string; value: string; onChange: (v: string) => void; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SelectField label={label} value={value || undefined} placeholder="시각 고르기" onPress={() => setOpen(true)} style={style} />
      <TimePickerSheet
        visible={open}
        title={label.replace(/ \(.+\)$/, '')}
        value={value}
        onClose={() => setOpen(false)}
        onPick={(v) => {
          setOpen(false);
          if (v !== value) onChange(v);
        }}
      />
    </>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

type TimeSheetProps = { visible: boolean; title: string; value: string; onPick: (v: string) => void; onClose: () => void };

export function TimePickerSheet(p: TimeSheetProps) {
  return (
    <Sheet visible={p.visible} onClose={p.onClose} title={p.title}>
      <TimeBody key={p.visible ? 'open' : 'closed'} {...p} />
    </Sheet>
  );
}

function TimeBody({ value, onPick }: TimeSheetProps) {
  const [hm, setHm] = useState(() => {
    const mt = /^(\d{1,2}):(\d{2})$/.exec(value);
    const now = new Date();
    return mt ? { h: Math.min(23, Number(mt[1])), m: Math.min(59, Number(mt[2])) } : { h: now.getHours(), m: now.getMinutes() };
  });
  return (
    <>
      <View style={st.wheels}>
        <View style={st.band} pointerEvents="none" />
        <Wheel items={HOURS} index={hm.h} unit="시" onChange={(h) => setHm((q) => ({ ...q, h }))} />
        <Text style={st.colon}>:</Text>
        <Wheel items={MINUTES} index={hm.m} unit="분" onChange={(m) => setHm((q) => ({ ...q, m }))} />
      </View>
      <Btn label="확인" onPress={() => onPick(`${pad2(hm.h)}:${pad2(hm.m)}`)} style={{ marginTop: space.l }} />
    </>
  );
}

// 돌리는 목록 하나: 가운데 줄이 고른 값. 손을 떼면 가까운 줄에 멈춘다. 화면 읽기에서는 위아래로 쓸어 한 칸씩 바꾼다(adjustable)
const ROW = 44;
const VISIBLE = 5;
function Wheel({ items, index, unit, onChange }: { items: string[]; index: number; unit: string; onChange: (i: number) => void }) {
  const ref = useRef<ScrollView>(null);
  const [cur, setCur] = useState(index);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ROW)));
    setCur(i);
    onChange(i);
  };
  const step = (k: number) => {
    const i = Math.max(0, Math.min(items.length - 1, cur + k));
    setCur(i);
    onChange(i);
    ref.current?.scrollTo({ y: i * ROW, animated: true });
  };
  return (
    <View
      style={st.wheel}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${Number(items[cur])}${unit}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: index * ROW }}
        onLayout={() => ref.current?.scrollTo({ y: index * ROW, animated: false })}
        contentContainerStyle={{ paddingVertical: ((VISIBLE - 1) / 2) * ROW }}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / ROW);
          if (i !== cur && i >= 0 && i < items.length) setCur(i);
        }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(e) => {
          // 튕기지 않고 놓으면 멈춤 이벤트가 오지 않는다(안드로이드)
          if (Math.abs(e.nativeEvent.velocity?.y ?? 0) < 0.05) settle(e);
        }}>
        {items.map((t, i) => (
          <Pressable key={t} onPress={() => step(i - cur)} style={st.wheelRow} importantForAccessibility="no">
            <Text style={[st.wheelText, i === cur && st.wheelOn]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const CELL = `${100 / 7}%` as const;
const st = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.l, marginBottom: space.s },
  month: { ...type.section, minWidth: 128, textAlign: 'center', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: 44, alignItems: 'center', justifyContent: 'center' },
  week: { ...type.caption, textAlign: 'center', textAlignVertical: 'center', lineHeight: 44 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.accent },
  dayText: { fontFamily: fonts.ui, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], includeFontPadding: false },
  dayTextOn: { fontFamily: fonts.uiBold, color: colors.onAccent },
  today: { fontFamily: fonts.uiBold, color: colors.accent },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: ROW * VISIBLE, gap: space.s },
  // 가운데 고른 줄(입력칸 색 띠)
  band: { position: 'absolute', left: 0, right: 0, top: ROW * ((VISIBLE - 1) / 2), height: ROW, borderRadius: 10, backgroundColor: colors.input },
  wheel: { width: 76, height: ROW * VISIBLE },
  wheelRow: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontFamily: fonts.ui, fontSize: 20, color: colors.inkFaint, fontVariant: ['tabular-nums'], includeFontPadding: false },
  wheelOn: { fontFamily: fonts.uiBold, color: colors.ink },
  colon: { fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink },
});
