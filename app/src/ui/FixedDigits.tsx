// 1초마다 바뀌는 시간 숫자를 글자마다 같은 폭 칸에 그린다(2026-11-11).
// UI 글꼴(G마켓 산스)은 숫자 폭이 제각각이고(‘1’은 0.45em, 나머지 0.6~0.7em) tnum이 없어, 그냥 쓰면 ‘1’이 들고 날 때마다 시간이 좌우로 흔들린다.
// 숫자 칸은 글꼴에서 가장 넓은 숫자(Bold ‘0’ 0.704em)에 맞춘 0.70em, ‘:’ 칸은 0.30em. 글자는 칸 가운데.
import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export const DIGIT_EM = 0.7;
export const SEP_EM = 0.3;

// 칸 폭의 합(dp): 글자 크기 확대(fontScale)까지 넣은 값. 시간 글자 자리를 미리 잡을 때 쓴다
export function fixedDigitsWidth(text: string, fontSize: number, fontScale = 1) {
  let em = 0;
  for (const ch of text) em += /\d/.test(ch) ? DIGIT_EM : SEP_EM;
  return em * fontSize * fontScale;
}

export function FixedDigits({ text, style, boxStyle, accessibilityLabel }: { text: string; style: StyleProp<TextStyle>; boxStyle?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const { fontScale } = useWindowDimensions();
  const size = (StyleSheet.flatten(style)?.fontSize ?? 16) * fontScale;
  return (
    <View style={[st.row, boxStyle]} accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? text}>
      {[...text].map((ch, i) => (
        <Text key={i} style={[style, { width: size * (/\d/.test(ch) ? DIGIT_EM : SEP_EM), textAlign: 'center' }]} numberOfLines={1} importantForAccessibility="no">
          {ch}
        </Text>
      ))}
    </View>
  );
}

const st = StyleSheet.create({ row: { flexDirection: 'row' } });
