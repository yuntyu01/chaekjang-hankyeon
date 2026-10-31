// 캔버스 하나에 책 한 권(선반 밖: 서랍·상세·장정 편집·통계). 선반과 같은 BookNode로 그린다.
// 카메라는 기본 보기 고정: 홈의 보기 각과 상관없이 늘 같은 모습(홈 카메라 값을 복사해 두지 않는다).
// 원근 카메라의 눈은 그 책 가운데에 둔다(선반 가운데 책처럼 양옆이 똑같이 보이게).
// from을 주면 그 자세에서 쉬는 자세로 이어서 움직인다.
import { Canvas, type CanvasRef } from '@shopify/react-native-skia';
import { useEffect, useMemo, type Ref } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { fromPlaced, rot, toWorld, type Book3 } from '@/domain/book3';
import { BASE_CAM, camCenteredAt, type Cam } from '@/domain/camera';
import { frameBBox, standaloneFrame, type BookFrame } from '@/domain/shelf-scene';
import { bookAt, holdTrack, planTransition } from '@/domain/transition';
import type { Book, Pose } from '@/domain/types';

import { useBookShared } from './art';
import { hasRibbon, ribbonDesign } from '@/domain/ribbon-design';
import { BookNode } from './BookNode';

export const BOOK_PAD = 4; // 캔버스 여백(DU): 갈피·가장자리가 잘리지 않게

// 선반 밖 표지(상세·목록·통계): 갈피 탭은 선반에서 갈피 수를 보여 주는 표시라 빼고 그린다(ribbonVisible이 켜져 있어도)
export function noRibbon(book: Book): Book {
  return { ...book, quotes: 0, art: { ...book.art, ribbonVisible: false } };
}

// 한 권만 그리는 카메라: 기본 보기, 눈은 상자 가운데
export function frameCam(frame: BookFrame): Cam {
  return camCenteredAt(BASE_CAM, frame.box.x + frame.box.size.w / 2);
}

// frame의 투영 외곽 왼쪽 위(minX, minY)가 캔버스 (BOOK_PAD, BOOK_PAD + 갈피) 에 오도록 그린다
export function FrameBook({ book, frame, scale: s, from, canvasRef }: { book: Book; frame: BookFrame; scale: number; from?: Book3 | null; canvasRef?: Ref<CanvasRef> }) {
  const cam = useMemo(() => frameCam(frame), [frame]);
  const bb = frameBBox(frame, cam);
  const rest = useMemo(() => fromPlaced(frame.box), [frame]);
  const ribbon = ribbonDesign(book);
  const top = BOOK_PAD + (hasRibbon(book) ? ribbon.out - ribbon.y : 0);
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
  const camSV = useSharedValue(cam);
  useEffect(() => {
    camSV.value = cam;
  }, [cam, camSV]);
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

// 손가락으로 좌우로 돌려 보는 책 한 권(장정 편집 미리보기). 표지 전시 자세에서 세로축으로만 돈다(spin).
// 책 가운데를 축으로 돌리고, 어느 각도에서도 잘리지 않게 캔버스를 넉넉히 잡는다. 놓으면 그 각도에 머문다.
const SPIN_MIN = -70;
const SPIN_MAX = 95;
// frontWidth를 주면 정면 폭이 그 크기(dp)가 되게 배율을 잡는다(책 상세)
export function RotatableBook({ book, scale, frontWidth, initialSpin = 30, label, shadow }: { book: Book; scale?: number; frontWidth?: number; initialSpin?: number; label?: string; shadow?: boolean }) {
  const frame = useMemo(() => standaloneFrame(book, 'front'), [book]);
  const cam = useMemo(() => frameCam(frame), [frame]);
  const bb = frameBBox(frame, cam);
  const s = frontWidth ? frontWidth / bb.width : (scale ?? 1);
  const rest = useMemo(() => fromPlaced(frame.box), [frame]);
  const w = bb.width * 1.5 + BOOK_PAD * 2;
  const h = bb.height * 1.14 + BOOK_PAD * 2;
  const px = useMemo(() => ({ s, tx: (w / 2 - (bb.minX + bb.width / 2)) * s, ty: (h / 2 - (bb.minY + bb.height / 2)) * s }), [s, w, h, bb.minX, bb.minY, bb.width, bb.height]);
  const spin = useSharedValue(initialSpin);
  const state = useDerivedValue<Book3>(() => {
    const c = { x: rest.dims.T / 2, y: rest.dims.H / 2, z: rest.dims.W / 2 };
    const center = toWorld(rest, c);
    const r = rot(rest.roll, rest.yaw, c, spin.value, 0);
    return { ...rest, spin: spin.value, t: { x: center.x - r.x, y: center.y - r.y, z: center.z - r.z } };
  });
  const shared = useBookShared();
  const camSV = useSharedValue(cam);
  useEffect(() => {
    camSV.value = cam;
  }, [cam, camSV]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-14, 14])
        .onChange((e) => {
          spin.value = Math.max(SPIN_MIN, Math.min(SPIN_MAX, spin.value + e.changeX * 0.45));
        }),
    [spin],
  );
  return (
    <GestureDetector gesture={pan}>
      <View style={{ width: w * s, height: h * s }} accessible accessibilityLabel={label ?? `${book.title} 장정 미리보기, 좌우로 끌어 돌려 볼 수 있어요`}>
        {/* 바닥 그림자: 책 아래 끝에 넓고 옅게 번지는 그림자(시안의 놓인 책) */}
        {shadow ? <View pointerEvents="none" style={{ position: 'absolute', left: (w / 2 - bb.width * 0.45) * s, width: bb.width * 0.9 * s, top: (h / 2 + bb.height / 2) * s - 10, height: 12, borderRadius: 999, backgroundColor: 'rgba(84,60,40,0.10)', boxShadow: [{ offsetX: 6, offsetY: 2, blurRadius: 16, color: 'rgba(84,60,40,0.26)' }] }} /> : null}
        <Canvas style={{ flex: 1 }} pointerEvents="none">
          <BookNode book={book} dims={rest.dims} state={state} cam={camSV} px={px} shared={shared} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}
