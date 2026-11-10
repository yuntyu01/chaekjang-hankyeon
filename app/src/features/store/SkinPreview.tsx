// 스토어 미리보기(2026-11-10 사용자 '실제처럼 선반이랑 구성, 예시는 선반 위에 책 1~2개만'): 홈 책장과 같은 그림(빛·재질·카메라)으로
// 선반 한 칸에 예시 책 두 권을 세운다. 스킨은 고를 때마다 그 자리에서 바뀌므로(ui/skin-live) 스킨 열쇠가 바뀌면 다시 만든다(key는 부르는 쪽).
// 책·선반 id는 홈 책장과 겹치지 않게 앞머리를 붙인다(그림 보관·움직임이 id 전역이다, 지난 책장 year-shelf와 같은 까닭).
import { useLayoutEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { camAt } from '@/domain/camera';
import { sortedShelves } from '@/domain/layout-engine';
import { MOCKUP_BOOKS } from '@/domain/mockup-sample';
import type { Book, ShelfLayout } from '@/domain/types';
import { FRAME_ON } from '@/scene-config/skin';
import { useSceneMotions, useShelfScenes } from '@/features/home/useShelfSceneState';
import { useViewStore } from '@/store/view-store';
import { useShelfShared } from '@/ui/book3d/art';
import { computeRows, makeMetrics } from '@/ui/shelf/metrics';
import { flushApply } from '@/ui/shelf/planner';
import type { SceneGeo } from '@/ui/shelf/scene';
import { HeaderWall, SHELF_CAST_EXTENT, ShelfScene, type SceneRowProps } from '@/ui/shelf/ShelfScene';

const P = 'store~';
const SHELF = `${P}shelf`;
// 그림 표지 '느린 계절'(밤 풍경)과 그 왼쪽에 선 린넨 책등 '데미안'(갈피 두 장). 자리는 판 가운데쯤(판 길이 366DU)
const PICKS: { id: string; pos: number; pose: 'spine' | 'front' }[] = [
  { id: 'b02', pos: 112, pose: 'spine' },
  { id: 'b04', pos: 142, pose: 'front' },
];
const BOOKS: Record<string, Book> = Object.fromEntries(
  PICKS.map(({ id }) => {
    const b = MOCKUP_BOOKS.find((x) => x.id === id)!;
    return [P + id, { ...b, id: P + id, seedId: id, art: { ...b.art, ribbonVisible: !!b.art.ribbon } }];
  }),
);
const LAYOUT: ShelfLayout = {
  version: 2,
  drawer: [],
  shelves: [{ id: SHELF, order: 0 }],
  placements: PICKS.map((p, order) => ({ bookId: P + p.id, shelfId: SHELF, order, pose: p.pose, tilt: 0, pos: p.pos })),
};
const NONE: string[] = [];
const NO_ROWS: never[] = [];
const NO_LEAVING: { id: string; from: string }[] = [];
const NO_A11Y = () => '';
const NO_OP = () => undefined;
// 판 위 벽(머리 쪽) 높이: 구멍 위 끝(천장)이 보이게
const TOP = 26;
// 판 아래로 보이는 몫(DU): 움푹 파인 책장은 구멍 아래 테까지, 판만 달린 책장은 판 그림자가 조금 보이게(그림자 끝까지 두면 빈 벽이 너무 넓다)
const BOTTOM_DU = FRAME_ON ? SHELF_CAST_EXTENT * 0.5 : 24;

export function skinPreviewHeight(width: number) {
  const m = makeMetrics(width);
  const row = computeRows(LAYOUT, m.scale)[0];
  return TOP + row.top + row.height + BOTTOM_DU * m.scale;
}

export function SkinPreview({ width }: { width: number }) {
  const m = useMemo(() => makeMetrics(width), [width]);
  const shared = useShelfShared();
  const view = useViewStore();
  const pitch = view.pitch;
  const cam = useDerivedValue(() => camAt(pitch));
  const shelves = useMemo(() => sortedShelves(LAYOUT), []);
  const frames = useShelfScenes(LAYOUT, BOOKS, true);
  const rows = useMemo(() => computeRows(LAYOUT, m.scale), [m.scale]);
  const motions = useSceneMotions(useMemo(() => shelves.map((s) => s.id), [shelves]), frames);
  const geo = useSharedValue<SceneGeo>({ rows: rows.map((r) => ({ shelfId: r.shelfId, baseline: r.baseline, dy: 0, space: r.space })), s: m.scale, originX: m.originX });
  // 줄이 짠 경로를 UI로(홈·지난 책장과 같은 묶음 적용)
  useLayoutEffect(() => {
    flushApply();
  });
  const sceneRows: SceneRowProps[] = useMemo(
    () => rows.map((row) => ({ shelfId: row.shelfId, row, frames: frames.get(row.shelfId) ?? [], dragId: null, glowId: null, hint: null })),
    [rows, frames],
  );
  const row = rows[0];
  const h = row ? row.top + row.height + BOTTOM_DU * m.scale : 0;
  return (
    <View style={{ width, height: TOP + h }} pointerEvents="none">
      <View style={{ height: TOP }}>
        <HeaderWall rows={sceneRows} motions={motions} books={BOOKS} m={m} width={width} height={TOP} cam={cam} />
      </View>
      <View style={{ height: h }} collapsable={false}>
        <ShelfScene
          rows={sceneRows}
          lockedRows={NO_ROWS}
          lockedReady
          motions={motions}
          geo={geo}
          books={BOOKS}
          m={m}
          width={width}
          height={h}
          cam={cam}
          shared={shared}
          reduceMotion
          planBudgetMs={60}
          debug={false}
          handle={null}
          a11yLabelOf={NO_A11Y}
          onA11y={NO_OP}
          viewPitch={pitch}
          transitIds={NONE}
          glowId={null}
          leaving={NO_LEAVING}
        />
      </View>
    </View>
  );
}
