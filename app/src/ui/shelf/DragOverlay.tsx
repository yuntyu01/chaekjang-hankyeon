// 끄는 책(놓을 자리가 없을 때만: 선반 밖·자리 없음). 스크롤 컨테이너 밖 최상단에 그려서 잘리지 않게 한다.
// 확대·들린 그림자 같은 연출 없이 잡은 자세 그대로 손가락을 따라간다(잡은 지점 유지).
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import type { Book3 } from '@/domain/book3';
import { RIBBON_OUT } from '@/ui/book3d/art';
import { BOOK_PAD, FrameBook } from '@/ui/book3d/StandaloneBook';

export { frameBBox };

type Props = {
  book: Book;
  frame: BookFrame;
  from?: Book3 | null; // 끌기 시작한 순간의 자세(움직이는 도중이었으면 그 모습에서 이어진다)
  scale: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
};

export function DragOverlay({ book, frame, from, scale: s, x, y }: Props) {
  const box = frameBBox(frame);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.root, { width: box.width * s, height: box.height * s }, style]}>
      <View style={{ position: 'absolute', left: -BOOK_PAD * s, top: -(BOOK_PAD + ((book.quotes ?? 0) > 0 ? RIBBON_OUT : 0)) * s }}>
        <FrameBook book={book} frame={frame} scale={s} from={from} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0 },
});
