// 드래그 중인 책. 스크롤 컨테이너 밖 최상단에 그려서 잘리지 않게 한다.
// 들린 느낌: 살짝 확대 + 접촉 그림자 없이 넓고 흐린 그림자.
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { SoftShadow } from './SoftShadow';

import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { CAMERA } from '@/domain/geometry';
import { BoxBookView } from '@/ui/box/BoxShelf';
import { colors, shadow } from '@/ui/theme';

export { frameBBox };

type Props = {
  book: Book;
  frame: BookFrame;
  scale: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
  lift: SharedValue<number>;
};

const PAD = 40;

export function DragOverlay({ book, frame, scale: s, x, y, lift }: Props) {
  const box = frameBBox(frame);
  const liftPath = frame.poly.map((p) => ({ x: (p.x - box.minX + shadow.lifted.dx) * s + PAD, y: (p.y - box.minY + shadow.lifted.dy) * s + PAD }));
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: 1 + (shadow.lifted.scale - 1) * lift.value }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: lift.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { width: box.width * s, height: box.height * s }, style]}>
      <Animated.View style={[{ position: 'absolute', left: -PAD, top: -PAD }, shadowStyle]}>
        <Svg width={box.width * s + PAD * 2 + shadow.lifted.dx * s} height={box.height * s + PAD * 2 + shadow.lifted.dy * s}>
          <SoftShadow points={liftPath} fill={colors.shadow} opacity={shadow.lifted.opacity} blur={8 * s} />
        </Svg>
      </Animated.View>
      <BoxBookView frame={frame} book={book} scale={s} cam={CAMERA} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0 },
});
