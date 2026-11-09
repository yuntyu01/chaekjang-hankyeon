// 홈 머리줄(2026-11-09 홈 시안: 머리에 큰 '2026'만): 벽에 새긴 해 숫자를 화면 가운데에, 오른쪽에 아이콘.
// 지금 책장과 지난 책장(YearShelf)이 같이 쓴다. 좁은 화면이라 숫자가 아이콘 묶음에 닿으면 닿지 않을 만큼만 왼쪽으로 비킨다.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EngravedYear, engravedHeight } from '@/ui/EngravedYear';
import { tabHeader } from '@/ui/theme';

export const YEAR_SIZE = 34; // 시안: 숫자 높이 약 24dp
export const HEADER_ICON = 36; // 아이콘 칸(시안 아이콘 간격 약 35dp). 누르는 곳은 hitSlop으로 48
export const HEADER_ICON_SLOP = 6;
const RIGHT_PULL = 11; // 아이콘 묶음을 머리줄 오른쪽 여백(24) 밖으로 당긴다: 맨 끝 아이콘 그림이 화면 끝에서 약 19dp(시안)
const GAP = 8; // 숫자와 아이콘 묶음 사이 최소 간격

type Props = {
  year: number;
  a11yLabel: string;
  width: number; // 화면 폭
  actionsW: number; // 오른쪽 묶음 폭
  onPressYear?: () => void; // 측정 빌드에서만(측정 메뉴)
  children: ReactNode; // 오른쪽 묶음
};

export function YearHeader({ year, a11yLabel, width, actionsW, onPressYear, children }: Props) {
  const [w, setW] = useState(0);
  const groupLeft = width - (tabHeader.paddingHorizontal - RIGHT_PULL) - actionsW;
  const shift = Math.min(0, groupLeft - GAP - (width + w) / 2);
  return (
    <View style={[st.row, tabHeader, { minHeight: engravedHeight(YEAR_SIZE) + tabHeader.paddingTop + tabHeader.paddingBottom }]}>
      <View pointerEvents="box-none" style={[st.center, { transform: [{ translateX: shift }] }]}>
        {/* 누를 수 있을 때만 Pressable(아니면 화면 읽기가 빈 단추와 제목을 따로 읽는다) */}
        {onPressYear ? (
          <Pressable onPress={onPressYear} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="button" accessibilityLabel={a11yLabel}>
            <EngravedYear label={String(year)} size={YEAR_SIZE} a11yLabel={a11yLabel} />
          </Pressable>
        ) : (
          <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            <EngravedYear label={String(year)} size={YEAR_SIZE} a11yLabel={a11yLabel} header />
          </View>
        )}
      </View>
      <View style={[st.actions, { marginRight: -RIGHT_PULL }]}>{children}</View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  center: { position: 'absolute', left: 0, right: 0, top: tabHeader.paddingTop, bottom: tabHeader.paddingBottom, alignItems: 'center', justifyContent: 'center' }, // 아이콘과 같은 세로 가운데(머리줄 위아래 여백 안)
  actions: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  icon: { width: HEADER_ICON, height: 44, alignItems: 'center', justifyContent: 'center' },
});

export const headerIconStyle = st.icon;
