// 공개 프로필 동그라미: 프로필 사진 기능이 없어서 닉네임 첫 글자를 차분한 색 동그라미에 쓴다(사진을 지어내지 않는다).
// 색은 사용자 번호로 고정(같은 사람은 늘 같은 색). 책등 색 계열의 낮은 채도
import { Text, View } from 'react-native';

import { colors, fonts } from '@/ui/screenTheme';

const PALETTE = ['#7F95A8', '#8E9A78', '#B98270', '#6E879E', '#A0906F', '#9A7F8F', '#6F8F86', '#A8826A'];

export function Avatar({ name, id, size = 40 }: { name: string; id: number; size?: number }) {
  const bg = PALETTE[Math.abs(id) % PALETTE.length];
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ fontFamily: fonts.uiBold, fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5), color: colors.onAccent, includeFontPadding: false }}>{initial}</Text>
    </View>
  );
}
