// 넘김 점(갈피 상세·갈피 보드): 지금 칸은 크고 진하게, 나머지는 같은 색을 옅게. 색은 그 책의 갈피 색이다(2026-11-05 사용자).
import { StyleSheet, View } from 'react-native';

import { dotWindow } from '@/domain/bookmark-board';

export function PageDots({ count, index, color, max = 7, gap = 8 }: { count: number; index: number; color: string; max?: number; gap?: number }) {
  const { from, to } = dotWindow(count, index, max);
  return (
    <View style={[st.row, { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: to - from }, (_, i) => (
        <View key={from + i} style={[st.dot, { backgroundColor: color }, from + i === index && st.on]} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.32 },
  on: { width: 10, height: 10, borderRadius: 5, opacity: 1 },
});
