// 홈 선반 장면 그리기. 장면 상태(줄마다 움직임, 줄 위치, 공통 카메라)는 하나이고, 그리는 캔버스는 줄마다 하나다.
// - 줄 캔버스: 그 줄의 벽 그림자·판·판 위 그림자·책을 그 줄의 3D 가림 순서(분리축)로 그린다. 아래 줄 캔버스가 위에 겹치므로,
//   한 줄의 모든 그림을 윗선반 판의 화면 윤곽 밖에만 그린다: 줄 공간 안의 것은 모두 윗선반 판보다 뒤라, 판과 겹치는 부분(8°의 책머리,
//   벽 윗부분 그림자)은 판이 가린다. 그 판은 위 줄 캔버스가 그대로 보여 준다.
// - 이동 캔버스(맨 위): 다른 줄로 옮겨 가는 책. 캔버스에 책을 올리는 일(React 반영 + 캔버스 다시 기록)은 JS에서 늦게 끝나므로,
//   옮겨 갈 만한 책(끄는 책·고른 책·정보 상자의 책·방금 옮긴 책)을 미리 올려 두고, 어느 줄에 있든 UI 스레드에서 트랙을 찾아 그린다.
//   제 줄 공간 밖에 걸친 동안과 도착한 줄 캔버스에 아직 올라가지 않은 동안 그리며, 모든 줄의 책·판 가운데 그 책 앞에 있는 것들의
//   윤곽 밖에만 그린다. 같은 동안 줄 캔버스는 그 책을 그리지 않는다(둘 다 같은 트랙·같은 표시 값으로 정한다).
//   다른 줄로 옮기는 경로는 도착 줄 캔버스에 책이 올라간 뒤에 움직이기 시작한다(planner: 멈춘 사이에 경로가 지나가 버리지 않게).
// 자세만 바뀔 때는 캔버스 안 React가 다시 돌지 않는다(줄 구조가 바뀔 때만). 줄마다 RN 쪽에는 경로 계획·접근성 칸·안내·손잡이만 둔다.
// 구성 비교(2026-10-01 측정): 세 줄을 캔버스 하나에 그리면 시점 전환은 비슷하고 끌기 프레임이 약 2배 느렸다(끄는 줄만 바뀌어도 전부 다시 그림).
import { Canvas, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import { memo, useLayoutEffect, useMemo } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { fromPlaced, toWorld, type Book3 } from '@/domain/book3';
import { BASE_CAM, camAt, kyOf, toPx, VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Affine, type Cam } from '@/domain/camera';
import { SHELF, SHELF_DEPTH, SHELF_FRONT, SHELF_THICK } from '@/domain/geometry';
import { FAR, NO_BOXES, type Env } from '@/domain/light-model';
import { receivedShadow3, shiftRecv, type Recv3 } from '@/domain/received3';
import { frameBBox, type BookFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { ribbonDesign, type RibbonDesign } from '@/domain/ribbon-design';
import { ko } from '@/i18n/ko';
import type { Shared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { LIGHT_ON, RENDER, TL, tl, TRANSIT_DEBUG } from '@/ui/perf';
import { areaItem, bakeAtlas, bookItems, bookKeyImage, NO_ATLAS, NO_BOOK_KEY, type BakeItem } from '@/ui/SceneLight';
import type { BoxBuf } from '@/domain/light-model';
import { SHOW } from '@/ui/shelf/shadow-debug';
import { colors } from '@/ui/theme';
import { colors as ui, type } from '@/ui/screenTheme';

import { rowAffine, type RowGeom, type ShelfMetrics } from './metrics';
import { useRowPlanner, type Drops } from './planner';
import { bodyOf, camWithDy, eyeDyAt, frontOccluders, liveSV, locate, lowered, outsideDist, presentSV, sceneOrder, TRANSIT_ROW, transitLead, transitVisible, warmSV, type Motion, type SceneGeo, type SceneMotion } from './scene';
import { GlowOf, makeStruct, occludersOf, RowBooks, structKeyOf, useFadingAtlas, useFloorKey, useRowBoxes, useShadePoses, useTargetPoses, useWallKey, Z_WALL, type CamSV, type Ghost, type RowStruct } from './ShelfMotion';
import { FRONT_AREA, FRONT_KEY, plankOutlinePath, rowEnv, SHELF_CAST_EXTENT, ShelfBoard, ShelfWall, TOP_AREA, TOP_KEY, UNDER_ENV, wallArea } from './ShelfPlank';

// 줄 아틀라스에서 벽 띠의 자리
const WALL_KEY = 'wall';
const UNDER_KEY = 'wall:under';

export type DropHint = { text: string; bad: boolean } | null;

export type SceneRowProps = {
  shelfId: string;
  row: RowGeom;
  frames: BookFrame[];
  arrive?: Record<string, Book3>; // 다른 줄에서 옮겨 오는 책의 지금 자세(이 줄 좌표)
  dragId: string | null; // 끄는 중인 책(선반 앞턱에 놓일 범위 표시)
  glowId: string | null; // 고른 책(윤곽 빛)
  hint: DropHint;
  ghosts?: Ghost[]; // 이 줄 배치에는 없지만 캔버스에 미리 올려 둘 책(끄는 책이 지나간 줄). 이 줄 트랙이 생길 때까지 그리지 않는다
  drops?: Drops; // 받침을 잃고 이 줄에서 떨어져 서랍으로 간 책(넘어지며 사라지는 동안 ghosts에도 남겨 둔다)
};

type Props = {
  rows: SceneRowProps[];
  motions: SceneMotion[];
  geo: Readonly<SharedValue<SceneGeo>>;
  books: Record<string, Book>;
  m: ShelfMetrics;
  width: number;
  height: number;
  cam: CamSV;
  shared: Shared;
  reduceMotion: boolean;
  planBudgetMs: number;
  debug: boolean;
  handle?: { gesture: PanGesture; shelfId: string; bookId: string; offX: SharedValue<number>; offY: SharedValue<number> } | null; // 표지 책 머리 손잡이(꾸미기에서 고른 표지 책). off: 끄는 동안 손잡이를 옮길 거리(dp)
  a11yLabelOf: (bookId: string) => string;
  onA11y: (bookId: string, action: string) => void;
  viewPitch: number; // 확정된 보기 각(접근성 칸 위치를 그 각의 정지 자세로)
  transitIds: string[]; // 다른 줄로 옮겨 갈 수 있는 책(방금 줄이 바뀐 책, 끄는 책). 이동 캔버스에 미리 올려 둔다
  glowId: string | null;
  leaving: { id: string; from: string }[]; // 이번 배치에서 다른 줄로 옮겨 가며 원래 줄 캔버스에서 내려가는 책(미리 올려 둔 줄은 빼고)
};

// 옮겨 가는 책: 원래 줄 캔버스가 그 책을 뺀 그림을 내기 전에 그 줄에서 '올라가 있지 않음'으로 표시해, 이동 캔버스가
// 그 순간부터 제자리의 책을 이어 그리게 한다(원래 줄은 곧 빠지고 도착 줄은 아직 올라가지 않은 사이가 비지 않게).
// 원래 줄에 미리 올려 둔 채 남는 책(끄는 동안)은 여기 오지 않는다: 그 줄은 트랙이 남아 있는 동안 계속 그린다.
function TransitMark({ items }: { items: { id: string; from: string }[] }) {
  // 배치가 바뀔 때마다(같은 책이 다시 옮겨 가도) 새 배열이 온다
  useLayoutEffect(() => {
    if (!items.length) return;
    scheduleOnUI(() => {
      'worklet';
      const next = { ...presentSV.value };
      const live = { ...liveSV.value };
      for (const it of items) {
        const cur = next[it.id];
        if (cur?.[it.from]) {
          const rest = { ...cur };
          delete rest[it.from];
          next[it.id] = rest;
        }
        const lv = live[it.id];
        if (lv?.[it.from]) {
          const rest = { ...lv };
          delete rest[it.from];
          live[it.id] = rest;
        }
      }
      presentSV.value = next;
      liveSV.value = live;
    });
  }, [items]);
  return null;
}

const motionOf = (list: SceneMotion[], shelfId: string) => list.find((e) => e.shelfId === shelfId)?.m;

export function ShelfScene(p: Props) {
  return (
    <>
      {/* 줄 캔버스들이 다시 기록되기 전에(형제 순서상 먼저 도는 효과) 옮겨 가는 책을 이동 캔버스에 넘긴다 */}
      <TransitMark items={p.leaving} />
      {p.rows.map((r, i) => {
        const mo = motionOf(p.motions, r.shelfId);
        return mo ? <RowCanvas key={r.shelfId} last={i === p.rows.length - 1} r={r} upper={i > 0 ? p.rows[i - 1].row : null} mo={mo} books={p.books} m={p.m} width={p.width} cam={p.cam} shared={p.shared} debug={p.debug} /> : null;
      })}
      <TransitCanvas ids={p.transitIds} rows={p.rows} motions={p.motions} geo={p.geo} books={p.books} m={p.m} width={p.width} height={p.height} cam={p.cam} shared={p.shared} glowId={p.glowId} />
      {p.rows.map((r, i) => {
        const mo = motionOf(p.motions, r.shelfId);
        if (!mo) return null;
        return <RowOverlay key={r.shelfId} r={r} roofed={i > 0} mo={mo} m={p.m} reduceMotion={p.reduceMotion} planBudgetMs={p.planBudgetMs} a11yLabelOf={p.a11yLabelOf} onA11y={p.onA11y} viewPitch={p.viewPitch} />;
      })}
      {p.handle ? <HeadHandle key={p.handle.bookId} mo={motionOf(p.motions, p.handle.shelfId)} row={p.rows.find((r) => r.shelfId === p.handle!.shelfId)} id={p.handle.bookId} cam={p.cam} m={p.m} gesture={p.handle.gesture} offX={p.handle.offX} offY={p.handle.offY} /> : null}
    </>
  );
}

// 캔버스에 닿는 값: 줄 구조(책·쌓임·치수)와 표시(끄는 책·고른 책), 줄 위치. 자세는 트랙으로만 흐른다.
const sameRowDraw = (a: SceneRowProps, b: SceneRowProps) =>
  a.shelfId === b.shelfId && ((a.frames === b.frames && a.ghosts === b.ghosts) || structKeyOf(a.frames, a.ghosts) === structKeyOf(b.frames, b.ghosts)) && a.dragId === b.dragId && a.glowId === b.glowId &&
  a.row.baseline === b.row.baseline && a.row.space === b.row.space && a.row.top === b.row.top && a.row.height === b.row.height;

// 한 줄의 그림(캔버스 안): 벽 + 벽 그림자 + 판 + 판 위 그림자 + 책(그 줄의 분리축 순서로 zIndex).
// upx: 위 줄 변환(맨 윗줄은 null). 이 줄 벽은 위 판의 뒤 윗모서리(위 줄 판 윤곽이 시작하는 곳)까지 칠한다.
const RowLayers = memo(function RowLayers({ r, st, mo, order, px, upx, books, cam, shared, debug, last = false }: { r: SceneRowProps; st: RowStruct; mo: Motion; order: Readonly<SharedValue<Record<string, number>>>; px: Affine; upx: Affine | null; books: Record<string, Book>; cam: CamSV; shared: Shared; debug: boolean; last?: boolean }) {
  const plankZ = useDerivedValue(() => (order.value[`plank:${r.shelfId}`] ?? 0) * 10);
  const space = r.row.space;
  const top = !upx;
  // 그림자는 모두 줄의 그림자용 자세 모음만 읽는다(바뀐 책이 있을 때만 다시 계산·다시 그리기)
  // 위 판 아랫면(맨 윗줄은 위에 판이 없다): 판 앞을 지나 다른 줄로 옮겨 가는 책의 그림자는 판이 막는 만큼 뺀다
  const ceil = top ? Infinity : space;
  const poses = useShadePoses(mo, st.ids, space, r.shelfId, ceil);
  // 빛 계산: 이 줄의 둘레(판 윗면, 위 판 아랫면)와 경로 도착 자세의 책 상자 목록. 하늘 가림은 줄의 면 전부를 아틀라스 한 장에 굽는다
  // (책이 움직이기 시작할 때 도착 자세로 굽고 앞 굽기에서 서서히 바꾼다, useFadingAtlas).
  // 판은 그린 곳에서 끝난다(판 끝 너머는 열린 벽). 판 끝 너머로 보이는 다른 줄은 하늘로 본다(light-model Env)
  const target = useTargetPoses(mo, st.ids);
  const env = useMemo(() => rowEnv(space, top), [space, top]);
  const envSV = useDerivedValue<Env | null>(() => env);
  const boxes = useRowBoxes(target, st.ids, books, env);
  const wallY1 = space + SHELF_THICK + (top ? HEAD_DU : 0);
  const wallA = useMemo(() => wallArea(-SHELF_THICK, wallY1), [wallY1]);
  const underA = useMemo(() => wallArea(-SHELF_THICK - SHELF_CAST_EXTENT, -SHELF_THICK), []);
  const ids = st.ids;
  const wallOn = SHOW.shelf && LIGHT_ON.wall;
  const boardOn = SHOW.shelfBoard && SHOW.shelfShade && LIGHT_ON.plank;
  const booksOn = RENDER.books && LIGHT_ON.face;
  const bakeKey = `atlas:${r.shelfId}`;
  const atlas = useFadingAtlas(target, boxes, (ps: Record<string, Book3 | null>, bx: BoxBuf) => {
    'worklet';
    // 아직 자세가 없다(마운트 직후)
    if (ids.length && !ids.some((id) => ps[id])) return NO_ATLAS;
    const items: BakeItem[] = [];
    if (wallOn) items.push(areaItem(WALL_KEY, wallA, env, bx));
    if (wallOn && last) items.push(areaItem(UNDER_KEY, underA, UNDER_ENV, NO_BOXES));
    if (boardOn) items.push(areaItem(TOP_KEY, TOP_AREA, env, bx), areaItem(FRONT_KEY, FRONT_AREA, env, bx));
    if (booksOn) {
      bx.ids.forEach((id, i) => {
        const b = ps[id];
        if (b) items.push(...bookItems(id, b, env, bx, i));
      });
    }
    return bakeAtlas(items, bakeKey);
  });
  // 이 줄 책이 벽·판 윗면에서 창빛을 가리는 몫(벽·판 셰이더가 빛 계산 안에서 쓴다)
  const wallKey = useWallKey(r.shelfId, poses, st.ids, px, top ? wallY1 : space + SHELF_THICK, ceil);
  const floorKey = useFloorKey(r.shelfId, poses, st.ids, px, ceil);
  return (
    <>
      {/* 이 줄 벽: 판 아랫면 높이(판 양 끝 너머로 보인다)부터 위 판 두께 가운데까지(그 위는 위 줄 캔버스), 맨 윗줄은 캔버스 위 끝까지.
          판 아랫면 아래는 아래 줄 공간이라 아래 줄 캔버스가 그 둘레로 칠한다(이 줄 둘레로는 판 밑을 계산할 수 없다. 판 끝 둥근 모서리로 드러난다).
          아래 줄 벽이 이 판 두께 가운데까지 올라와 두 캔버스가 판 두께 절반 겹친다(줄마다 카메라가 달라 조금 어긋나도 틈이 없다) */}
      {SHOW.shelf ? <ShelfWall cam={cam} px={px} y0={-SHELF_THICK} y1={wallY1} top={top ? wallY1 : space + SHELF_THICK / 2} bottom={-SHELF_THICK} env={env} atlas={atlas} akey={WALL_KEY} zIndex={Z_WALL} keyShadow={wallKey} /> : null}
      {SHOW.shelf && last ? <ShelfWall cam={cam} px={px} y0={-SHELF_THICK - SHELF_CAST_EXTENT} y1={-SHELF_THICK} env={UNDER_ENV} atlas={atlas} akey={UNDER_KEY} zIndex={Z_WALL} /> : null}
      {SHOW.shelfBoard ? <ShelfBoard px={px} cam={cam} zIndex={plankZ} env={env} atlas={atlas} keyShadow={floorKey} /> : null}
      {RENDER.books ? <RowBooks m={mo} shelfId={r.shelfId} st={st} books={books} glowId={r.glowId} dragId={r.dragId} cam={cam} px={px} space={space} ceil={ceil} shared={shared} order={order} poses={poses} env={envSV} atlas={atlas} boxes={boxes} debug={debug} /> : null}
    </>
  );
});

// ---------- 줄 캔버스 ----------
const EMPTY_CLIP = Skia.PathBuilder.Make().detach();
// 줄 칸 위로 넓힐 높이: 8°에서 벽 윗끝(윗선반 판 뒤)까지. 이 부분은 윗선반 판 윤곽으로 잘려 판이 보인다.
const HEAD_DU = SHELF_FRONT * BASE_CAM.ky + SHELF_DEPTH * kyOf(VIEW_PITCH_MAX) + 6;


const RowCanvas = memo(
  function RowCanvas({ r, upper, mo, books, m, width, cam, shared, debug, last = false }: { r: SceneRowProps; upper: RowGeom | null; mo: Motion; books: Record<string, Book>; m: ShelfMetrics; width: number; cam: CamSV; shared: Shared; debug: boolean; last?: boolean }) {
    // 캔버스 위쪽 끝은 물리 픽셀에 맞춘다: 레이아웃은 뷰 위치를 픽셀로 반올림하는데 그림의 변환은 y0 그대로라, 맞추지 않으면 이 줄 그림이
    // 이동 캔버스(맨 위 0)와 반 픽셀까지 어긋나 같은 책을 넘겨줄 때 글자·그림 가장자리가 흔들린다
    const y0 = PixelRatio.roundToNearestPixel(Math.max(0, r.row.top - HEAD_DU * m.scale));
    const height = r.row.top + r.row.height + SHELF_CAST_EXTENT * m.scale - y0;
    const px = useMemo(() => rowAffine(m, r.row, y0), [m, r.row, y0]);
    const upx = useMemo(() => (upper ? rowAffine(m, upper, y0) : null), [m, upper, y0]);
    const skey = structKeyOf(r.frames, r.ghosts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const st = useMemo(() => makeStruct(r.frames, r.arrive, r.ghosts), [skey]);
    const shelfId = r.shelfId;
    const s = m.scale;
    // 이 줄의 그리는 순서: 이 줄이 그리는 책 + 이 줄 판
    const space = r.row.space;
    const order = useDerivedValue(() => sceneOrder([{ shelfId, m: mo }], { rows: [{ shelfId, baseline: 0, dy: 0, space }], s, originX: 0 }, cam.value, true));
    // 윗선반 판의 화면 윤곽(이 캔버스 px, 판 그리기와 같은 둥근 윤곽): 이 줄의 모든 그림은 이 밖에만
    const clip = useDerivedValue(() => (upx ? plankOutlinePath(cam.value, upx) : EMPTY_CLIP));
    // 측정 번들 시간표: 이 줄 캔버스가 다시 그려지는 때(렌더 → 캔버스 기록이 끝난 커밋)
    if (TL.on) tl(`row-render ${shelfId} n=${st.ids.length}`);
    useLayoutEffect(() => {
      if (TL.on) tl(`row-commit ${shelfId}`);
    });
    return (
      <Canvas style={{ position: 'absolute', left: 0, top: y0, width, height }} pointerEvents="none">
        <Group clip={clip} invertClip>
          <RowLayers r={r} st={st} mo={mo} order={order} px={px} upx={upx}  books={books} cam={cam} shared={shared} debug={debug} last={last} />
        </Group>
      </Canvas>
    );
  },
  (a, b) =>
    sameRowDraw(a.r, b.r) && a.last === b.last && a.upper?.space === b.upper?.space && a.upper?.baseline === b.upper?.baseline && a.upper?.shelfId === b.upper?.shelfId && a.mo === b.mo && a.books === b.books && a.m === b.m && a.width === b.width && a.cam === b.cam && a.shared === b.shared && a.debug === b.debug,
);

// ---------- 이동 캔버스 ----------
// 다른 줄로 옮겨 가는 동안의 책: 모든 줄 캔버스 위에서, 그 책 앞에 있는 판·책 윤곽 밖에만 그린다.
// 캔버스에 책을 올리는 일은 JS에서 늦게 끝나므로(React 반영 + 캔버스 다시 기록), 옮겨 갈 만한 책(끄는 책·고른 책·정보 상자 책·
// 방금 옮긴 책)은 미리 올려 둔다. 이 책은 어느 줄에 있든 UI 스레드에서 직접 찾아(트랙이 있는 줄) 맨 윗줄 좌표로 그린다.
// 그리는 때: 제 줄 공간 밖에 걸쳐 있거나, 도착한 줄 캔버스에 아직 올라가지 않았을 때. 그 밖에는 멈춰 있다(계산도 멈춤).
const HIDE_ALL = Skia.PathBuilder.Make().addRect(Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5)).detach();

// 이동 캔버스의 책이 받는 그림자의 기준: 지금 가장 가까운 줄과 그 줄 좌표의 이 책·가리개
function nearRow(motions: SceneMotion[], g: SceneGeo, id: string) {
  'worklet';
  const at = locate(motions, g, id);
  if (!at) return null;
  const top = lowered(at.b, at.row.dy);
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < g.rows.length; i++) {
    const d = outsideDist(lowered(top, -g.rows[i].dy), g.rows[i].space);
    if (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && g.rows[i].shelfId === at.row.shelfId)) {
      bd = d;
      best = i;
    }
  }
  const row = g.rows[best];
  let m: Motion | null = null;
  for (const e of motions) if (e.shelfId === row.shelfId) m = e.m;
  if (!m) return null;
  const b = lowered(top, -row.dy);
  const ids = Object.keys(m.tracks.value).concat(Object.keys(m.away.value));
  const all: { id: string; b: Book3 }[] = [];
  for (const o of ids) {
    if (o === id) continue;
    const ob = bodyOf(m, o);
    if (ob) all.push({ id: o, b: ob });
  }
  return { row, idx: best, b, occ: occludersOf(m, b, id, ids), all };
}

// 이동 캔버스의 책이 받는 창빛 그림자(면 좌표 그림, 책 빛 셰이더가 쓴다): 줄 캔버스와 같은 계산(같은 가리개 모델·같은 이웃 고르기)을,
// 책이 가장 가까이 있는 줄의 책으로. 넘겨받는 순간(원래 줄 안, 같은 자세)과 도착 줄에 들어가는 순간 줄 그림과 같은 그림자라,
// 캔버스가 바뀌어도 책 면 명암이 이어진다. 결과는 맨 윗줄 좌표로 옮긴다(면 좌표 그림은 책 자세에 붙어 있어 그대로 쓴다)
function useTransitKey(id: string, motions: SceneMotion[], geo: Readonly<SharedValue<SceneGeo>>, px0: Affine, vis: Readonly<SharedValue<boolean>>, on: boolean) {
  // 보이는 동안 매 프레임 같은 계산(이 책·가리개 자세가 바뀔 때만 다시 돈다). 반응(reaction)으로 두면 계산이 그리기보다 한 프레임 늦어
  // 이동 캔버스가 처음 보이는 프레임에 받는 그림자가 비었다(책 면이 한 프레임 밝아짐).
  // motions·geo는 이 계산이 직접 붙잡아 지켜본다(다른 함수를 거쳐서만 읽으면 처음 한 번만 계산된다).
  const r3 = useDerivedValue<Recv3>(() => {
    if (!on || !vis.value) return null;
    const g = geo.value;
    const n = nearRow(motions, g, id);
    return n ? shiftRecv(receivedShadow3(n.b, n.occ, px0.s), -n.row.dy) : null;
  });
  return useDerivedValue(() => (on ? bookKeyImage(`book-key:transit:${id}`, r3.value, px0.s) : NO_BOOK_KEY));
}

function TransitBook({ id, book, dims, frozen, motions, geo, cam, px0, shared, glow, dbg, ribbons, transit }: { id: string; book: Book; dims: Book3['dims']; frozen: Book3; motions: SceneMotion[]; geo: Readonly<SharedValue<SceneGeo>>; cam: CamSV; px0: Affine; shared: Shared; glow: boolean; dbg: boolean; ribbons: Record<string, RibbonDesign>; transit: Record<string, true> }) {
  const vis = useDerivedValue(() => transitVisible(motions, geo.value, id, liveSV.value, warmSV.value));
  // 빛 계산의 둘레: 책이 가장 가까이 있는 줄(맨 윗줄 좌표로 옮겨서). 움직이는 동안은 둘레가 가린 하늘만 그 자리에서(다른 책은 뺀다)
  const env = useDerivedValue<Env | null>(() => {
    const n = vis.value ? nearRow(motions, geo.value, id) : null;
    if (!n) return null;
    return { floor: -n.row.dy, ceil: n.idx > 0 ? n.row.space - n.row.dy : FAR };
  });
  // 보이지 않는 동안은 같은 값(책 그림 계산이 돌지 않게). 보이면 맨 윗줄 좌표로 내린 지금 자세.
  const state = useDerivedValue(() => {
    if (!vis.value) return frozen;
    const at = locate(motions, geo.value, id);
    return at ? lowered(at.b, at.row.dy) : frozen;
  });
  const frozenCam = useMemo(() => ({ ...cam.value }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // 맨 윗줄 좌표로 내린 책을 그 높이의 줄 캔버스와 같은 눈으로 그린다(줄마다 눈이 따로라, 맨 윗줄 눈으로 그리면 아래 줄 책이 어긋난다)
  const camT = useDerivedValue(() => (vis.value ? camWithDy(cam.value, eyeDyAt(geo.value, state.value)) : frozenCam));
  const clip = useDerivedValue(() => {
    if (!vis.value) return HIDE_ALL;
    const at = locate(motions, geo.value, id);
    if (!at) return HIDE_ALL;
    const polys = frontOccluders(motions, geo.value, cam.value, at.row.shelfId, id, ribbons, transit);
    if (!polys.length) return EMPTY_CLIP;
    const pb = Skia.PathBuilder.Make();
    for (const pts of polys) {
      pts.forEach((q, i) => (i ? pb.lineTo(q.x, q.y) : pb.moveTo(q.x, q.y)));
      pb.close();
    }
    return pb.detach();
  });
  // 이 이동 캔버스가 이 책을 실제로 그릴 수 있게 된 때(첫 그림 뒤 이 책의 계산이 처음 돈 때) 알린다: 그 뒤로는 떠나는 책을 원래 줄이
  // 겹쳐 그리지 않는다(ShelfMotion RowBook). 내려갈 때 지운다.
  const announced = useSharedValue(false);
  useAnimatedReaction(
    () => vis.value,
    () => {
      if (announced.value) return;
      announced.value = true;
      liveSV.value = { ...liveSV.value, [id]: { ...(liveSV.value[id] ?? {}), [TRANSIT_ROW]: true } };
    },
  );
  useLayoutEffect(
    () => () => {
      scheduleOnUI(() => {
        'worklet';
        const lv = liveSV.value[id];
        if (!lv?.[TRANSIT_ROW]) return;
        const rest = { ...lv };
        delete rest[TRANSIT_ROW];
        liveSV.value = { ...liveSV.value, [id]: rest };
      });
    },
    [id],
  );
  // 선택 빛은 이동 캔버스만 그 책을 그릴 때만(미리 그려 두는 동안은 줄 그림의 빛이 이웃 책 뒤로 알맞게 가려진 채 보인다).
  // 빛은 책보다 먼저(책 아래) 그린다: 맨 윗줄 아래 줄의 책은 깊이 키가 음수라 0이면 빛이 책 위에 덮였다.
  const body = useDerivedValue(() => (vis.value && transitLead(motions, geo.value, id, liveSV.value) ? state.value : null));
  const keyShadow = useTransitKey(id, motions, geo, px0, vis, SHOW.cast);
  return (
    <>
      <Group clip={clip} invertClip>
        {glow ? <GlowOf body={body} cam={camT} px={px0} z={-1e9} /> : null}
        <BookNode book={book} dims={dims} state={state} cam={camT} px={px0} shared={shared} keyShadow={keyShadow} env={env} />
      </Group>
      {dbg ? <Path path={clip} style="stroke" strokeWidth={2} color="rgba(220,30,30,0.9)" /> : null}
    </>
  );
}

const TransitCanvas = memo(function TransitCanvas({ ids, rows, motions, geo, books, m, width, height, cam, shared, glowId }: { ids: string[]; rows: SceneRowProps[]; motions: SceneMotion[]; geo: Readonly<SharedValue<SceneGeo>>; books: Record<string, Book>; m: ShelfMetrics; width: number; height: number; cam: CamSV; shared: Shared; glowId: string | null }) {
  const top = rows[0]?.row;
  // 책마다 치수와 멈춰 있을 때의 자세(맨 윗줄 좌표): 지금 배치에서 그 책이 있는 줄
  const items = ids.flatMap((id) => {
    const r = rows.find((q) => q.frames.some((f) => f.bookId === id));
    const f = r?.frames.find((q) => q.bookId === id);
    if (!r || !f || !top || !books[id]) return [];
    const b = fromPlaced(f.box);
    return [{ id, dims: b.dims, frozen: lowered(b, (r.row.baseline - top.baseline) / m.scale) }];
  });
  const px0 = useMemo(() => (top ? rowAffine(m, top, 0) : { s: m.scale, tx: 0, ty: 0 }), [m, top]);
  const dbg = TRANSIT_DEBUG.on;
  const idList = useMemo(() => ids, [ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // 앞을 가리는 갈피의 실제 치수와 함께 옮겨 가는 책(서로 실제 깊이로 가린다)
  const ribbons = useMemo(() => {
    const out: Record<string, RibbonDesign> = {};
    for (const [id, b] of Object.entries(books)) if ((b.quotes ?? 0) > 0) out[id] = ribbonDesign(b);
    return out;
  }, [books]);
  const transit = useMemo(() => Object.fromEntries(idList.map((id) => [id, true as const])), [idList]);
  if (TL.on) tl(`transit-render ${ids.join(',')}`);
  useLayoutEffect(() => {
    if (TL.on) tl('transit-commit');
  });
  // 하나라도 그리는 동안만 보이게(나머지 시간에는 합성하지 않는다). 숨길 때만 두 프레임 늦춘다: 보기 투명도는 그 프레임에 바로
  // 바뀌지만 줄 캔버스의 새 그림은 다음 프레임에 보여, 넘겨주는 순간 한 프레임 동안 아무도 그리지 않는 일이 없게(숨겨진 책은 이미
  // 이 캔버스 그림에서 빠져 있어 늦게 숨겨도 두 권으로 보이지 않는다).
  const anyVisible = useDerivedValue(() => {
    if (dbg) return true;
    const live = liveSV.value;
    const warm = warmSV.value;
    for (const id of idList) if (transitVisible(motions, geo.value, id, live, warm)) return true;
    return false;
  });
  const shown = useSharedValue(0);
  useAnimatedReaction(
    () => anyVisible.value,
    (v, prev) => {
      if (v === prev) return;
      // 기기 '애니메이션 줄이기'가 켜져 있어도 늦춤은 지킨다(늦춤이 빠지면 넘겨주는 프레임에 아무도 그리지 않는다)
      shown.value = v ? 1 : withDelay(40, withTiming(0, { duration: 0 }), ReduceMotion.Never);
    },
  );
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height }, style]} pointerEvents="none">
      <Canvas style={{ width, height }} pointerEvents="none">
        {dbg ? <Rect x={0} y={0} width={width} height={height} color="rgba(255,0,0,0.08)" /> : null}
        {items.map((it) => (
          <TransitBook key={it.id} id={it.id} book={books[it.id]} dims={it.dims} frozen={it.frozen} motions={motions} geo={geo} cam={cam} px0={px0} shared={shared} glow={glowId === it.id} dbg={dbg} ribbons={ribbons} transit={transit} />
        ))}
      </Canvas>
    </Animated.View>
  );
}, (a, b) =>
  a.ids.join('|') === b.ids.join('|') && a.motions === b.motions && a.geo === b.geo && a.books === b.books && a.m === b.m && a.width === b.width && a.height === b.height && a.cam === b.cam && a.shared === b.shared &&
  (a.glowId === b.glowId || (!a.ids.includes(a.glowId ?? '') && !b.ids.includes(b.glowId ?? ''))) &&
  a.rows[0]?.row.baseline === b.rows[0]?.row.baseline);

// 줄 하나의 RN 쪽: 경로 계획, 접근성 칸(보이지 않는 버튼), 끄는 동안 안내
const RowOverlay = memo(function RowOverlay({ r, roofed, mo, m, reduceMotion, planBudgetMs, a11yLabelOf, onA11y, viewPitch }: { r: SceneRowProps; roofed: boolean; mo: Motion; m: ShelfMetrics; reduceMotion: boolean; planBudgetMs: number; a11yLabelOf: (bookId: string) => string; onA11y: (bookId: string, action: string) => void; viewPitch: number }) {
  useRowPlanner(mo, r.shelfId, r.frames, reduceMotion, r.arrive, planBudgetMs, r.row.space, roofed, r.drops);
  const s = m.scale;
  return (
    <>
      {r.frames.map((f) => (
        <BookSlot key={f.bookId} frame={f} row={r.row} m={m} a11yLabel={a11yLabelOf(f.bookId)} onA11y={onA11y} viewPitch={viewPitch} />
      ))}
      {r.hint ? (
        <View style={[styles.hint, { top: r.row.top + 2 * s }, r.hint.bad && styles.hintBad]} pointerEvents="none">
          <Text style={[styles.hintText, r.hint.bad && { color: colors.danger }]}>{r.hint.text}</Text>
        </View>
      ) : null}
    </>
  );
}, (a, b) =>
  // 경로 계획은 자세가 바뀔 때도 돌아야 하므로 프레임 자체를 비교한다(캔버스와 달리)
  a.r.frames === b.r.frames && a.r.arrive === b.r.arrive && a.r.drops === b.r.drops && a.r.hint === b.r.hint && a.r.row === b.r.row && a.mo === b.mo && a.m === b.m && a.reduceMotion === b.reduceMotion && a.planBudgetMs === b.planBudgetMs && a.a11yLabelOf === b.a11yLabelOf && a.onA11y === b.onA11y && a.viewPitch === b.viewPitch);

// 책 자리(보이지 않는 접근성 칸). 그림은 캔버스가 그린다. 위치는 확정된 보기 각으로 잰 정지 자세(접근성 초점 표시용).
const BookSlot = memo(function BookSlot({ frame, row, m, a11yLabel, onA11y, viewPitch }: { frame: BookFrame; row: RowGeom; m: ShelfMetrics; a11yLabel: string; onA11y: (bookId: string, action: string) => void; viewPitch: number }) {
  const bb = frameBBox(frame, camAt(viewPitch));
  const s = m.scale;
  return (
    <View
      style={{ position: 'absolute', left: m.originX + (SHELF.sideMargin + bb.minX) * s, top: row.baseline + bb.minY * s, width: bb.width * s, height: bb.height * s }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={ko.a11yHint}
      accessibilityActions={[
        { name: 'activate' },
        { name: 'prev', label: ko.place.prev },
        { name: 'next', label: ko.place.next },
      ]}
      onAccessibilityAction={(e) => onA11y(frame.bookId, e.nativeEvent.actionName)}
    />
  );
});

// 표지 책 머리 손잡이: 보이는 점은 작게, 잡는 칸은 넓게. 지금 자세·카메라의 머리 앞 가운데(3D 한 점) 바로 위에 붙어 따라간다.
// 끄는 방향 판별(위아래 = 젖히기, 좌우 = 돌리기)은 HomeScreen이 조금 움직인 뒤 한 번만 한다.
export const HANDLE_HIT = 48;
export const HANDLE_LIFT_DU = 7; // 머리보다 이만큼 위(3D 세로)에 손잡이
export function handlePoint(mo: Motion, id: string, cam: Cam, px: Affine) {
  'worklet';
  const b = bodyOf(mo, id);
  if (!b) return null;
  const d = b.dims;
  const head = toWorld(b, { x: d.T, y: d.H, z: d.W / 2 });
  return toPx(cam, px, { x: head.x, y: head.y + HANDLE_LIFT_DU, z: head.z });
}

function HeadHandle({ mo, row, id, cam, m, gesture, offX, offY }: { mo?: Motion; row?: SceneRowProps; id: string; cam: CamSV; m: ShelfMetrics; gesture: PanGesture; offX: SharedValue<number>; offY: SharedValue<number> }) {
  const px = useMemo(() => (row ? rowAffine(m, row.row, 0) : { s: 1, tx: 0, ty: 0 }), [m, row]);
  const s = m.scale;
  // 손잡이: 머리 위 한 점 + 끄는 동안 축 방향으로 실제로 된 각도만큼(손가락을 따라간다)
  const st = useAnimatedStyle(() => {
    const p = mo ? handlePoint(mo, id, cam.value, px) : null;
    if (!p) return { opacity: 0, transform: [{ translateX: -1000 }, { translateY: -1000 }] };
    return { opacity: 1, transform: [{ translateX: p.x + offX.value - HANDLE_HIT / 2 }, { translateY: p.y + offY.value - HANDLE_HIT / 2 }] };
  });
  // 끄는 동안 머리 위 제자리와 손잡이를 잇는 가는 선(무엇을 젖히거나 돌리는지 보이게)
  const tether = useAnimatedStyle(() => {
    const p = mo ? handlePoint(mo, id, cam.value, px) : null;
    const len = Math.hypot(offX.value, offY.value);
    if (!p || len < 2) return { opacity: 0, width: 0, transform: [{ translateX: -1000 }, { translateY: -1000 }, { rotate: '0rad' }] };
    return { opacity: 1, width: len, transform: [{ translateX: p.x }, { translateY: p.y - 0.75 }, { rotate: `${Math.atan2(offY.value, offX.value)}rad` }] };
  });
  if (!mo || !row) return null;
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.tether, tether]} />
      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          accessibilityRole="adjustable"
          accessibilityLabel={ko.decoratePanel.head}
          style={[{ position: 'absolute', left: 0, top: 0, width: HANDLE_HIT, height: HANDLE_HIT, alignItems: 'center', justifyContent: 'center' }, st]}>
          <View style={[styles.knob, { width: 16 * s, height: 16 * s, borderRadius: 8 * s }]}>
            <View style={[styles.knobDot, { width: 5 * s, height: 5 * s, borderRadius: 2.5 * s }]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

// ---------- 머리글 뒤 벽 ----------
// 맨 윗줄 벽은 머리글 뒤로 화면 위 끝까지 이어진다. 맨 윗줄 책이 벽의 하늘을 가린 몫이 머리글 경계에서 끊기지 않게,
// 머리글 뒤도 같은 빛 계산(같은 책 상자·둘레)으로 칠한다. 머리글은 스크롤과 함께 움직이지 않으므로 스크롤 맨 위일 때의 벽이다.
// height: 화면 위 끝에서 줄 화면(스크롤 영역) 위 끝까지
export function HeaderWall({ rows, motions, books, m, width, height, cam }: { rows: SceneRowProps[]; motions: SceneMotion[]; books: Record<string, Book>; m: ShelfMetrics; width: number; height: number; cam: CamSV }) {
  const mo = rows[0] ? motionOf(motions, rows[0].shelfId) : undefined;
  if (!mo || height <= 0) return null;
  return <HeaderWallRow row={rows[0]} mo={mo} books={books} m={m} width={width} height={height} cam={cam} />;
}
// 맨 윗줄 벽과 같은 입력(같은 책 상자·둘레)
function HeaderWallRow({ row, mo, books, m, width, height, cam }: { row: SceneRowProps; mo: Motion; books: Record<string, Book>; m: ShelfMetrics; width: number; height: number; cam: CamSV }) {
  const space = row.row.space;
  const ids = useMemo(() => row.frames.map((f) => f.bookId), [row.frames]);
  const target = useTargetPoses(mo, ids);
  const env = useMemo(() => rowEnv(space, true), [space]);
  const boxes = useRowBoxes(target, ids, books, env);
  // 캔버스 위 끝 = 콘텐츠 좌표 −height
  const px = useMemo(() => rowAffine(m, row.row, -height), [m, row.row, height]);
  // 이 캔버스에 보이는 벽 높이(보기 각 범위 전체)
  const [y0, y1] = useMemo(() => {
    const ys = [VIEW_PITCH_MIN, VIEW_PITCH_MAX].flatMap((deg) => {
      const e = camAt(deg).eye!;
      const d = 1 + (SHELF_DEPTH - e.z) / e.dist;
      return [0, height].map((Y) => e.y + (-(Y - px.ty) / px.s - e.y) * d);
    });
    return [Math.min(...ys) - BAKE_MARGIN, Math.max(...ys) + BAKE_MARGIN];
  }, [px, height]);
  const area = useMemo(() => wallArea(y0, y1), [y0, y1]);
  const atlas = useFadingAtlas(target, boxes, (ps: Record<string, Book3 | null>, bx: BoxBuf) => {
    'worklet';
    if (ids.length && !ids.some((id) => ps[id])) return NO_ATLAS;
    return bakeAtlas([areaItem(WALL_KEY, area, env, bx)], 'atlas:header');
  });
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <ShelfWall cam={cam} px={px} y0={y0} y1={y1} env={env} atlas={atlas} akey={WALL_KEY} zIndex={0} />
    </Canvas>
  );
}
// 머리글 벽 그림을 위아래로 한 칸 넉넉히(캔버스 끝 화소까지 그림 안에서 보간되게)
const BAKE_MARGIN = 2;

// 캔버스가 콘텐츠 아래로 넘쳐야 하는 길이(마지막 줄 판의 벽 그림자)
export { SHELF_CAST_EXTENT };

const styles = StyleSheet.create({
  knob: { backgroundColor: 'rgba(255, 252, 246, 0.95)', borderWidth: 1, borderColor: 'rgba(160, 120, 88, 0.55)', alignItems: 'center', justifyContent: 'center', shadowColor: '#3B3330', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  knobDot: { backgroundColor: 'rgba(160, 110, 70, 0.8)' },
  tether: { position: 'absolute', left: 0, top: 0, height: 1.5, borderRadius: 1, backgroundColor: 'rgba(160, 120, 88, 0.55)', transformOrigin: 'left center' },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(254, 254, 253, 0.94)', // 화면 배경(ui bg)을 살짝 비치게
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  hintBad: { borderColor: colors.danger },
  hintText: { ...type.caption, color: ui.ink },
});

