// 캔버스 하나에 책 한 권(선반 밖: 서랍·상세·장정 편집·통계). 선반과 같은 BookNode로 그린다.
// 카메라는 기본 보기(3°) 고정: 홈의 보기 각과 상관없이 늘 같은 모습(홈 카메라 값을 복사해 두지 않는다).
// from을 주면 그 자세에서 쉬는 자세로 이어서 움직인다.
import { Canvas, type CanvasRef } from '@shopify/react-native-skia';
import { useEffect, useMemo, type Ref } from 'react';
import { View } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { fromPlaced, type Book3 } from '@/domain/book3';
import { BASE_CAM } from '@/domain/camera';
import { frameBBox, standaloneFrame, type BookFrame } from '@/domain/shelf-scene';
import { bookAt, holdTrack, planTransition } from '@/domain/transition';
import type { Book, Pose } from '@/domain/types';

import { RIBBON_OUT, useBookShared } from './art';
import { BookNode } from './BookNode';

export const BOOK_PAD = 4; // 캔버스 여백(DU): 갈피·가장자리가 잘리지 않게

// frame의 투영 외곽 왼쪽 위(minX, minY)가 캔버스 (BOOK_PAD, BOOK_PAD + 갈피) 에 오도록 그린다
export function FrameBook({ book, frame, scale: s, from, canvasRef }: { book: Book; frame: BookFrame; scale: number; from?: Book3 | null; canvasRef?: Ref<CanvasRef> }) {
  const bb = frameBBox(frame, BASE_CAM);
  const rest = useMemo(() => fromPlaced(frame.box), [frame]);
  const top = BOOK_PAD + ((book.quotes ?? 0) > 0 ? RIBBON_OUT : 0);
  const px = useMemo(() => ({ s, tx: (BOOK_PAD - bb.minX) * s, ty: (top - bb.minY) * s }), [s, bb.minX, bb.minY, top]);
  const track = useMemo(() => {
    if (!from) return holdTrack(rest);
    return planTransition([from], [rest]).tracks[0];
  }, [from, rest]);
  const t = useSharedValue(from ? 0 : 1);
  useEffect(() => {
    if (from) t.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [from, t]);
  const state = useDerivedValue(() => bookAt(track, t.value));
  const shared = useBookShared();
  const camSV = useSharedValue({ ...BASE_CAM });
  return (
    <View style={{ width: (bb.width + BOOK_PAD * 2) * s, height: (bb.height + top + BOOK_PAD) * s }} pointerEvents="none">
      <Canvas ref={canvasRef} style={{ flex: 1 }}>
        <BookNode book={book} dims={rest.dims} state={state} cam={camSV} px={px} shared={shared} />
      </Canvas>
    </View>
  );
}

// 선반 밖의 책 한 권(서랍·상세). 뷰 크기 = 투영 외곽(+여백).
export function StandaloneBook({ book, pose, scale, canvasRef }: { book: Book; pose: Pose; scale: number; canvasRef?: Ref<CanvasRef> }) {
  const frame = useMemo(() => standaloneFrame(book, pose), [book, pose]);
  return <FrameBook book={book} frame={frame} scale={scale} canvasRef={canvasRef} />;
}
