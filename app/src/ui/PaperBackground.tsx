// 종이 배경(실제 자산 assets/bookshelf/paper-background.png, 1254×1254 RGB).
// 화면 고정(스크롤과 무관). 이음새 없이 반복되는 자산이라(예전 measure-shelf.py 이음새 검사 통과) 기기 픽셀 1:1 크기로 반복한다.
import { memo } from 'react';
import { Image, PixelRatio, StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors } from '@/ui/theme';

const PAPER = require('../../assets/bookshelf/paper-background.png');
const PAPER_PX = 1254;

export const PaperBackground = memo(function PaperBackground() {
  const { width, height } = useWindowDimensions();
  const tile = PAPER_PX / PixelRatio.get();
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} pointerEvents="none">
      {Array.from({ length: rows * cols }, (_, i) => (
        <Image
          key={i}
          source={PAPER}
          style={{ position: 'absolute', left: (i % cols) * tile, top: Math.floor(i / cols) * tile, width: tile, height: tile, opacity: 0.20 }}
        />
      ))}
    </View>
  );
});
