// 벽에 새긴 해 숫자(2026-11-09 홈 시안: 머리에 큰 '2026'만). 홈 머리글·지난 책장 머리글·모아 보기 이름표가 같이 쓴다.
// 새김 = 벽보다 진한 회색 글자 + 안쪽 그늘: 위에서 오는 빛이라 홈의 위 가장자리는 어둡고(벽이 가린다) 아래 가장자리는 밝다.
// 순백 벽에서는 바깥에 흰 빛줄을 그려도 보이지 않으므로 글자 안쪽 그늘(Skia inner shadow)로만 깊이를 낸다.
import { Canvas, Shadow, Skia, Text, useTypeface } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';

const BOLD = require('../../assets/fonts/Pretendard-Bold.otf');

// 시안 글자에서 잰 색(941px 시안, 벽 #F2F0F1 위): 글자 속 #B0A9A5 안팎, 위 가장자리 #8D847F, 아래 가장자리 밝음
const FILL = '#B4AEAA';
const DARK = 'rgba(78,62,52,0.55)';
const LIGHT = 'rgba(255,255,255,0.75)';
const TEXT_MAX = 1.3; // 시스템 글자 확대는 머리글처럼 1.3배까지(머리글 높이가 선반 배치에 묶여 있다)

type Props = { label: string; size: number; style?: StyleProp<ViewStyle>; a11yLabel?: string; header?: boolean };

const scaled = (size: number) => size * Math.min(TEXT_MAX, PixelRatio.getFontScale());
// 글자 상자 높이(머리줄 높이를 잡을 때)
export const engravedHeight = (size: number) => Math.ceil(scaled(size) * 1.3);

export function EngravedYear({ label, size, style, a11yLabel, header }: Props) {
  const tf = useTypeface(BOLD);
  const fs = scaled(size);
  const k = fs / 34;
  const box = useMemo(() => {
    const h = engravedHeight(size);
    if (!tf) return { w: Math.ceil(fs * 0.62 * label.length) + 8, h, font: null, x: 0, y: 0 };
    const font = Skia.Font(tf, fs);
    const r = font.measureText(label);
    const pad = 4;
    // 글자 윤곽(숫자는 위아래가 같은 높이)을 상자 가운데에 둔다
    return { w: Math.ceil(r.width) + 2 * pad, h, font, x: pad - r.x, y: (h - r.height) / 2 - r.y };
  }, [tf, fs, size, label]);
  return (
    <View
      style={[{ width: box.w, height: box.h }, style]}
      accessible
      accessibilityRole={header ? 'header' : 'text'}
      accessibilityLabel={a11yLabel ?? label}
      pointerEvents="none">
      {box.font ? (
        <Canvas style={{ width: box.w, height: box.h }}>
          <Text x={box.x} y={box.y} text={label} font={box.font} color={FILL}>
            <Shadow dx={0} dy={1.6 * k} blur={1.4 * k} color={DARK} inner />
            <Shadow dx={0} dy={-1.1 * k} blur={1 * k} color={LIGHT} inner />
          </Text>
        </Canvas>
      ) : null}
    </View>
  );
}
