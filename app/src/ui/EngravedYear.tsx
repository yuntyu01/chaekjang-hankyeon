// 벽에 새긴 해 숫자(2026-11-09 홈 시안: 머리에 큰 '2026'만). 홈 머리글·지난 책장 머리글·모아 보기 이름표가 같이 쓴다.
// 새김 = 벽보다 진한 회색 글자 + 안쪽 그늘: 위에서 오는 빛이라 홈의 위 가장자리는 어둡고(벽이 가린다) 아래 가장자리는 밝다.
// 순백 벽에서는 바깥에 흰 빛줄을 그려도 보이지 않으므로 글자 안쪽 그늘(Skia inner shadow)로만 깊이를 낸다.
import { Canvas, Glyphs, Shadow, Skia, useTypeface } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';

const BOLD = require('../../assets/fonts/Pretendard-Bold.otf');

// 시안 글자에서 잰 색(941px 시안, 벽 #F2F0F1 위): 글자 속 평균 #B9B3B1(벽보다 61 어둡게), 가장 어두운 위 가장자리 벽보다 86 어둡게, 아래 가장자리 밝음.
// 우리 벽은 순백이라 벽과의 차이를 시안과 같게 맞췄다(2026-11-09 에뮬 비교: 처음 값은 시안보다 진했다)
const FILL = '#C0BAB6';
const DARK = 'rgba(78,62,52,0.48)';
// 자간(글자 크기 배수): Pretendard 숫자는 시안의 둥근 숫자보다 8% 넓어 조금 좁힌다(같은 높이 23dp에서 폭 약 76dp, 시안 75dp)
const TRACK = -0.05;
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
    if (!tf) return { w: Math.ceil(fs * 0.57 * label.length) + 8, h, font: null, y: 0, glyphs: [] };
    const font = Skia.Font(tf, fs);
    const r = font.measureText(label);
    const ids = font.getGlyphIDs(label);
    const ws = font.getGlyphWidths(ids);
    const track = TRACK * fs;
    const pad = 4;
    // 글자를 한 자씩 자간을 좁혀 놓고, 글자 윤곽(숫자는 위아래가 같은 높이)을 상자 가운데에 둔다
    let x = pad - r.x;
    const glyphs = ids.map((id, i) => {
      const g = { id, pos: { x, y: 0 } };
      x += ws[i] + track;
      return g;
    });
    return { w: Math.ceil(r.width + track * (ids.length - 1)) + 2 * pad, h, font, y: (h - r.height) / 2 - r.y, glyphs };
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
          <Glyphs x={0} y={box.y} glyphs={box.glyphs} font={box.font} color={FILL}>
            <Shadow dx={0} dy={1.6 * k} blur={1.4 * k} color={DARK} inner />
            <Shadow dx={0} dy={-1.1 * k} blur={1 * k} color={LIGHT} inner />
          </Glyphs>
        </Canvas>
      ) : null}
    </View>
  );
}
