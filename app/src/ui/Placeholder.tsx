import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { colors, fonts } from '@/ui/theme';

// 기록·마이 탭 자리. 다음 Phase에서 채운다.
export function Placeholder({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 18 }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{ko.soon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 },
  title: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 42, color: colors.ink },
  sub: { fontSize: 14, color: colors.inkSoft, marginTop: 6 },
});
