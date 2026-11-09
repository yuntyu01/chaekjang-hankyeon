// 책 공유 카드(2026-11-10 사용자 시안: 질감 있는 흰 벽 · 왼쪽 위 창빛 · 나무 선반 위 책 한 권 · 제목·저자·한 줄 감상·별점 · '책장 한켠').
// 그림은 share-scene 한 곳에서 그린다(시안 바탕 + 책 그림자 + 책 오버레이 + 글자). 미리보기는 그 그림을 기록해 캔버스에 띄우고,
// 공유 이미지는 같은 그림을 정해진 폭으로 따로 그린다(useShareScene renderShareCardBase64). 재료가 모이기 전에는 벽색 빈 카드
import { Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { View } from 'react-native';

import { DEFAULT_PARTS, type BookShareData, type ShareParts } from './book-share';
import { drawShareScene, layoutShareScene, SCENE_H, SCENE_W } from './share-scene';
import { shareInputOf, type ShareScene } from './useShareScene';

const WALL = '#F3F2F1'; // 시안 벽 평균색(재료가 오기 전 빈 카드)

// scene: 화면에서 한 번 불러온 재료(미리보기·내보내기가 함께 쓴다)
export function BookShareCard({ data, parts = DEFAULT_PARTS, width, scene }: { data: BookShareData; parts?: ShareParts; width: number; scene: ShareScene }) {
  const input = useMemo(() => shareInputOf(data, parts), [data, parts]);
  const drawn = useMemo(() => {
    const A = scene.assets;
    if (!A) return null;
    const L = layoutShareScene(Skia, input, A.fonts);
    const height = (L.height * width) / SCENE_W;
    return { height, picture: createPicture((c) => drawShareScene(Skia, c, width, L, A, input), Skia.XYWHRect(0, 0, width, height)) };
  }, [scene.assets, input, width]);
  const height = drawn?.height ?? (width * SCENE_H) / SCENE_W;
  return (
    <View style={{ width, height, backgroundColor: WALL }} accessible accessibilityLabel={`${data.title} 공유 카드`}>
      {drawn ? (
        <Canvas style={{ width, height }} pointerEvents="none">
          <Picture picture={drawn.picture} />
        </Canvas>
      ) : null}
    </View>
  );
}
