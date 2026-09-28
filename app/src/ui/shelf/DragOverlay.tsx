// 드래그 중인 책. 스크롤 컨테이너 밖 최상단에 그려서 잘리지 않게 한다.
// 들린 느낌: 살짝 확대 + 접촉 그림자 없이 넓고 흐린 그림자.
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { SoftShadow } from './SoftShadow';

import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import type { Book3 } from '@/domain/book3';
import { RIBBON_OUT } from '@/ui/book3d/art';
import { BOOK_PAD, FrameBook } from '@/ui/book3d/StandaloneBook';
import { colors, shadow } from '@/ui/theme';

export { frameBBox };

type Props = {
  book: Book;
  frame: BookFrame;
  from?: Book3 | null; // 끌기 시작한 순간의 자세(움직이는 도중이었으면 그 모습에서 이어진다)
  scale: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
  lift: SharedValue<number>;
};

const PAD = 40;

export function DragOverlay({ book, frame, from, scale: s, x, y, lift }: Props) {
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
      <View style={{ position: 'absolute', left: -BOOK_PAD * s, top: -(BOOK_PAD + ((book.quotes ?? 0) > 0 ? RIBBON_OUT : 0)) * s }}>
        <FrameBook book={book} frame={frame} scale={s} from={from} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0 },
});
