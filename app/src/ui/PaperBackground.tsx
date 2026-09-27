// 종이 배경(실제 자산 assets/bookshelf/paper-background.png, 1254×1254 RGB).
// 화면 고정(스크롤과 무관). scripts/measure-shelf.py 이음새 검사를 통과해(PAPER_SEAMLESS) 기기 픽셀 1:1 크기로 반복한다.
// 검사에 실패한 자산이면 비율을 유지한 채 화면을 덮는다(cover).
import { memo } from 'react';
import { Image, PixelRatio, StyleSheet, useWindowDimensions, View } from 'react-native';

import { PAPER_SEAMLESS } from '@/domain/shelf-asset.generated';
import { colors } from '@/ui/theme';

const PAPER = require('../../assets/bookshelf/paper-background.png');
const PAPER_PX = 1254;

export const PaperBackground = memo(function PaperBackground() {
  const { width, height } = useWindowDimensions();
  if (!PAPER_SEAMLESS) {
    return <Image source={PAPER} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  }
  const tile = PAPER_PX / PixelRatio.get();
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} pointerEvents="none">
      {Array.from({ length: rows * cols }, (_, i) => (
        <Image
          key={i}
          source={PAPER}
          style={{ position: 'absolute', left: (i % cols) * tile, top: Math.floor(i / cols) * tile, width: tile, height: tile, opacity: 0.38 }}
        />
      ))}
    </View>
  );
});
