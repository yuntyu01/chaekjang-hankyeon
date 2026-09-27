// 선반 밖에서 그리는 책 한 권(드래그 중인 책·서랍·상세). 선반 줄과 같은 면 그리기(FaceShape·computeFace)와
// 같은 앞면(BookRenderer box)을 쓴다. 상자는 움직이지 않으므로 모양 값은 한 번만 계산된다.
import { Canvas, useImage } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { BRUSH_DETAIL } from '@/domain/body-art.generated';
import { silhouette, type Camera, type Placed } from '@/domain/box';
import { CAMERA } from '@/domain/geometry';
import { frameBBox, standaloneFrame, type BookFrame, type Point } from '@/domain/shelf-scene';
import type { Book, Pose } from '@/domain/types';
import { BOX_HEAD_BOW } from '@/ui/book/BookBody';
import { BookRenderer } from '@/ui/book/BookRenderer';

import { FaceShape } from './BookFaces';
import { computeFace, faceAt, kindsOf, materialOf, seedOf, type Affine, type FaceKind } from './face-geometry';

export const BOX_PAD = 3;

const toneOf = (book: Book, pose: Pose) => (pose === 'front' ? book.cover?.edge : undefined) ?? book.body?.face ?? book.themeColor;

function StillFace({ box, book, kind, cam, px }: { box: Placed; book: Book; kind: FaceKind; cam: Camera; px: Affine }) {
  const grain = useImage(BRUSH_DETAIL);
  const mat = materialOf(box.pose, kind);
  const boards = mat.mat === 'pages' ? (mat.boards ?? null) : null;
  const bow = box.pose === 'spine' ? BOX_HEAD_BOW * px.s : 0;
  const seed = seedOf(book.id, kind);
  const geom = useDerivedValue(() => computeFace(faceAt(cam, box, kind), kind, px, bow, boards, seed));
  return <FaceShape geom={geom} kind={kind} pose={box.pose} tone={toneOf(book, box.pose)} s={px.s} grain={grain} />;
}

// origin: 부모 뷰의 (0,0)이 장면 좌표 어디인지(없으면 외곽의 왼쪽 위)
export const BoxBookView = memo(function BoxBookView({ frame, book, scale: s, cam, origin }: { frame: BookFrame; book: Book; scale: number; cam: Camera; origin?: Point }) {
  const box = frame.box!;
  const poly = silhouette(cam, box);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs) - BOX_PAD;
  const minY = Math.min(...ys) - BOX_PAD;
  const w = Math.max(...xs) - minX + BOX_PAD;
  const h = Math.max(...ys) - minY + BOX_PAD;
  const bb = frameBBox(frame);
  const base = origin ?? { x: bb.minX, y: bb.minY };
  const px: Affine = { s, tx: -minX * s, ty: -minY * s };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: (minX - base.x) * s, top: (minY - base.y) * s, width: w * s, height: h * s }}>
      <Canvas style={StyleSheet.absoluteFill}>
        {kindsOf(cam, [box]).map((k) => (
          <StillFace key={k} box={box} book={book} kind={k} cam={cam} px={px} />
        ))}
      </Canvas>
      <View
        style={{
          position: 'absolute',
          left: (frame.left - minX) * s,
          top: (frame.top - minY) * s,
          width: frame.width * s,
          height: frame.height * s,
          transformOrigin: frame.rotate > 0 ? 'right bottom' : 'left bottom',
          transform: [{ rotate: `${frame.rotate}deg` }],
        }}>
        <BookRenderer book={book} pose={frame.pose} scale={s} box />
      </View>
    </View>
  );
});

// 그리는 순서: 뒤(깊이 큰) 상자부터, 쌓기는 아래부터, 같은 줄은 왼쪽부터
export function paintOrder<T extends { box?: Placed; left: number }>(frames: T[]) {
  return [...frames].sort((a, b) => (b.box?.z ?? 0) - (a.box?.z ?? 0) || (a.box?.y ?? 0) - (b.box?.y ?? 0) || (a.box?.x ?? a.left) - (b.box?.x ?? b.left));
}

// 선반 밖의 책 한 권(서랍·상세): 뷰 크기 = 투영 외곽.
export function StandaloneBook({ book, pose, scale: s }: { book: Book; pose: Pose; scale: number }) {
  const frame = useMemo(() => standaloneFrame(book, pose), [book, pose]);
  const bb = frameBBox(frame);
  return (
    <View style={{ width: bb.width * s, height: bb.height * s }}>
      <BoxBookView frame={frame} book={book} scale={s} cam={CAMERA} />
    </View>
  );
}
