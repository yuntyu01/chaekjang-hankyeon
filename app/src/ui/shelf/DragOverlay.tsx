// 드래그 중인 책. 스크롤 컨테이너 밖 최상단에 그려서 잘리지 않게 한다.
// 들린 느낌: 살짝 확대 + 접촉 그림자 없이 넓고 흐린 그림자.
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

import type { BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { BookRenderer } from '@/ui/book/BookRenderer';
import { colors, shadow } from '@/ui/theme';

export function frameBBox(f: BookFrame) {
  const xs = f.poly.map((p) => p.x);
  const ys = f.poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

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
  const pts = frame.poly
    .map((p) => `${(p.x - box.minX + shadow.lifted.dx) * s + PAD},${(p.y - box.minY + shadow.lifted.dy) * s + PAD}`)
    .join(' ');
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
          {[26, 19, 13, 8, 4].map((w, i) => (
            <Polygon key={i} points={pts} fill="none" stroke={colors.shadow} strokeOpacity={shadow.lifted.opacity / 5} strokeWidth={w * s} strokeLinejoin="round" />
          ))}
          <Polygon points={pts} fill={colors.shadow} fillOpacity={shadow.lifted.opacity * 0.8} />
        </Svg>
      </Animated.View>
      <View
        style={{
          position: 'absolute',
          left: (frame.left - box.minX) * s,
          top: (frame.top - box.minY) * s,
          width: frame.width * s,
          height: frame.height * s,
          transformOrigin: frame.origin,
          transform: [{ rotate: `${frame.rotate}deg` }],
        }}>
        <BookRenderer book={book} pose={frame.pose} scale={s} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0 },
});
