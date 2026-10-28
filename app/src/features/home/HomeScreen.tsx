// 홈 책장. 선반 전체를 하나의 제스처로 받고, 터치는 UI 스레드에서 지금 보이는 3D 자세·가림 순서로 앞에 보이는 책을 고른다
// (그리기·그림자·선택 빛·손잡이와 같은 장면 상태, ui/shelf/scene).
// 짧게 누르기 → 정보 상자, 350ms 길게 누르기 → 끌기. 끌기 전 세로 이동은 스크롤이 가져간다.
// 끌기: 같은 선반은 그 자리에 놓고 부딪히는 옆 책만 비키고, 다른 선반은 그 자리에 끼우기(눕힌 책 가운데면 쌓기).
// 놓을 곳이 없으면 책은 제자리에 있고 안내만 뜬다(따로 떠 있는 끌기 그림 없음). 화면 가장자리에서 자동 스크롤.
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BookMarked, ChartNoAxesColumn, Eraser, Paintbrush, Plus, Search, Settings } from '@/ui/icons';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useDerivedValue,
  scrollTo,
  useAnimatedRef,
  useFrameCallback,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { camAt, VIEW_PITCH_MAX, VIEW_PITCH_MIN } from '@/domain/camera';
import { DESIGN_WIDTH, PLANK_INSET, SHELF, SHELF_FRONT, SHELF_THICK, SHELF_USABLE_WIDTH, VIEW_DEG_PER_DP, viewSettle } from '@/domain/geometry';
import { useViewStore, viewStore } from '@/store/view-store';
import {
  applySwapTarget,
  bookXs,
  detach,
  findDropTarget,
  findSwapTarget,
  itemWidth,
  moveBook,
  moveBy,
  moveToShelf,
  placementOf,
  setPose,
  setSpin,
  setDepth,
  frontStateOf,
  frontTilt,
  frontSpin,
  frontRelease,
  boxOf,
  depthRange,
  setTilt,
  shelfItems,
  sortedShelves,
  type SwapTarget,
  type FailReason,
  type Result,
} from '@/domain/layout-engine';
import { corners, fromPlaced, type Book3 } from '@/domain/book3';
import { computeShelf, fallDirOf, frameBBox, withLeans } from '@/domain/shelf-scene';
import { DROP_MS } from '@/domain/transition';
import { tiltToward, type BookPlacement, type Pose, type ShelfLayout, type Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { settingsStore, useSettings } from '@/store/settings-store';
import { uiBus } from '@/store/ui-bus';
import { DEMO_BOOT_KEY } from '@/store/boot';
import Storage from 'expo-sqlite/kv-store';
import { bootMark, watchResponsive } from '@/ui/boot-trace';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { useBookShared } from '@/ui/book3d/art';
import { ReferenceUI } from '@/ui/ReferenceUI';
import { CONTENT_TOP, computeRows, LAYOUT, rowAffine, rowAt, toContent, useShelfMetrics, type RowGeom } from '@/ui/shelf/metrics';
import { benchProjection, type BenchRow } from '@/ui/shelf/ShelfMotion';
import { displayedPoses, flushApply, lastPlan, previewInto, PULL_MS, settleInto, WAIT_MAX, type Drops } from '@/ui/shelf/planner';
import { fallSig, HOLD_MS, stepHold, type Hold } from '@/ui/shelf/preview-hold';
import { liveSV, pickAt, plankFrontBand, rowPx, TRANSIT_ROW, warmSV, type Pick, type SceneGeo } from '@/ui/shelf/scene';
import { HANDLE_HIT, handlePoint, HeaderWall, SHELF_CAST_EXTENT, ShelfScene, type DropHint, type SceneRowProps } from '@/ui/shelf/ShelfScene';
import { ANIM, frameStats, logChunks, MENU_FLAGS, PERF_DETAIL, PERF_ENABLED, PERF_LEVELS, PUSH_DEBUG, setLightOff, setPerfLevel, TL, tl, tlEv, tlOn, tlu, TRANSIT_DEBUG, setShelfMode, setShelfView, SHELF_MODES, SHELF_VIEWS, type PerfLevel, type ShelfMode } from '@/ui/perf';
import type { FrontState } from '@/domain/front-pose';
import { colors, fonts, motion, navigation } from '@/ui/theme';
// 책장 밖 UI(메뉴 시트·알림·빈 책장 안내)는 화면 공통 토큰을 쓴다(책장 장면·머리글은 theme.ts 그대로)
import { colors as ui, fonts as uiFonts, icon, shape, space, type } from '@/ui/screenTheme';

import { BookSheet } from './BookSheet';
import { STATUS_LABEL } from '@/features/book/labels';
import { libraryStore, useLibrary } from '@/store/library-store';
import { miniTimerStore } from '@/store/mini-timer-store';
import { tabBarStyle } from '@/ui/tabBar';

import { DecoratePanel } from './DecoratePanel';
import { useSceneMotions, useShelfScenes } from './useShelfSceneState';

type MoveAction = 'prev' | 'next' | 'up' | 'down';

type HintKind = SwapTarget['kind'] | 'beside';
// key: 같은 목표면 다시 계산하지 않으려는 식별자. shelfId: 안내를 띄울 선반
// index: 끼울 순서(다음 계산에서 경계 근처 떨림을 막는 데 쓴다)
type Preview =
  | { kind: 'ok'; layout: ShelfLayout; key: string; shelfId: string; hint: HintKind; index?: number; push?: string }
  | { kind: 'same'; key: string; shelfId: string; hint: HintKind; index?: number }
  | { kind: 'bad'; reason: FailReason | 'outside'; key: string; shelfId: string | null; index?: number };

type Drag = {
  bookId: string;
  shelfId: string; // 꾹 누른 책의 원래 선반
  preview: Preview | null;
  // 잡은 지점: 손가락 x(뷰포트)와 그때 책 상자(기대기 전 곧은 상자)의 가운데·폭(DU). 놓을 자리는 손가락이 움직인 만큼만 옮긴다
  // (기운 책의 화면 윤곽으로 재면 잡자마자 곧은 상자와의 차이만큼 자리가 튄다)
  startVx: number;
  startCenterDU: number;
  widthDU: number; // 끄는 항목(더미면 더미)의 3D 폭: 다른 선반에 놓을 때 왼쪽 끝 = 가운데 - 폭/2
  members: string[]; // 함께 옮겨 가는 책(더미 받침을 잡으면 더미 전체, 아니면 잡은 책 하나)
  hold: Hold; // 보이는 미리보기의 넘어짐과 그것을 받아들인 손가락 위치(넘어짐이 손가락 따라 깜빡이지 않게, preview-hold)
};

type Toast = { text: string; action?: 'undo' | 'retry' | 'retry-library' | 'retry-load' } | null;

// 꾸미기 시점 끌기 영역(선반 앞면 띠)의 최소 높이·위아래 여유(px)
const FRONT_HIT = 48;
const FRONT_PAD = 10;

// 서랍으로 떨어지는 책이 떨어지는 쪽: 표지 책은 선반 앞 끝 너머로(0). 세운 책은 실제로 넘어진 쪽(밀려 넘어진 받침은 서 있던 책이라
// 보이던 자세로는 알 수 없다), 기록이 없으면 기울어 있던 쪽
function dropDir(q: BookPlacement, pose: Book3): -1 | 0 | 1 {
  if (q.pose === 'front') return 0;
  return fallDirOf(q.bookId) ?? ((Math.sign(pose.roll) || Math.sign(q.tilt) || 1) as -1 | 1);
}

function HeaderButton({ size, on, label, onPress, children }: { size: number; on?: boolean; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }, on && styles.circleOn]}>
      {children}
    </Pressable>
  );
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const store = usePlacementStore();
  const { books, layout } = store;
  const { lib, error: libraryError } = useLibrary();
  const m = useShelfMetrics();
  const bookShared = useBookShared(); // 책 그림 공용 자원(글꼴·종이 결). 캔버스 안에는 컨텍스트가 닿지 않아 여기서 읽어 넘긴다
  const { width: winW } = useWindowDimensions();
  const sysReduceMotion = useReducedMotion();
  const appSettings = useSettings();
  // 동작 줄이기: 설정에서 기기 설정을 따르거나 앱에서 켜고 끈다
  const reduceMotion = appSettings.reduceMotion === 'system' ? sysReduceMotion : appSettings.reduceMotion === 'on';

  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null); // 서랍 책(시트)
  const [popId, setPopId] = useState<string | null>(null); // 선반 책(떠오르는 상자)
  const [editId, setEditId] = useState<string | null>(null); // 꾸미기 모드에서 고른 책(하단 조작부)
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [debugGeom, setDebugGeom] = useState(false); // 개발용 형상 보기
  const [selectedYear, setSelectedYear] = useState<number | null>(null); // 헤더 독서 연도
  const [vpH, setVpH] = useState(0);
  // 줄 화면(스크롤 영역) 위 끝의 화면 y: 머리글 뒤 벽(HeaderWall) 높이
  const [vpTop, setVpTop] = useState(0);
  const [editing, setEditing] = useState(false);
  // 꾸미기 조작부가 화면 아래를 차지하는 동안 공통 미니 타이머는 숨긴다
  useEffect(() => {
    miniTimerStore.setHidden(editing);
    return () => miniTimerStore.setHidden(false);
  }, [editing]);
  const [panelH, setPanelH] = useState(0);
  const leanRef = useRef<boolean | undefined>(undefined); // 앞뒤 막대를 끄는 동안의 벽 기대기 상태
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shelfMenuOpen, setShelfMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const dragRef = useRef<Drag | null>(null);
  // 다른 줄로 옮겨 갈 수 있는 책을 미리 올려 둔 줄(책 id → 줄들: 원래 줄 + 손가락이 지나간 줄). 다른 줄로 놓을 자리가 정해지는 순간
  // 그 줄 캔버스를 다시 기록하지 않게 지나가는 동안 올려 두고, 원래 줄에서는 떠난 뒤에도 남는 경로(그림자)가 이어지게 붙잡아 둔다.
  // 끌기(더미면 더미 전체)·메뉴 이동·되돌리기가 쓰고, 놓은 뒤 경로가 끝날 무렵(기다림 최대치 포함) 내린다.
  const [holds, setHolds] = useState<Record<string, string[]>>({});
  const holdsRef = useRef(holds);
  holdsRef.current = holds;
  // 책마다 붙잡은 횟수(세대): 내리는 타이머는 자기가 잡은 세대일 때만 내린다. 앞선 놓기의 타이머가 그 뒤 되돌리기·다시 끌기로
  // 다시 붙잡은 책을 경로 도중에 내리면 원래 줄이 그 책을 빼고 다시 기록되어 그 책 그림자가 한 프레임에 사라진다.
  const holdGen = useRef(new Map<string, number>());
  const holdRows = useCallback((ids: string[], rows: string[]) => {
    for (const id of ids) holdGen.current.set(id, (holdGen.current.get(id) ?? 0) + 1);
    setHolds((h) => {
      const next = { ...h };
      for (const id of ids) next[id] = [...new Set([...(next[id] ?? []), ...rows])];
      return next;
    });
  }, []);
  // 놓은 뒤(또는 메뉴·되돌리기 뒤) 경로가 끝날 무렵 내린다: 다른 줄 경로는 도착 줄 캔버스를 기다리느라 최대 WAIT_MAX 늦게 출발할 수 있다.
  // 붙잡는 쪽은 모두 마지막 holdRows 뒤에 이것을 부르므로, 가장 나중 타이머가 늘 내린다.
  const releaseLater = useCallback((ids: string[]) => {
    const gen = ids.map((id) => holdGen.current.get(id) ?? 0);
    setTimeout(() => {
      setHolds((h) => {
        const busy = dragRef.current?.members ?? [];
        let changed = false;
        const next = { ...h };
        ids.forEach((id, i) => {
          if (next[id] && !busy.includes(id) && (holdGen.current.get(id) ?? 0) === gen[i]) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : h;
      });
    }, WAIT_MAX + PULL_MS * ANIM.slow + 600);
  }, []);
  const lastDragEnd = useRef(0);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const contentH = useSharedValue(0);
  const active = useSharedValue(false);
  const vpOrigin = useSharedValue({ x: 0, y: 0 }); // 뷰포트의 창(window) 좌표
  const pointer = useSharedValue({ x: 0, y: 0 }); // 뷰포트 좌표

  // ---------- 보기 각(내려다보기 4°~8°): 꾸미기에서 선반 앞면을 위아래로 끌어 바꾼다(빈 벽을 끌면 스크롤) ----------
  // 화면 카메라는 공유 값 하나(UI 스레드, 끄는 동안 매 프레임). 그리기·그림자·터치가 모두 이것을 읽는다.
  // 보기 각은 카메라만 바꾼다: 책 배치·줄 간격(3D)은 그대로다. 확정된 각은 보기 설정으로 저장한다.
  const view = useViewStore();
  const pitchSV = useSharedValue(view.pitch);
  const viewGoal = useSharedValue(view.pitch);
  const camSV = useDerivedValue(() => camAt(pitchSV.value));
  useEffect(() => {
    // 불러왔을 때, 백업 복원처럼 밖에서 보기 각이 바뀌었을 때 화면 카메라를 맞춘다(끄고 놓을 때는 애니메이션이 직접 맞춘다)
    if (!view.loaded || viewGoal.value === view.pitch) return;
    pitchSV.value = view.pitch;
    viewGoal.value = view.pitch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.loaded, view.pitch]);
  const savePitch = useCallback((deg: number) => {
    if (deg !== viewStore.get().pitch) viewStore.setPitch(deg);
  }, []);
  // 꾸미기에서 나올 때 조작부 여백이 빠져 목록 끝이 줄어도 지금 스크롤이 잘리지 않게 잠시 남기는 여백
  const [tailPad, setTailPad] = useState(0);

  const shelves = useMemo(() => sortedShelves(layout), [layout]);
  // 저장본을 불러와 처음 그릴 때는 움직이지 않는다(예시 배치에서 저장된 배치로 날아가지 않게)
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!store.loaded) return;
    const id = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(id);
  }, [store.loaded]);

  // 측정 번들: 끌기 한 번 동안 JS 쪽 시간(미리보기 계산, 미리보기 → 커밋, JS 프레임 간격)
  const dragJs = useRef({ preview: [] as number[], commit: [] as number[], js: [] as number[], commitStart: 0, raf: 0, last: 0 });
  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ---------- 표시할 배치와 장면 ----------
  // 확정 배치 또는 끄는 중 미리보기(유효할 때만). 놓을 곳이 없으면 확정 배치 그대로(끄는 책은 제자리, 안내만).
  const { gap, rowfit } = useLocalSearchParams<{ gap?: string; rowfit?: string }>();
  // 줄 위치 계산(rows) 전에 렌더 중에 바로 반영한다(측정 번들 비교안)
  if (PERF_ENABLED && gap !== undefined) LAYOUT.topGap = Number(gap);
  if (PERF_ENABLED && rowfit !== undefined) LAYOUT.rowFit = Number(rowfit);
  const shown = drag?.preview?.kind === 'ok' ? drag.preview.layout : layout;
  const shownShelves = useMemo(() => sortedShelves(shown), [shown]);
  const frames = useShelfScenes(shown, books);
  // 줄 간격은 3D 값(가장 키 큰 책 + 여유)이라 보기 각·꾸미기와 상관없다
  const rowsRef = useRef<RowGeom[]>([]);
  const rows = useMemo(() => {
    const next = computeRows(shown, books, m.scale, vpH, navigation.shelfReserve + insets.bottom);
    const prev = rowsRef.current;
    const same = prev.length === next.length && prev.every((r, i) => r.shelfId === next[i].shelfId && r.top === next[i].top && r.space === next[i].space && r.height === next[i].height && r.baseline === next[i].baseline);
    if (!same) rowsRef.current = next;
    return rowsRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, books, m.scale, vpH, insets.bottom, gap, rowfit]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.shelfId, r])), [rows]);
  const motions = useSceneMotions(useMemo(() => shownShelves.map((sh) => sh.id), [shownShelves]), frames);
  // 장면 위치(UI 스레드): 터치 판정·가림 순서가 읽는다
  const geoOf = (): SceneGeo => ({ rows: rows.map((r) => ({ shelfId: r.shelfId, baseline: r.baseline, dy: rows.length ? (r.baseline - rows[0].baseline) / m.scale : 0, space: r.space })), s: m.scale, originX: m.originX });
  const geoSV = useSharedValue<SceneGeo>(geoOf());
  useLayoutEffect(() => {
    geoSV.value = geoOf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, m]);
  // 다른 줄로 옮겨 가는 책: 그 줄에서 지금 보이는 자세를 새 줄 좌표로(새 줄은 거기서 이어서 들어온다)
  const prevShown = useRef(shown);
  const transitRef = useRef(new Map<string, number>());
  const moves = useRef<{ id: string; from: string }[]>([]);
  // 받침을 잃고 선반에서 떨어져 서랍으로 간 책(끄는 동안의 미리보기 포함, 직접 서랍에 넣은 책은 빼고): 그 줄에서 보이던 자세에서
  // 넘어지며 사라지는 동안(planner dropTrack) 그 줄 캔버스에 남겨 둔다. 다시 선반으로 돌아오면(미리보기가 바뀌면) 바로 거둔다
  const dropRef = useRef(new Map<string, { shelfId: string; from: Book3; d: -1 | 0 | 1; until: number }>());
  const [fallTick, setFallTick] = useState(0);
  const arrivals = useMemo(() => {
    const out: Record<string, Record<string, Book3>> = {};
    const before = prevShown.current;
    moves.current = [];
    if (before === shown) return out;
    for (const id of [...dropRef.current.keys()]) if (shown.placements.some((p) => p.bookId === id)) dropRef.current.delete(id);
    if (!reduceMotion)
      for (const q of before.placements) {
        if (shown.placements.some((p) => p.bookId === q.bookId) || !shown.drawer.includes(q.bookId)) continue;
        if (!dragRef.current && !store.fellIds.includes(q.bookId)) continue;
        const from = motions.find((e) => e.shelfId === q.shelfId);
        const pose = from ? displayedPoses(from.m)[q.bookId] : undefined;
        if (!pose) continue;
        // 줄 시계는 DROP_MS보다 길 수 있다(차례로 넘어지는 경로·앞으로 빼는 경로와 함께): 넉넉히
        dropRef.current.set(q.bookId, { shelfId: q.shelfId, from: pose, d: dropDir(q, pose), until: Date.now() + DROP_MS * ANIM.slow * 1.5 + 300 });
      }
    for (const p of shown.placements) {
      const q = before.placements.find((x) => x.bookId === p.bookId);
      if (!q || q.shelfId === p.shelfId) continue;
      const from = motions.find((e) => e.shelfId === q.shelfId);
      const src = rowOf.get(q.shelfId);
      const dst = rowOf.get(p.shelfId);
      if (!from || !src || !dst) continue;
      const pose = displayedPoses(from.m)[p.bookId];
      if (!pose) continue;
      const dy = (dst.baseline - src.baseline) / m.scale;
      (out[p.shelfId] ??= {})[p.bookId] = { ...pose, t: { x: pose.t.x, y: pose.t.y + dy, z: pose.t.z } };
      moves.current.push({ id: p.bookId, from: q.shelfId });
      // 옮겨 가는 동안 이동 캔버스에 올려 둔다(경로가 끝나고 조금 뒤 내린다. 도착 줄 캔버스를 기다리는 최대치까지 넉넉히)
      transitRef.current.set(p.bookId, Date.now() + WAIT_MAX + PULL_MS * ANIM.slow + 400);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  // 이번 배치에서 다른 줄로 옮겨 가는 책(같은 배열이면 같은 객체)
  const leaving = useMemo(
    () => moves.current.filter((mv) => !holds[mv.id]?.includes(mv.from)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arrivals],
  );
  // 이동 캔버스에 미리 올려 둘 책: 다른 줄로 옮겨 갈 수 있는 책(끄는 책, 꾸미기에서 고른 책, 정보 상자의 책)과 방금 옮겨 간 책.
  // 캔버스에 책을 올리는 일은 JS에서 늦게 끝나므로, 옮기는 순간이 아니라 그 전에 올려 둔다.
  const [transitTick, setTransitTick] = useState(0);
  const transitIds = useMemo(() => {
    const now = Date.now();
    for (const [id, until] of transitRef.current) if (until < now) transitRef.current.delete(id);
    const ids = new Set(transitRef.current.keys());
    if (drag) for (const id of drag.members) ids.add(id);
    // 붙잡아 둔 책(끌기·메뉴·되돌리기로 다른 줄로 갈 수 있는 책): 옮기기 전에 이동 캔버스에 올려 두어야 넘겨줄 때 그릴 수 있다
    for (const id of Object.keys(holds)) ids.add(id);
    if (editing && editId) ids.add(editId);
    if (popId) ids.add(popId);
    return [...ids].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals, transitTick, drag?.bookId, holds, editing, editId, popId]);
  useEffect(() => {
    if (!transitRef.current.size) return;
    const next = Math.min(...transitRef.current.values()) - Date.now();
    const id = setTimeout(() => setTransitTick((k) => k + 1), Math.max(50, next));
    return () => clearTimeout(id);
  }, [transitIds]);
  // 떨어져 사라진 책을 줄 캔버스에서 내린다
  const drops = useMemo(() => {
    const now = Date.now();
    const out: Record<string, Drops> = {};
    for (const [id, dr] of dropRef.current) {
      if (dr.until < now) dropRef.current.delete(id);
      else (out[dr.shelfId] ??= {})[id] = { from: dr.from, d: dr.d };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals, fallTick]);
  useEffect(() => {
    if (!dropRef.current.size) return;
    const next = Math.min(...[...dropRef.current.values()].map((d) => d.until)) - Date.now();
    const id = setTimeout(() => setFallTick((k) => k + 1), Math.max(50, next + 20));
    return () => clearTimeout(id);
  }, [drops]);
  useLayoutEffect(() => {
    if (PERF_ENABLED && dragJs.current.commitStart) {
      dragJs.current.commit.push(performance.now() - dragJs.current.commitStart);
      dragJs.current.commitStart = 0;
    }
    if (TL.on) tl('home-commit');
    prevShown.current = shown;
    // 줄마다 짠 경로를 한 번에 UI로(다른 줄로 옮겨 가는 책이 두 권이나 빈 프레임으로 보이지 않게)
    flushApply();
  });

  // 꾸미는 중에는 되돌리기가 상단에 있으므로 '옮겼어요 · 되돌리기' 알림은 띄우지 않는다
  const editingRef = useRef(false);
  const showToast = useCallback((t: Toast) => {
    if (editingRef.current && t?.action === 'undo') return;
    setToast(t);
  }, []);
  useEffect(() => {
    if (!toast || toast.action === 'retry' || toast.action === 'retry-library' || toast.action === 'retry-load') return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (store.save === 'error') setToast({ text: ko.saveError, action: 'retry' });
    if (store.save === 'read-error') setToast({ text: '책장을 불러오지 못했어요', action: 'retry-load' });
  }, [store.save]);
  useEffect(() => {
    if (libraryError) setToast({ text: '기록을 저장하지 못했어요', action: 'retry-library' });
  }, [libraryError]);
  // 받침을 잃고 선반에서 떨어져 서랍에 들어간 책(끌기·메뉴·꾸미기 어느 확정이든): 꾸미는 중이면 조작부에, 아니면 알림(되돌리기)으로.
  // 확정한 손길의 알림·조작부 문구를 덮도록 그린 뒤에 띄운다
  useEffect(() => {
    if (!store.fell) return;
    const text = ko.fellToDrawer(store.fell);
    placementStore.clearFell();
    if (editingRef.current) setEditMsg(text);
    else setToast({ text, action: 'undo' });
  }, [store.fell]);
  useEffect(() => {
    if (!store.notice) return;
    setToast({ text: ko.refitMoved(store.notice) });
    placementStore.clearNotice();
  }, [store.notice]);

  const commit = useCallback(
    (r: Result, text: string = ko.moved): string | null => {
      if (!r.ok) return ko.fail[r.reason] || null;
      if (!placementStore.commit(r.layout)) return ko.fail['no-space'];
      // 받침을 잃고 선반에서 떨어진 책은 아래 store.fell 효과가 알린다(이 알림을 덮는다)
      showToast({ text, action: 'undo' });
      return null;
    },
    [showToast],
  );

  // ---------- 미리보기 ----------
  const rowIndexAt = (cy: number) => {
    if (!rows.length || cy < rows[0].top) return -1;
    const i = rowAt(rows, cy);
    return i === -1 ? rows.length : i;
  };

  const detached = useRef<{ layout: ShelfLayout; id: string; value: ShelfLayout } | null>(null);
  // 측정 번들: 미리보기에 쓰인 밀기 규칙과 잡은 책 유지 여부(자리·깊이·자세), 이웃이 움직인 거리를 적는다(영상과 함께 확인)
  const pushInfo = (d: Drag, next: ShelfLayout, shelfId: string, wantX: number | undefined) => {
    const xb = bookXs(layout, books);
    const xa = bookXs(next, books);
    let L = 0;
    let R = 0;
    const moves: string[] = [];
    for (const q of next.placements) {
      if (q.shelfId !== shelfId || q.bookId === d.bookId) continue;
      const dx = (xa.get(q.bookId) ?? 0) - (xb.get(q.bookId) ?? 0);
      if (Math.abs(dx) < 0.05) continue;
      if (dx < 0) L++;
      else R++;
      moves.push(`${q.bookId}${dx > 0 ? '+' : ''}${dx.toFixed(1)}`);
    }
    const side = L && R ? 'split' : L ? 'left' : R ? 'right' : 'none';
    const a = placementOf(layout, d.bookId);
    const b = placementOf(next, d.bookId);
    console.log('[push]', side, `want=${wantX ?? '-'} got=${(xa.get(d.bookId) ?? 0).toFixed(2)} depth=${a?.depth ?? 0}->${b?.depth ?? 0} pose=${a?.pose}->${b?.pose}`, moves.join(' '));
    return side;
  };

  const computePreview = (d: Drag, vx: number, vy: number, scroll: number): Preview => {
    const cy = vy + scroll;
    const index = rowIndexAt(cy);
    const centerDU = d.startCenterDU + (vx - d.startVx) / m.scale;
    const withinX = centerDU > -SHELF.sideMargin && centerDU < SHELF.innerLeft + SHELF_USABLE_WIDTH + SHELF.innerRight + SHELF.sideMargin;
    const reuse = (key: string) => (d.preview && d.preview.key === key ? d.preview : null);
    if (!withinX || index < 0) return reuse('outside') ?? { kind: 'bad', reason: 'outside', key: 'outside', shelfId: null };
    if (index >= shelves.length) return reuse('outside') ?? { kind: 'bad', reason: 'outside', key: 'outside', shelfId: null };
    const shelfId = shelves[index].id;
    // 늘 확정 배치(드래그 시작 배치)에서 계산한다: 직전 미리보기에 이동량을 쌓지 않고, 후보를 바꾸면 밀렸던 책은 원래 자리로
    if (shelfId === d.shelfId) {
      const t = findSwapTarget(layout, books, d.bookId, centerDU);
      const at = t.kind === 'place' ? t.index : undefined;
      const key = `same:${JSON.stringify(t)}`;
      const hit = reuse(key);
      if (hit) return hit;
      const r = applySwapTarget(layout, books, d.bookId, t);
      // 미리보기는 확정과 같은 모습이어야 한다: 기대기(받침이 떠나면 바로 섬, 새 이웃에 기댐)까지 그 줄에서 다시 풀어 둔다(놓는 순간 각도가 튀지 않게)
      if (r.ok) return { kind: 'ok', layout: withLeans(r.layout, books, shelfId), key, shelfId, hint: t.kind, index: at, push: PUSH_DEBUG.on && t.kind === 'place' ? pushInfo(d, r.layout, shelfId, t.x) : undefined };
      if (r.reason === 'no-change') return { kind: 'same', key, shelfId, hint: 'self', index: at };
      return { kind: 'bad', reason: r.reason, key, shelfId, index: at };
    }
    const p = placementOf(layout, d.bookId)!;
    // 끄는 책을 뺀 배치는 끌기 한 번에 한 번만 계산한다(확정 배치가 그대로인 동안 같다)
    if (!detached.current || detached.current.layout !== layout || detached.current.id !== d.bookId) detached.current = { layout, id: d.bookId, value: detach(layout, d.bookId, books) };
    const t = findDropTarget(detached.current.value, books, shelfId, centerDU, p.pose, d.widthDU);
    const at = t.kind === 'insert' ? t.index : undefined;
    const key = `other:${JSON.stringify(t)}`;
    const hit = reuse(key);
    if (hit) return hit;
    const r = moveBook(layout, books, d.bookId, t);
    if (r.ok) return { kind: 'ok', layout: withLeans(withLeans(r.layout, books, d.shelfId), books, shelfId), key, shelfId, hint: t.kind === 'stack' ? 'stack' : 'place', index: at, push: PUSH_DEBUG.on && t.kind === 'insert' ? pushInfo(d, r.layout, shelfId, t.x) : undefined };
    return { kind: 'bad', reason: r.reason, key, shelfId, index: at };
  };

  // 같은 줄 안에서 다른 책의 넘어짐이 바뀌는 미리보기는 손가락이 조금 더 가거나 멈춘 뒤에 받아들인다(그동안 앞 미리보기 그대로).
  // rest: 손가락이 HOLD_MS 동안 멈춰 있다
  const holdPreview = (d: Drag, next: Preview, vx: number, rest = false): { preview: Preview; hold: Hold } => {
    const x = d.startCenterDU + (vx - d.startVx) / m.scale;
    const sig = next.kind === 'ok' ? fallSig(layout, next.layout, d.bookId) : '';
    const cur = d.preview;
    if (!cur || cur.kind === 'bad' || next.kind === 'bad' || cur.shelfId !== next.shelfId) return { preview: next, hold: { sig, at: x } };
    const r = stepHold(d.hold, sig, x, rest);
    return { preview: r.take ? next : cur, hold: r.hold };
  };
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRest = () => {
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = null;
  };

  useEffect(() => {
    bootMark('home-mount', `books=${Object.keys(books).length}`);
    watchResponsive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 책 찾기에서 고른 책: 그 선반으로 옮겨 정보 상자로 강조(배치는 그대로)
  const focusRef = useRef<(id: string) => void>(() => {});
  focusRef.current = (id: string) => {
    const p = placementOf(layout, id);
    const row = p && rows.find((r) => r.shelfId === p.shelfId);
    if (!row) return;
    setEditingKeep(false);
    setPopId(null);
    scrollRef.current?.scrollTo({ y: Math.max(0, row.top - 60), animated: !reduceMotion });
    setTimeout(() => {
      setSelectedId(id);
      setPopId(id);
    }, reduceMotion ? 50 : 450);
  };
  useFocusEffect(
    useCallback(() => {
      const run = () => {
        const id = uiBus.takeFocus();
        if (id) setTimeout(() => focusRef.current(id), 60);
      };
      run();
      return uiBus.subscribe(run);
    }, []),
  );

  // ---------- 제스처 콜백(JS) ----------
  // pick: UI 스레드가 지금 보이는 자세·가림 순서로 고른 책(없으면 null)
  const onTap = (pick: Pick) => {
    if (Date.now() - lastDragEnd.current < 350 || dragRef.current) return;
    if (editing) {
      // 꾸미는 중: 짧게 누르면 그 책을 고른다(정보 상자는 띄우지 않는다)
      setEditMsg(null);
      setEditId(pick ? pick.bookId : null);
      return;
    }
    if (!pick) {
      setPopId(null);
      setSelectedId(null);
      return;
    }
    setSelectedId(pick.bookId);
    setPopId(pick.bookId);
  };

  const beginDrag = (pick: Pick, x: number, y: number, absX: number, absY: number, scroll: number) => {
    if (!pick) return;
    const p = placementOf(layout, pick.bookId);
    if (!p || p.shelfId !== pick.shelfId) return;
    // 꾹 눌러 책을 집으면 꾸미기 모드가 시작된다(줄 간격은 3D 값이라 줄이 움직이지 않는다)
    setEditingKeep(true);
    setPopId(null);
    setEditMsg(null);
    setEditId(pick.bookId);
    // 잡은 항목(더미의 받침이면 더미 전체)의 곧은 3D 상자: 가운데와 폭
    const items = shelfItems(layout, p.shelfId);
    const item = items.find((it) => it.bookIds.includes(pick.bookId));
    const bx = boxOf(layout, books, pick.bookId);
    let lo = Infinity;
    let hi = -Infinity;
    if (bx) for (const c of corners(fromPlaced(bx))) {
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
    }
    // 더미 받침을 잡으면 더미 전체가 함께 옮겨 간다(moveBook → moveStack)
    const members = item && item.stacked && item.bookIds[0] === pick.bookId ? [...item.bookIds] : [pick.bookId];
    const d: Drag = {
      bookId: pick.bookId,
      shelfId: p.shelfId,
      preview: { kind: 'same', key: `same:${JSON.stringify({ kind: 'self' })}`, shelfId: p.shelfId, hint: 'self' },
      startVx: x,
      startCenterDU: (lo + hi) / 2,
      widthDU: item ? itemWidth(item, layout, books) : hi - lo,
      members,
      hold: { sig: '', at: (lo + hi) / 2 },
    };
    vpOrigin.value = { x: absX - x, y: absY - (y - scroll) };
    pointer.value = { x, y: y - scroll };
    active.value = true;
    autoScroll.setActive(true);
    if (settingsStore.get().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedId(null);
    holdRows(members, [p.shelfId]);
    updateDrag(d);
    if (PERF_ENABLED) dragPerfStart();
  };

  // 미리보기는 한 프레임에 한 번(손가락 이벤트가 몰려도 마지막 위치만 계산한다)
  const movePending = useRef<{ vx: number; vy: number; scroll: number } | null>(null);
  const moveFrame = useRef(0);
  const moveDrag = (vx: number, vy: number, scroll: number, rest = false) => {
    movePending.current = { vx, vy, scroll };
    if (!rest) clearRest();
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      const d = dragRef.current;
      const mv = movePending.current;
      if (!d || !mv) return;
      const c0 = PERF_ENABLED ? performance.now() : 0;
      const next = computePreview(d, mv.vx, mv.vy, mv.scroll);
      const held = holdPreview(d, next, mv.vx, rest);
      const preview = held.preview;
      if (PERF_ENABLED) dragJs.current.preview.push(performance.now() - c0);
      // 넘어짐이 바뀌는 미리보기를 붙잡았으면, 손가락이 그대로 HOLD_MS 멈춰 있을 때 받아들인다
      if (preview !== next) {
        clearRest();
        restTimer.current = setTimeout(() => {
          restTimer.current = null;
          if (dragRef.current && movePending.current === mv) jsRef.current.moveDrag(mv.vx, mv.vy, mv.scroll, true);
        }, HOLD_MS);
      }
      const h = holdsRef.current;
      if (preview.shelfId && h[d.bookId] && !h[d.bookId].includes(preview.shelfId)) {
        if (TL.on) tl(`ghost ${d.bookId}@${preview.shelfId}`);
        holdRows(d.members, [preview.shelfId]);
        // 다른 줄로 옮겨 갈 수 있게 됐다: 이동 캔버스가 이 책을 미리 그려 둔다(경로 첫 프레임에 첫 그림 비용이 몰리지 않게)
        warmSV.value = d.bookId;
      }
      if (preview === d.preview) {
        if (held.hold !== d.hold) dragRef.current = { ...d, hold: held.hold };
        return;
      }
      if (TL.on) tl(`preview ${preview.kind}:${preview.shelfId}:${preview.index ?? ''} calc=${(performance.now() - c0).toFixed(1)}`);
      if (PERF_ENABLED) dragJs.current.commitStart = performance.now();
      updateDrag({ ...d, preview, hold: held.hold });
    });
  };

  const finishDrag = () => {
    lastDragEnd.current = Date.now();
    clearRest();
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    autoScroll.setActive(false);
    const members = dragRef.current?.members ?? [];
    warmSV.value = null;
    releaseLater(members);
    updateDrag(null);
    if (PERF_ENABLED) dragPerfStop();
  };

  // 놓기: 미리보기가 유효하면 그대로 확정·저장(화면은 이미 그 자리). 아니면 확정 배치(원래 자리)에 그대로 있다.
  const endDrag = (cancelled: boolean) => {
    const d = dragRef.current;
    active.value = false;
    if (!d) return;
    // 마지막 손가락 위치의 미리보기를 먼저 반영한다(프레임 안에 밀린 이동이 있으면. 넘어짐이 바뀌는 미리보기는 끄는 동안처럼 붙잡는다: 보이는 대로 놓인다)
    const mv = movePending.current;
    let preview = d.preview;
    if (!cancelled && mv && moveFrame.current) preview = holdPreview(d, computePreview(d, mv.vx, mv.vy, mv.scroll), mv.vx).preview;
    lastDragEnd.current = Date.now();
    if (TL.on) tl(`release ${preview?.kind ?? 'none'}`);
    if (!cancelled && preview?.kind === 'ok') {
      const c0 = PERF_ENABLED ? performance.now() : 0;
      const ok = placementStore.commit(preview.layout);
      if (TL.on) tl(`store-commit ${(performance.now() - c0).toFixed(1)}ms ${ok ? 'ok' : 'fail'}`);
      if (ok) showToast({ text: ko.moved, action: 'undo' });
      else showToast({ text: ko.fail['no-space'] });
    } else if (!cancelled && preview?.kind === 'bad') {
      showToast({ text: ko.fail[preview.reason] || ko.fail.outside });
    }
    if (settingsStore.get().haptics) void Haptics.selectionAsync().catch(() => {});
    finishDrag();
    // 놓은 뒤에도 꾸미기 모드는 유지하고, 놓은 책을 고른 상태로 둔다(조작부에 가리면 보이게 스크롤)
    setEditId(d.bookId);
    reveal.current = true;
    setDropTick((k) => k + 1);
  };

  // 화면 이탈·앱 비활성화: 임시 배치를 버리고 확정 상태 유지(미리 그리기·자동 스크롤·붙잡아 둔 줄·측정도 끝낸다)
  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return;
    active.value = false;
    lastDragEnd.current = Date.now();
    clearRest();
    cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    autoScroll.setActive(false);
    warmSV.value = null;
    releaseLater(dragRef.current.members);
    updateDrag(null);
    // 측정 번들: 끌기를 시작할 때 늘 측정을 켜므로(beginDrag) 여기서도 늘 끈다
    if (PERF_ENABLED) dragPerfStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useFocusEffect(useCallback(() => cancelDrag, [cancelDrag]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') cancelDrag();
    });
    return () => sub.remove();
  }, [cancelDrag]);

  // ---------- 제스처 ----------
  // 제스처 객체는 한 번만 만든다(다시 그릴 때마다 새로 만들면 끄는 도중 다시 붙으며 제스처가 끊긴다). JS 쪽 동작은 ref로 최신 것을 부른다.
  // 어떤 책을 눌렀는지는 UI 스레드에서 정한다(pickAt): 지금 그려진 자세·카메라·가림 순서 그대로라 보이는 책이 잡힌다.
  const jsRef = useRef({ beginDrag, moveDrag, endDrag, onTap });
  jsRef.current = { beginDrag, moveDrag, endDrag, onTap };
  const jsBegin = useCallback((pick: Pick, x: number, y: number, ax: number, ay: number, sc: number) => jsRef.current.beginDrag(pick, x, y, ax, ay, sc), []);
  const jsMove = useCallback((x: number, y: number, sc: number) => jsRef.current.moveDrag(x, y, sc), []);
  const jsEnd = useCallback((cancel: boolean) => jsRef.current.endDrag(cancel), []);
  const jsTap = useCallback((pick: Pick) => jsRef.current.onTap(pick), []);
  const SLOP_DU = 3; // 손가락 여유: 윤곽 밖 이만큼(설계 단위)까지는 가장 가까운 책
  const downPick = useSharedValue<Pick>(null); // 누른 순간 보인 책
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(motion.longPress)
        // 누른 곳에 보이는 책이 없으면(빈 벽·선반 판) 바로 포기: 길게 눌러도 스크롤·시점 끌기가 막히지 않는다
        .onTouchesDown((e, mgr) => {
          const t = e.allTouches[0];
          const g = geoSV.value;
          const pick = t ? pickAt(motions, g, camSV.value, t.x, t.y, SLOP_DU * g.s) : null;
          downPick.value = pick;
          if (!pick) mgr.fail();
        })
        .onStart((e) => {
          const g = geoSV.value;
          // 집는 순간 손가락 아래 책(움직이는 중이었으면 누른 순간 보인 책)
          const pick = pickAt(motions, g, camSV.value, e.x, e.y, SLOP_DU * g.s) ?? downPick.value;
          scheduleOnRN(jsBegin, pick, e.x, e.y, e.absoluteX, e.absoluteY, scrollY.value);
        })
        .onUpdate((e) => {
          if (!active.value) return;
          const vx = e.absoluteX - vpOrigin.value.x;
          const vy = e.absoluteY - vpOrigin.value.y;
          pointer.value = { x: vx, y: vy };
          scheduleOnRN(jsMove, vx, vy, scrollY.value);
        })
        .onFinalize((_e, success) => {
          if (active.value) tlu('finger-up');
          active.value = false;
          scheduleOnRN(jsEnd, !success);
        }),
    [jsBegin, jsMove, jsEnd, scrollY, active, vpOrigin, pointer, motions, geoSV, camSV, downPick],
  );
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(300)
        .maxDistance(10)
        .onEnd((e, success) => {
          if (!success) return;
          const g = geoSV.value;
          scheduleOnRN(jsTap, pickAt(motions, g, camSV.value, e.x, e.y, SLOP_DU * g.s));
        }),
    [jsTap, motions, geoSV, camSV],
  );
  const onHandleRef = useRef<(phase: 'begin' | 'move' | 'end', dx: number, dy: number) => void>(() => {});
  const handleJS = useCallback((phase: 'begin' | 'move' | 'end', dx: number, dy: number) => onHandleRef.current(phase, dx, dy), []);
  const headPan = useMemo(
    () =>
      Gesture.Pan()
        // 손잡이에 닿는 순간 바로 잡는다(누르고 잠깐 멈춰도 책 끌기 길게 누르기가 끼어들지 않게)
        .manualActivation(true)
        .onTouchesDown((_e, manager) => {
          manager.activate();
        })
        .onBegin(() => {
          scheduleOnRN(handleJS, 'begin', 0, 0);
        })
        .onUpdate((e) => {
          scheduleOnRN(handleJS, 'move', e.translationX, e.translationY);
        })
        .onFinalize(() => {
          scheduleOnRN(handleJS, 'end', 0, 0);
        }),
    [handleJS],
  );
  // 목록 스크롤(네이티브 ScrollView). 손잡이·선반 앞면(시점)에서 시작한 끌기가 잡혀 있는 동안은 스크롤이 기다린다.
  const scrollNative = useMemo(() => Gesture.Native(), []);
  // 꾸미기 모드 시점 끌기: 누른 곳으로 역할을 정하고 놓을 때까지 유지한다.
  //   책 몸통 → 책 조작(탭·길게 눌러 옮기기), 고른 책 머리 손잡이 → 손잡이, 선반 앞면(넉넉한 띠) → 시점, 그 밖의 빈 벽 → 스크롤.
  // 선반 앞면에서 누르면 바로 잡아(스크롤이 끼어들지 않게) 손가락이 책 위를 지나가도 시점 조절로 남는다.
  // 판정은 UI 스레드에서 지금 장면으로 한다: 앞에 보이는 책이면 책, 판 앞면 띠(지금 카메라로 투영, 최소 48px)면 시점.
  const handleSV = useSharedValue<{ shelfId: string; bookId: string } | null>(null);
  const handleKey = editing && !drag && editId && placementOf(layout, editId)?.pose === 'front' ? `${placementOf(layout, editId)!.shelfId}|${editId}` : '';
  useEffect(() => {
    const [shelfId, bookId] = handleKey ? handleKey.split('|') : [];
    handleSV.value = handleKey ? { shelfId, bookId } : null;
  }, [handleKey, handleSV]);
  const viewStart = useSharedValue({ p0: VIEW_PITCH_MIN, started: false });
  const reduceMotionSV = useSharedValue(reduceMotion);
  const editingSV = useSharedValue(editing);
  useEffect(() => {
    reduceMotionSV.value = reduceMotion;
    editingSV.value = editing;
  }, [reduceMotion, editing, reduceMotionSV, editingSV]);
  const viewPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e, mgr) => {
          const t = e.allTouches[0];
          if (!t || !editingSV.value) {
            mgr.fail();
            return;
          }
          const g = geoSV.value;
          const cam = camSV.value;
          // 표지 책 손잡이 위면 손잡이가 가져간다
          const h = handleSV.value;
          if (h) {
            for (const mo of motions) {
              if (mo.shelfId !== h.shelfId) continue;
              for (const row of g.rows) {
                if (row.shelfId !== h.shelfId) continue;
                const hp = handlePoint(mo.m, h.bookId, cam, rowPx(g, row));
                if (hp && Math.abs(t.x - hp.x) <= HANDLE_HIT / 2 && Math.abs(t.y - hp.y) <= HANDLE_HIT / 2) {
                  mgr.fail();
                  return;
                }
              }
            }
          }
          // 앞에 보이는 책이면(책 조작과 같은 여유로 판정) 책 조작: 한 자리가 책과 시점 두 역할을 함께 갖지 않게
          if (pickAt(motions, g, cam, t.x, t.y, SLOP_DU * g.s)) {
            mgr.fail();
            return;
          }
          let front = false;
          for (const row of g.rows) {
            const band = plankFrontBand(row, g, cam, FRONT_HIT, FRONT_PAD);
            if (t.y >= band.y0 && t.y <= band.y1 && t.x >= g.originX + PLANK_INSET * g.s && t.x <= g.originX + (DESIGN_WIDTH - PLANK_INSET) * g.s) front = true;
          }
          if (!front) {
            mgr.fail();
            return;
          }
          mgr.activate();
        })
        .onStart(() => {
          // 정착 중에 다시 잡으면 지금 각에서 이어서
          cancelAnimation(pitchSV);
          viewStart.value = { p0: pitchSV.value, started: true };
        })
        .onUpdate((e) => {
          pitchSV.value = Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, viewStart.value.p0 + e.translationY * VIEW_DEG_PER_DP));
        })
        // 끝나거나 다른 제스처에 넘어가도(손을 뗀 것과 같게) 한 시점에 정착
        .onFinalize((e) => {
          const d = viewStart.value;
          viewStart.value = { p0: d.p0, started: false };
          if (!d.started) return;
          // 마지막 손가락 위치·속도는 끝 이벤트에서(프레임이 밀려 onUpdate가 덜 불렸어도 실제로 끈 만큼)
          const now = Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, d.p0 + e.translationY * VIEW_DEG_PER_DP));
          const target = viewSettle(viewGoal.value, d.p0, now, e.velocityY);
          viewGoal.value = target;
          pitchSV.value = withTiming(target, { duration: reduceMotionSV.value ? 0 : 260, easing: Easing.out(Easing.cubic) });
          scheduleOnRN(savePitch, target);
        })
        .blocksExternalGesture(scrollNative),
    [editingSV, viewStart, pitchSV, viewGoal, reduceMotionSV, savePitch, scrollNative, motions, geoSV, camSV, handleSV],
  );
  useMemo(() => {
    pan.requireExternalGestureToFail(headPan);
    tap.requireExternalGestureToFail(headPan);
    headPan.blocksExternalGesture(scrollNative);
    // 손잡이를 잡은 동안 시점 끌기는 기다린다(손잡이가 선반 앞면 띠와 겹쳐도 둘이 함께 움직이지 않게)
    headPan.blocksExternalGesture(viewPan);
  }, [pan, tap, headPan, scrollNative, viewPan]);
  const gesture = useMemo(() => Gesture.Simultaneous(viewPan, Gesture.Race(pan, tap)), [viewPan, pan, tap]);

  // 가장자리 자동 스크롤(끄는 동안만 켠다). 스크롤하면서도 최신 좌표로 놓을 자리를 다시 계산한다.
  const autoScroll = useFrameCallback(() => {
    if (!active.value) return;
    const y = pointer.value.y;
    const edge = motion.autoScrollEdge;
    let delta = 0;
    if (y < edge) delta = -motion.autoScrollMaxSpeed * Math.min(1, (edge - y) / edge);
    else if (y > viewportH.value - edge) delta = motion.autoScrollMaxSpeed * Math.min(1, (y - (viewportH.value - edge)) / edge);
    if (delta === 0) return;
    const max = Math.max(0, contentH.value - viewportH.value);
    const next = Math.max(0, Math.min(max, scrollY.value + delta));
    if (next === scrollY.value) return;
    scrollY.value = next;
    scrollTo(scrollRef, 0, next, false);
    scheduleOnRN(jsMove, pointer.value.x, pointer.value.y, next);
  }, false);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // ---------- 성능 측정(EXPO_PUBLIC_PERF=1 번들에서만 메뉴에 보인다) ----------
  // 같은 배치에서 그리기 단계를 바꿔 가며: ① 가만히 있을 때 ② 시점 4°→8°→4° 두 번(UI 스레드만, React 없음)의 실제 프레임 간격,
  // ③ 투영 계산만(그리기 없이 같은 함수), ④ 시점 확정 후 React 갱신(렌더·커밋) 시간과 그 뒤 프레임.
  const [perfKey, setPerfKey] = useState(0);
  const [shelfView, setShelfViewState] = useState<(typeof SHELF_VIEWS)[number]>('전체');
  // 측정 번들에서만: chaekjang:///?sv=0~4 로 선반 보기를 바로 고른다(비교 캡처용)
  // lv=<그리기 단계>(예: full, cast)로 단계만 바꿔 같은 화면을 비교한다
  const { sv, lv, sh, lt, cam: camDebug, pitch: pitchParam, slow, transit, geom, pushdbg, mark } = useLocalSearchParams<{ sv?: string; lv?: string; sh?: string; lt?: string; cam?: string; pitch?: string; slow?: string; transit?: string; geom?: string; pushdbg?: string; mark?: string }>();
  // 측정 번들: ?mark=b11,b12 처럼 고른 책을 한 가지 색(자홍, 둘째는 청록)으로만 그린다. 화면 녹화에서 그 책이 프레임마다 몇 군데에
  // 얼마나 보이는지 세어 빈 프레임·두 권 보임을 찾는다(장면에 넘기는 그림용 사본만 바꾼다. 배치 계산·저장은 그대로).
  const sceneBooks = useMemo(() => {
    if (!PERF_ENABLED || !mark) return books;
    const out = { ...books };
    mark.split(',').forEach((id, i) => {
      const b = books[id];
      const c = i === 0 ? '#FF00FF' : '#00FFFF';
      if (b) out[id] = { ...b, themeColor: c, body: undefined, quotes: 0, art: { ...b.art, inkColor: c, ribbon: c } };
    });
    return out;
  }, [books, mark]);
  // 측정 번들: ?geom=1 로 형상 보기(3D 상자 모서리·받침·계산상 선반)를 켜고 끈다(캡처 스크립트용)
  useEffect(() => {
    if (PERF_ENABLED && geom !== undefined) setDebugGeom(geom === '1');
  }, [geom]);
  if (PERF_ENABLED && slow !== undefined) ANIM.slow = Math.max(1, Number(slow) || 1);
  if (PERF_ENABLED && transit !== undefined) TRANSIT_DEBUG.on = transit === 'show';
  if (PERF_ENABLED && pushdbg !== undefined) PUSH_DEBUG.on = pushdbg === '1';
  // 측정 번들: ?pitch=3 처럼 저장된 보기 각을 바로 정한다(비교 캡처를 같은 각에서 시작)
  useEffect(() => {
    if (!PERF_ENABLED || pitchParam === undefined || !view.loaded) return;
    const deg = Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, Number(pitchParam)));
    pitchSV.value = deg;
    viewGoal.value = deg;
    savePitch(deg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchParam, view.loaded]);
  // 측정 번들: ?cam=1 이면 지금 프레임에 실제로 쓰는 시점 값(UI 스레드 카메라)을 화면 위에 적는다
  const [camNow, setCamNow] = useState('');
  useAnimatedReaction(
    () => Math.round(pitchSV.value * 100) / 100,
    (deg, prev) => {
      if (camDebug !== '1' || deg === prev) return;
      scheduleOnRN(setCamNow, `적용 ${deg.toFixed(2)}° · ky ${camSV.value.ky.toFixed(4)} · kx ${camSV.value.kx}`);
    },
    [camDebug],
  );
  const { demoboot, menutl, perfrun } = useLocalSearchParams<{ demoboot?: string; menutl?: string; perfrun?: string }>();
  // 측정 번들: ?perfrun=full 처럼 메뉴를 거치지 않고 그 단계의 시점 전환 측정을 한 번 돌린다(전후 비교 스크립트용, 같은 단계를 다시 돌리려면 full.2처럼)
  const perfRan = useRef('');
  useEffect(() => {
    if (!PERF_ENABLED || !perfrun || !store.loaded || perfRan.current === perfrun) return;
    perfRan.current = perfrun;
    const id = setTimeout(() => void runPerfRef.current(perfrun.split('.')[0] as PerfLevel), 1500);
    return () => clearTimeout(id);
  }, [perfrun, store.loaded]);
  if (PERF_ENABLED && menutl !== undefined) MENU_FLAGS.translucent = menutl === '1';
  useEffect(() => {
    if (!PERF_ENABLED || demoboot === undefined) return;
    void Storage.setItem(DEMO_BOOT_KEY, demoboot === '1' || demoboot === 'mockup' ? demoboot : '0');
    placementStore.setDemo(demoboot === '1' || demoboot === 'mockup', demoboot === 'mockup' ? 'mockup' : 'sample');
  }, [demoboot]);
  useEffect(() => {
    if (!PERF_ENABLED || lt === undefined) return;
    setLightOff(lt);
    setPerfKey((k) => k + 1);
  }, [lt]);
  useEffect(() => {
    if (!PERF_ENABLED || !sh || !SHELF_MODES.includes(sh as ShelfMode)) return;
    setShelfMode(sh as ShelfMode);
    setPerfKey((k) => k + 1);
  }, [sh]);
  useEffect(() => {
    if (!PERF_ENABLED || sv === undefined) return;
    const v = SHELF_VIEWS[Number(sv)];
    if (!v) return;
    setShelfView(v);
    setShelfViewState(v);
    setPerfKey((k) => k + 1);
  }, [sv]);
  useEffect(() => {
    if (!PERF_ENABLED || !lv) return;
    setPerfLevel(lv as PerfLevel);
    setPerfKey((k) => k + 1);
  }, [lv]);
  const perfOn = useSharedValue(false);
  const perfDts = useSharedValue<number[]>([]);
  // 시간표용 프레임 시각(Date.now, JS 사건과 같은 시계). 놓은 뒤 자리 잡는 동안까지 이어서 적는다
  const perfStamps = useSharedValue<number[]>([]);
  const perfFrames = useFrameCallback((fi) => {
    if (fi.timeSincePreviousFrame === null) return;
    if (perfOn.value) {
      const dt = fi.timeSincePreviousFrame;
      perfDts.modify((a) => {
        'worklet';
        a.push(dt);
        return a;
      });
    }
    if (tlOn.value) {
      const now = Date.now();
      perfStamps.modify((a) => {
        'worklet';
        a.push(now);
        return a;
      });
    }
  }, false);
  const perfCommit = useRef<{ t0: number; done: (ms: number) => void } | null>(null);
  useEffect(() => {
    const c = perfCommit.current;
    if (!c) return;
    perfCommit.current = null;
    c.done(performance.now() - c.t0);
  }, [view.pitch]);
  // 책 끌기 한 번(집기 ~ 놓고 자리 잡기)의 프레임 간격
  // 측정 번들: 시간표 세션(끌기·되돌리기). 끝내면 3.5초 뒤(놓은 뒤 자리 잡는 동안까지) 한 번에 낸다. 그 사이 새 세션이 시작되면
  // (앞 세션 자료는 새 세션이 비웠다) 앞 세션의 타이머는 아무것도 하지 않는다: 새 세션 도중에 시간표를 끄지 않게.
  const tlSession = useRef(0);
  const tlFlushLater = () => {
    const s = tlSession.current;
    setTimeout(() => {
      if (tlSession.current !== s) return;
      tl('tl-end');
      tlOn.value = false;
      setTimeout(() => {
        if (tlSession.current !== s) return;
        perfFrames.setActive(false);
        TL.on = false;
        logChunks('[mv-js]', TL.js);
        logChunks('[mv-ui]', tlEv.value);
        logChunks('[mv-fr]', perfStamps.value.map(String));
        TL.js = [];
      }, 150);
    }, 3500);
  };
  const dragPerfStart = () => {
    tlSession.current += 1;
    perfDts.value = [];
    perfStamps.value = [];
    tlEv.value = [];
    TL.js = [];
    TL.on = true;
    tlOn.value = true;
    tl(`drag-start ${dragRef.current?.bookId ?? ''}@${dragRef.current?.shelfId ?? ''}`);
    perfFrames.setActive(true);
    perfOn.value = true;
    const j = dragJs.current;
    j.preview = [];
    j.commit = [];
    j.js = [];
    j.last = performance.now();
    lastPlan.log = [];
    const tick = () => {
      const now = performance.now();
      j.js.push(now - j.last);
      j.last = now;
      j.raf = requestAnimationFrame(tick);
    };
    j.raf = requestAnimationFrame(tick);
  };
  const dragPerfStop = () => {
    perfOn.value = false;
    const j = dragJs.current;
    cancelAnimationFrame(j.raf);
    const ms = (a: number[]) => ({ n: a.length, mean: a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0, max: a.length ? +Math.max(...a).toFixed(1) : 0 });
    console.log('[perf-drag]', JSON.stringify({ ...frameStats(perfDts.value), js: frameStats(j.js), preview: ms(j.preview), commit: ms(j.commit), plan: ms(lastPlan.log ?? []) }));
    lastPlan.log = null;
    // 시간표: 놓은 뒤 자리 잡는 동안(3.5초)까지 적고 한 번에 낸다
    tl('drag-stop');
    tlFlushLater();
  };
  // 측정 번들: 되돌리기 한 번의 시간표(끌기 시간표가 아직 켜져 있으면 거기에 이어 적는다). 되돌리기는 손가락 없이 저절로 가는 경로라
  // '자동 이동 경로'를 따로 잰다.
  const undoPerfStart = (ids: string) => {
    if (TL.on) {
      tl(`undo ${ids}`);
      return;
    }
    tlSession.current += 1;
    perfStamps.value = [];
    tlEv.value = [];
    TL.js = [];
    TL.on = true;
    tlOn.value = true;
    tl(`undo ${ids}`);
    perfFrames.setActive(true);
    tlFlushLater();
  };
  const runPerf = async (level: PerfLevel) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const record = async (ms: number) => {
      perfDts.value = [];
      perfFrames.setActive(true);
      perfOn.value = true;
      await wait(ms);
      perfOn.value = false;
      perfFrames.setActive(false);
      return frameStats(perfDts.value);
    };
    setPerfLevel(level);
    setPerfKey((k) => k + 1);
    viewStore.setPitch(VIEW_PITCH_MIN);
    pitchSV.value = VIEW_PITCH_MIN;
    viewGoal.value = VIEW_PITCH_MIN;
    await wait(3000);
    const idle = await record(1000);
    const ease = { duration: 900, easing: Easing.inOut(Easing.cubic) };
    pitchSV.value = withRepeat(withSequence(withTiming(VIEW_PITCH_MAX, ease), withTiming(VIEW_PITCH_MIN, ease)), 2, false);
    const sweep = await record(3700);
    const benchRows: BenchRow[] = rows.flatMap((r, i) => {
      const mo = motionOf(r.shelfId);
      return mo ? [{ m: mo, px: rowAffine(m, r, 0), space: r.space }] : [];
    });
    const s = m.scale;
    const calc = await new Promise<ReturnType<typeof benchProjection>>((resolve) => {
      scheduleOnUI(() => {
        'worklet';
        const r = benchProjection(benchRows, s, 30);
        scheduleOnRN(resolve, r);
      });
    });
    // 시점을 8°로 확정: 터치 영역·줄 높이 다시 계산(React) + 그 뒤 UI 스레드
    pitchSV.value = VIEW_PITCH_MAX;
    const react = new Promise<number>((resolve) => {
      perfCommit.current = { t0: performance.now(), done: resolve };
    });
    const afterP = record(1200);
    viewStore.setPitch(VIEW_PITCH_MAX);
    const reactMs = await react;
    const after = await afterP;
    const out = { level, idle, sweep, calc, reactMs: Math.round(reactMs), after };
    console.log('[perf]', JSON.stringify(out));
    setToast({ text: `${level} 전환 ${sweep.mean}ms(p90 ${sweep.p90}) 계산 ${(calc.faces + calc.cast).toFixed(1)}ms React ${Math.round(reactMs)}ms` });
    viewStore.setPitch(VIEW_PITCH_MIN);
    pitchSV.value = VIEW_PITCH_MIN;
    viewGoal.value = VIEW_PITCH_MIN;
  };
  const runPerfRef = useRef(runPerf);
  runPerfRef.current = runPerf;

  // 꾸미기 켜기·끄기. 줄 간격은 3D 값이라 그대로다. 나올 때 조작부 여백이 빠져 목록 끝이 줄어도
  // 지금 스크롤이 잘리지 않게 여백을 잠깐 남겼다가, 넘친 만큼은 부드럽게 올린 뒤 뺀다.
  const setEditingKeep = (on: boolean) => {
    if (on === editing) return;
    if (!on) {
      const last = rows.at(-1);
      const h = Math.max(vpH, (last ? last.top + last.height : 0) + (SHELF_CAST_EXTENT + 8) * m.scale);
      const max = Math.max(0, h - vpH);
      setTailPad(panelH);
      if (scrollY.value > max) {
        setTimeout(() => {
          scheduleOnUI(() => {
            'worklet';
            scrollTo(scrollRef, 0, max, true);
          });
        }, 0);
        setTimeout(() => setTailPad(0), 450);
      } else setTailPad(0);
    }
    setEditing(on);
  };

  // 책 정보 시트(BookSheet)가 누른 책을 가리면 책장을 그만큼 올린다. 맨 아랫줄도 올라오게 아래 여백을 시트가 덮는 만큼 늘리고,
  // 시트를 닫으면 넘친 만큼 부드럽게 되돌린 뒤 뺀다(꾸미기 조작부와 같은 방식)
  const viewportRef = useRef<View>(null);
  const sheetPad = useRef(false);
  const revealAboveSheet = (sheetTop: number) => {
    const id = popId;
    const p = id ? placementOf(shown, id) : null;
    const row = p && rows.find((r) => r.shelfId === p.shelfId);
    const f = row && frames.get(p!.shelfId)?.find((fr) => fr.bookId === id);
    if (!row || !f) return;
    const box = frameBBox(f, camAt(view.pitch));
    const bottom = toContent(m, row, { x: 0, y: box.minY + box.height }).y;
    viewportRef.current?.measureInWindow((_x, vy, _w, vh) => {
      const limit = sheetTop - vy - 14; // 뷰포트 좌표에서 시트 위 끝(조금 띄운다)
      const need = bottom - scrollY.value - limit;
      if (need <= 0) return;
      sheetPad.current = true;
      setTailPad(Math.max(0, vy + vh - sheetTop));
      const y = scrollY.value + need;
      setTimeout(() => scrollRef.current?.scrollTo({ y, animated: !reduceMotion }), 0);
    });
  };
  useEffect(() => {
    if (popId || !sheetPad.current) return;
    sheetPad.current = false;
    if (editing) return;
    const last = rows.at(-1);
    const h = Math.max(vpH, (last ? last.top + last.height : 0) + (SHELF_CAST_EXTENT + 8) * m.scale);
    const max = Math.max(0, h - vpH);
    if (scrollY.value > max) {
      scrollRef.current?.scrollTo({ y: max, animated: !reduceMotion });
      setTimeout(() => setTailPad(0), 450);
    } else setTailPad(0);
    // 시트가 닫힐 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popId]);

  const hints = useRef(new Map<string, DropHint>());
  const hintFor = (shelfId: string): DropHint => {
    const p = drag?.preview;
    if (!drag || !p || p.shelfId !== shelfId) return null;
    const PUSH_LABEL: Record<string, string> = { left: '왼쪽 우선', right: '오른쪽 대안', split: '양쪽 나눔(확장)', none: '밀지 않음' };
    const h = p.kind === 'bad' ? { text: ko.fail[p.reason] || ko.fail.outside, bad: true } : p.hint === 'self' ? null : { text: p.kind === 'ok' && p.push ? `${ko.hint[p.hint]} · ${PUSH_LABEL[p.push]}` : ko.hint[p.hint], bad: false };
    if (!h) return null;
    const key = `${h.bad ? 1 : 0}${h.text}`;
    if (!hints.current.has(key)) hints.current.set(key, h);
    return hints.current.get(key)!;
  };

  // ---------- 메뉴 동작 ----------
  const activeId = popId ?? detailId;
  const detailPlacement = detailId ? placementOf(layout, detailId) ?? null : null;
  const menuPose = (pose: Pose) => (activeId ? commit(setPose(layout, books, activeId, pose)) : null);
  // 메뉴로 기울이기: 기댈 곳이 없으면(withLeans가 바로 세움) 알려 준다.
  const menuTilt = (t: Tilt) => {
    if (!activeId) return null;
    const err = commit(setTilt(layout, books, activeId, t));
    if (err || t === 0) return err;
    const now = placementOf(placementStore.get().layout, activeId);
    return now && now.tilt === 0 ? ko.lean.noSupport : null;
  };
  const menuMove = (mv: MoveAction, id = activeId): string | null => {
    if (!id) return null;
    if (mv === 'prev' || mv === 'next') return commit(moveBy(layout, books, id, mv === 'prev' ? -1 : 1));
    const p = placementOf(layout, id)!;
    const i = shelves.findIndex((s) => s.id === p.shelfId) + (mv === 'up' ? -1 : 1);
    if (i < 0 || i >= shelves.length) return null;
    // 끌기처럼 원래 줄에 경로가 끝날 때까지 올려 둔다: 그 줄 캔버스를 다시 기록하지 않고 이동 캔버스로 넘겨주며, 떠나는 책의 그림자가 이어진다.
    // 이동 캔버스는 누른 순간부터 그 책을 미리 그려 둔다(도착 줄 캔버스를 기록하는 동안 첫 그림을 치른다)
    holdRows([id], [p.shelfId]);
    warmSV.value = id;
    releaseLater([id]);
    setTimeout(() => {
      if (warmSV.value === id && dragRef.current?.bookId !== id) warmSV.value = null;
    }, WAIT_MAX + PULL_MS * ANIM.slow + 600);
    return commit(moveToShelf(layout, books, id, shelves[i].id));
  };

  // 되돌리기: 다른 줄로 옮겨 가는 책이 있으면 끌기·메뉴 이동처럼 원래 줄에 붙잡아 두고(그 줄 캔버스를 다시 기록하지 않아 떠나는 책과
  // 그 그림자가 이어진다) 이동 캔버스에 그 책을 올려 실제로 그릴 수 있게 된 뒤(live) 되돌린다. 넘겨줄 이동 캔버스 그림이 없는 채로
  // 원래 줄이 그 책을 내리면 아무도 그리지 않는 프레임이 생긴다. 이동 캔버스 준비는 길어야 0.5초만 기다린다.
  const undoMoves = useCallback(async (): Promise<boolean> => {
    const st = placementStore.get();
    if (!st.undo) return false;
    const now = st.layout;
    const back = st.undo;
    const moved: { id: string; from: string }[] = [];
    for (const q of back.placements) {
      const cur = now.placements.find((x) => x.bookId === q.bookId);
      if (cur && cur.shelfId !== q.shelfId) moved.push({ id: q.bookId, from: cur.shelfId });
    }
    if (PERF_ENABLED) undoPerfStart(moved.map((mv) => mv.id).join(','));
    if (moved.length) {
      for (const mv of moved) holdRows([mv.id], [mv.from]);
      const ids = moved.map((mv) => mv.id);
      for (let i = 0; i < 30; i++) {
        const live = liveSV.value;
        if (ids.every((id) => live[id]?.[TRANSIT_ROW])) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      if (TL.on) tl(`undo-ready ${ids.join(',')}`);
      releaseLater(ids);
      // 기다리는 동안 다른 조작이 확정됐으면(되돌릴 대상이 바뀜) 그 조작을 대신 되돌리지 않는다
      if (placementStore.get().undo !== back) return false;
    }
    return placementStore.undo();
  }, [holdRows, releaseLater]);

  // 자세·기울기 바꾸기: 제자리에서 돌 수 없으면(옆 책에 걸리면) 경로 계획이 선반 앞으로 빼서 돌려 넣는다(planner).
  const commitPath = (r: Result): string | null => commit(r);
  // 조작 중 미리보기(손잡이·앞뒤·돌리기): 그 선반 경로만 바로 바꾼다. restore = 확정 배치로.
  const motionOf = (shelfId: string) => motions.find((e) => e.shelfId === shelfId)?.m;
  // 한 선반의 프레임: 확정할 때와 같은 계산(기대기 결과 반영)이라 놓은 뒤 다시 움직이지 않는다
  const shelfFrames = (l: ShelfLayout, shelfId: string) => computeShelf(withLeans(l, books, shelfId), books, shelfId).frames;
  const previewShelf = (shelfId: string, l: ShelfLayout, follow = false) => {
    const mo = motionOf(shelfId);
    if (mo) previewInto(mo, shelfId, shelfFrames(l, shelfId), reduceMotion || !settled, follow);
  };
  // 조작을 마칠 때: 확정한 배치(실패면 조작 전 배치)로 맞춘다. 미리보기 자세가 남지 않게.
  // 그 조작으로 이 줄에서 서랍으로 간 책(받침을 잃거나 선반 앞 끝에서 떨어짐)은 보이던 자세에서 떨어지며 사라진다(줄 경로가 여기서 정해진다)
  const settleShelf = (shelfId: string, l: ShelfLayout) => {
    const mo = motionOf(shelfId);
    if (!mo) return;
    const lw = withLeans(l, books, shelfId);
    const poses = displayedPoses(mo);
    const drops: Drops = {};
    for (const q of layout.placements) {
      const pose = poses[q.bookId];
      if (q.shelfId === shelfId && pose && lw.drawer.includes(q.bookId)) drops[q.bookId] = { from: pose, d: dropDir(q, pose) };
    }
    settleInto(mo, shelfId, computeShelf(lw, books, shelfId).frames, reduceMotion || !settled, drops);
  };

  // 꾸미기 조작부: 자세와 기대기(방향만 고르고 각도는 옆 책과의 틈으로)
  const editPlacement = editId ? placementOf(layout, editId) ?? null : null;
  const editDisplayPose = editPlacement?.pose === 'front' && (editPlacement.pitch ?? 0) >= 89.95 ? 'horizontal' : editPlacement?.pose ?? null;
  const canLean = useMemo(() => {
    const out = { [-1]: false, 1: false } as { [-1]: boolean; 1: boolean };
    if (!editId || editPlacement?.pose !== 'spine') return out;
    for (const d of [-1, 1] as const) {
      if (Math.sign(editPlacement.tilt) === d) {
        out[d] = true;
        continue;
      }
      const r = setTilt(layout, books, editId, tiltToward(d));
      // 기울인 책이 실제로 기대야 한다. 기울인 탓에 이 책이나 다른 책이 넘어져 서랍으로 가는 기울기도 막는다
      // (예: 낮게 누운 책 모서리에 기대면 미는 힘에 미끄러져 옆 책까지 무너진다)
      const after = r.ok ? withLeans(r.layout, books) : null;
      out[d] = !!after && (placementOf(after, editId)?.tilt ?? 0) !== 0 && after.drawer.length === layout.drawer.length;
    }
    return out;
  }, [editId, editPlacement, layout, books]);
  const editPose = (pose: Pose) => {
    if (!editId || editDisplayPose === pose) return;
    setEditMsg(commitPath(setPose(layout, books, editId, pose)));
  };
  const editLean = (d: -1 | 0 | 1) => {
    if (!editId || !editPlacement || Math.sign(editPlacement.tilt) === d) return;
    setEditMsg(commitPath(setTilt(layout, books, editId, tiltToward(d))));
  };
  // ---------- 표지 책 머리 손잡이: 위아래 = 뒤로 젖히기, 좌우 = 돌리기 ----------
  // 각도 = 기준 각도 + 비율 × (손잡이를 잡은 지점에서 끈 거리의 축 방향 성분). 기준은 잡을 때의 지금 각도.
  // 4dp만 움직여도 주된 방향으로 축을 정하고 그 뒤로 고정한다(정하는 사이 움직인 만큼도 이어서 반영되어, 한꺼번에 따라잡지 않는다).
  // 옆 책·벽에 막혀 원하는 각도까지 못 가면 그 손가락 자리를 새 기준으로 삼는다: 더 끌어도 쌓이지 않고 되돌리면 바로 줄어든다.
  // 끄는 동안 각도는 경로를 다시 짜지 않고 바로 그 자세로(previewShelf follow), 손잡이는 실제로 된 각도만큼 축 방향으로 손가락을 따라간다.
  // 놓으면 한 번에 확정(되돌리기 한 번)하고 손잡이는 머리 위로 돌아간다.
  const handleAt = useRef(0);
  const headRef = useRef<{ id: string; shelfId: string; qx: number; start: FrontState; cur: FrontState; axis: 'tilt' | 'spin' | null; base: { d: number; a: number }; last: ShelfLayout | null; dx: number; dy: number; raf: number } | null>(null);
  const [headLive, setHeadLive] = useState<FrontState | null>(null);
  // 손잡이 표시를 머리 위 제자리에서 옮길 거리(dp, 끄는 동안만)
  const headOffX = useSharedValue(0);
  const headOffY = useSharedValue(0);
  const TILT_PER_DU = 0.35; // 머리를 1DU 밀면 0.35° 젖힘(20°에 약 57DU)
  const SPIN_PER_DU = 0.9; // 좌우 1DU에 0.9°(표지 책은 ±90°까지 돈다: 90°에 100DU)
  const AXIS_DP = 4;
  const headStep = () => {
    const h = headRef.current;
    if (!h) return;
    h.raf = 0;
    if (!h.axis) {
      if (Math.hypot(h.dx, h.dy) < AXIS_DP) return;
      h.axis = Math.abs(h.dx) > Math.abs(h.dy) ? 'spin' : 'tilt';
      h.base = { d: 0, a: h.axis === 'tilt' ? h.start.pitch : h.start.spin };
    }
    const tilt = h.axis === 'tilt';
    const gain = tilt ? TILT_PER_DU : SPIN_PER_DU;
    const d = (tilt ? -h.dy : h.dx) / m.scale; // 잡은 지점에서 축 방향으로 끈 거리(DU, 위·오른쪽이 +)
    const want = h.base.a + (d - h.base.d) * gain;
    const r = tilt ? frontTilt(layout, books, h.id, h.cur, h.qx, want) : frontSpin(layout, books, h.id, h.cur, h.qx, want);
    if (!r) return;
    const got = tilt ? r.state.pitch : r.state.spin;
    // 돌리기는 0 근처에서 살짝 붙는다(frontSpin): 그만큼은 막힌 것이 아니다
    const aim = !tilt && Math.abs(want) < 0.8 ? 0 : want;
    if (Math.abs(got - aim) > 0.05) h.base = { d, a: got };
    h.cur = r.state;
    h.last = r.layout;
    previewShelf(h.shelfId, r.layout, true);
    setHeadLive(r.state);
    const off = ((got - (tilt ? h.start.pitch : h.start.spin)) / gain) * m.scale;
    headOffX.value = tilt ? 0 : off;
    headOffY.value = tilt ? -off : 0;
    // 측정 번들: 손가락 → 각도 → 손잡이가 이어지는지(끈 거리 dp, 원한 각도, 실제 각도, 손잡이 이동 dp)
    if (PERF_ENABLED) console.log('[handle]', h.axis, (tilt ? -h.dy : h.dx).toFixed(1), want.toFixed(2), got.toFixed(2), off.toFixed(1));
  };
  const onHandle = (phase: 'begin' | 'move' | 'end', dx: number, dy: number) => {
    handleAt.current = Date.now();
    if (phase === 'begin') {
      const f = editId ? frontStateOf(layout, books, editId) : null;
      const shelfId = editId ? placementOf(layout, editId)?.shelfId : undefined;
      headRef.current = f && editId && shelfId ? { id: editId, shelfId, qx: f.qx, start: f.state, cur: f.state, axis: null, base: { d: 0, a: 0 }, last: null, dx: 0, dy: 0, raf: 0 } : null;
      headOffX.value = 0;
      headOffY.value = 0;
      setEditMsg(null);
      return;
    }
    const h = headRef.current;
    if (!h) return;
    if (phase === 'move') {
      h.dx = dx;
      h.dy = dy;
      if (!h.raf) h.raf = requestAnimationFrame(headStep);
      return;
    }
    cancelAnimationFrame(h.raf);
    headRef.current = null;
    setHeadLive(null);
    const back = { duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic) };
    headOffX.value = withTiming(0, back);
    headOffY.value = withTiming(0, back);
    if (!h.last) return;
    // 받침을 잃으면 무게중심에 따라 넘어져 벽·책·바닥에서 멈춘 자세를 저장한다. 끄는 동안 마지막 배치(돌리며 비킨 옆 책 자리)에서 시작한다
    const fin = frontRelease(h.last, books, h.id, h.cur, h.qx);
    const err = fin ? commitPath({ ok: true, layout: fin }) : ko.fail['no-space'];
    settleShelf(h.shelfId, fin && !err ? fin : layout);
    // 선반 앞 끝 밖으로 떨어진 책은 서랍으로 간다(받침을 잃은 세운 책과 같은 알림. 꾸미는 중이라 알림 대신 조작부에)
    const before = new Set(h.last.drawer);
    const fell = err ? 0 : placementStore.get().layout.drawer.filter((id) => !before.has(id)).length;
    if (fell && !placementOf(placementStore.get().layout, h.id)) setEditId(null);
    setEditMsg(err ?? (fell ? ko.fellToDrawer(fell) : null));
  };
  onHandleRef.current = onHandle;
  const frontInfo = useMemo(() => (editId ? frontStateOf(layout, books, editId) : null), [editId, layout, books]);
  const anglesText = frontInfo ? ko.decoratePanel.angles((headLive ?? frontInfo.state).spin, (headLive ?? frontInfo.state).pitch) : null;

  // 앞뒤: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 옆 책·벽에 닿으면 가능한 데까지. 실제로 된 깊이를 돌려준다.
  const editDepth = (z: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = boxOf(layout, books, editId)?.z ?? 0;
    // 끄는 동안은 직전 미리보기의 벽 기대기 상태를 이어받는다(경계 여유가 한 번의 끌기 안에서도 작동하게)
    const r = setDepth(layout, books, editId, z, leanRef.current);
    const leaned = r.ok ? placementOf(r.layout, editId) : undefined;
    leanRef.current = done ? undefined : r.ok ? !!(leaned?.wallLean || (leaned?.pitch ?? 0) > 0) : leanRef.current;
    const got = r.ok ? boxOf(r.layout, books, editId)?.z ?? cur : cur;
    const limited = Math.abs(got - z) >= 1;
    if (!done) {
      if (shelfId) previewShelf(shelfId, r.ok ? r.layout : layout);
      setEditMsg(limited ? ko.decoratePanel.depthLimit : null);
      return got;
    }
    const err = r.ok ? commitPath(r) : null;
    if (shelfId) settleShelf(shelfId, r.ok && !err ? r.layout : layout);
    if (!r.ok) {
      setEditMsg(r.reason === 'no-change' ? null : ko.decoratePanel.depthLimit);
      return cur;
    }
    setEditMsg(err ?? (limited ? ko.decoratePanel.depthLimit : null));
    return err ? cur : got;
  };
  const depthInfo = useMemo(() => (editId && placementOf(layout, editId) ? depthRange(layout, books, editId) : null), [editId, layout, books]);
  // 돌리기: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 실제로 된 각도를 돌려준다.
  const editSpin = (deg: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = placementOf(layout, editId)?.spin ?? 0;
    const fs = frontStateOf(layout, books, editId);
    const fr = fs ? frontSpin(layout, books, editId, fs.state, fs.qx, deg) : null;
    const r: Result = fs ? (fr && Math.abs(fr.state.spin - cur) > 0.01 ? { ok: true, layout: fr.layout } : { ok: false, reason: fr ? 'no-change' : 'no-space' }) : setSpin(layout, books, editId, deg);
    const got = r.ok ? placementOf(r.layout, editId)?.spin ?? 0 : cur;
    // 원한 만큼 못 돌면(옆 책·쌓인 책·선반 깊이에 막힘) 어디까지 되는지 알려 준다
    const limited = Math.abs(deg) >= 1 && Math.abs(got - deg) >= 1;
    const limitMsg = limited ? ko.decoratePanel.spinLimit(Math.round(got)) : null;
    if (!done) {
      if (!shelfId) return got;
      previewShelf(shelfId, r.ok ? r.layout : layout, true);
      setEditMsg(limitMsg);
      return got;
    }
    const err = r.ok ? commitPath(r) : null;
    if (shelfId) settleShelf(shelfId, r.ok && !err ? r.layout : layout);
    if (!r.ok) {
      setEditMsg(r.reason === 'no-change' ? limitMsg : ko.fail[r.reason] || null);
      return cur;
    }
    setEditMsg(err ?? limitMsg);
    return err ? cur : got;
  };
  const finishEditing = () => {
    setEditingKeep(false);
    setEditId(null);
    setEditMsg(null);
  };

  // 꾸미는 동안은 탭 바를 숨기고 그 자리에 조작부를 둔다
  editingRef.current = editing;
  const navigation_ = useNavigation();
  useEffect(() => {
    navigation_.setOptions({ tabBarStyle: editing ? { display: 'none' } : tabBarStyle(insets.bottom) });
  }, [editing, navigation_, insets.bottom]);
  // 꾸미는 동안은 머리글(제목·연도·버튼)도 숨겨 책장을 넓게 쓴다(되돌리기·완료는 조작부 제목 줄).
  // 꾹 눌러 끌며 꾸미기를 시작했으면 놓은 뒤에 숨긴다(끄는 도중 손가락 아래 책장이 밀리지 않게)
  const [bare, setBare] = useState(false);
  const dragging = !!drag;
  useEffect(() => {
    if (!editing) setBare(false);
    else if (!dragging) setBare(true);
  }, [editing, dragging]);

  const onA11y = useCallback(
    (bookId: string, action: string) => {
      if (action === 'activate') {
        setPopId(bookId);
      }
      else if (action === 'prev' || action === 'next') {
        const err = menuMove(action, bookId);
        if (err) showToast({ text: err });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, books],
  );

  const a11yLabelOf = useCallback(
    (bookId: string) => {
      const b = books[bookId];
      const p = placementOf(layout, bookId);
      if (!p) return b.title;
      const restingPose = p.pose === 'front' && (p.pitch ?? 0) >= 89.95 ? 'horizontal' : p.pose;
      const parts = [b.title, b.author, ko.poseState[restingPose], ko.tiltState[String(p.tilt) as '0']];
      if (p.stackId) {
        const n = layout.placements.filter((q) => q.stackId === p.stackId).length;
        parts.push(ko.stacked((p.stackOrder ?? 0) + 1, n));
      }
      return parts.filter(Boolean).join(', ');
    },
    [books, layout],
  );

  // 독서 연도: 완독 기록이 있는 해들(없으면 올해). 누르면 다음 해로 넘긴다(최근 → 과거 순환).
  const years = [...new Set(Object.values(books).map((b) => Number(b.finishedAt?.slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
  if (!years.length) years.push(new Date().getFullYear());
  const year = selectedYear && years.includes(selectedYear) ? selectedYear : years[0];
  const count = Object.values(books).filter((b) => b.finishedAt?.startsWith(String(year))).length;
  // 꾸미기에서 책을 고르거나(탭) 끌어 놓으면, 그 책이 아래 조작부에 가릴 때만 가리지 않을 만큼 스크롤한다.
  // 꾸미기에 들어가고 나올 때는 스크롤하지 않는다(보던 줄 그대로, 손으로 스크롤할 수 있다).
  // 끄는 동안에는 조작부를 내려 두므로, 놓은 뒤 조작부가 다시 뜨고 높이를 잰 다음에 한 번 맞춘다(reveal).
  const prevEditId = useRef<string | null>(null);
  const reveal = useRef(false);
  const [dropTick, setDropTick] = useState(0);
  useEffect(() => {
    if (editId !== prevEditId.current) {
      prevEditId.current = editId;
      reveal.current = !!editId;
    }
    if (!reveal.current || !editing || !panelH || !editId || dragRef.current) return;
    reveal.current = false;
    const p = placementOf(layout, editId);
    const row = p ? rowOf.get(p.shelfId) : undefined;
    const f = row && frames.get(row.shelfId)?.find((fr) => fr.bookId === editId);
    if (!row || !f) return;
    const cam = camAt(view.pitch);
    const box = frameBBox(f, cam);
    const top = toContent(m, row, { x: 0, y: box.minY }).y;
    const bottom = row.baseline + (SHELF_FRONT * cam.ky + SHELF_THICK) * m.scale + 8;
    const cur = scrollY.value;
    const visible = vpH - panelH;
    let next = cur;
    if (bottom > cur + visible) next = bottom - visible;
    if (top - 8 < next) next = Math.max(0, top - 8);
    if (Math.abs(next - cur) < 1) return;
    const animated = !reduceMotion;
    scheduleOnUI(() => {
      'worklet';
      scrollTo(scrollRef, 0, next, animated);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, editing, panelH, dropTick]);

  // 선택 빛: 끄는 책, 꾸미기에서 고른 책, 정보 상자·시트의 책(들어 올리지 않고 윤곽 빛만). 그 책이 있는 줄에만 넘긴다(다른 줄은 다시 그리지 않게).
  const glowId = drag ? drag.bookId : editing ? editId : (popId ?? detailId ?? selectedId);
  const glowShelf = glowId ? placementOf(shown, glowId)?.shelfId : undefined;
  const dragShelf = drag ? placementOf(shown, drag.bookId)?.shelfId : undefined;
  // 표지 책 머리 손잡이: 꾸미기에서 고른 표지 책(끄는 중이 아닐 때)
  const handleOn = editing && !drag && editId && placementOf(layout, editId)?.pose === 'front' ? { shelfId: placementOf(layout, editId)!.shelfId, bookId: editId } : null;
  // 미리 올려 둘 책의 자세(올릴 때 한 번 쓰는 자리 표시용): 지금 있는 줄의 프레임
  const holdRest = useMemo(() => {
    const out: Record<string, Book3> = {};
    for (const id of Object.keys(holds))
      for (const fs of frames.values()) {
        const f = fs.find((q) => q.bookId === id);
        if (f) {
          out[id] = fromPlaced(f.box);
          break;
        }
      }
    return out;
  }, [holds, frames]);
  const sceneRows: SceneRowProps[] = useMemo(
    () =>
      shownShelves.flatMap((sh) => {
        const row = rowOf.get(sh.id);
        if (!row) return [];
        const fs = frames.get(sh.id) ?? [];
        // 끄는 책을 미리 올려 둔 줄: 그 책이 이 줄 배치에 없으면 캔버스에만 올려 두고, 끄는 책 표시·선택 빛도 이 줄에 둔다
        // (줄을 오갈 때 표시가 옮겨 다니며 캔버스를 다시 기록하지 않게)
        const gs = Object.keys(holds)
          .filter((id) => holds[id].includes(sh.id) && !fs.some((f) => f.bookId === id) && holdRest[id])
          .map((id) => ({ id, rest: holdRest[id] }));
        // 떨어져 사라지는 책도 사라질 때까지 이 줄 캔버스에
        const dr = drops[sh.id];
        if (dr) for (const [id, v] of Object.entries(dr)) if (!gs.some((g) => g.id === id) && !fs.some((f) => f.bookId === id)) gs.push({ id, rest: v.from });
        const ghosts = gs.length ? gs : undefined;
        const dragHere = dragShelf === sh.id || (!!drag && !!holds[drag.bookId]?.includes(sh.id));
        const glowHere = glowShelf === sh.id || (!!glowId && !!holds[glowId]?.includes(sh.id));
        return [{ shelfId: sh.id, row, frames: fs, arrive: arrivals[sh.id], dragId: dragHere ? drag!.bookId : null, glowId: glowHere ? glowId : null, hint: hintFor(sh.id), ghosts, drops: dr }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownShelves, rowOf, frames, arrivals, dragShelf, glowShelf, glowId, drag?.bookId, drag?.preview, holds, holdRest, drops],
  );
  const contentHeight = Math.max(vpH, (rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : CONTENT_TOP) + (SHELF_CAST_EXTENT + 8) * m.scale + (editing ? panelH : tailPad));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 머리글 뒤 벽: 맨 윗줄 벽이 화면 위 끝까지 이어진다 */}
      <HeaderWall rows={sceneRows} motions={motions} books={sceneBooks} m={m} width={winW} height={vpTop} cam={camSV} />
      {PERF_ENABLED && camDebug === '1' ? (
        <Text pointerEvents="none" style={{ position: 'absolute', zIndex: 99, left: 8, bottom: navigation.height + insets.bottom + 4, fontSize: 11, color: '#7A2E1E', backgroundColor: 'rgba(255,255,255,0.8)' }}>{/* 측정용 */}
          {`저장 ${view.pitch}° · ${camNow || `적용 ${view.pitch}°`} · 배율 ${m.scale.toFixed(4)}dp/DU(${(m.scale * PixelRatio.get()).toFixed(3)}px/DU) · 3D 줄 간격 ${(rows[0]?.space ?? 0).toFixed(1)}DU · 꾸미기 ${editing ? '켬' : '끔'}`}
        </Text>
      ) : null}
      {/* 시안 비율: 제목은 작고 둥근 고딕(잉크 약 86×21.5DU, 따뜻한 짙은 갈색), 연도 잉크 높이 약 11.9DU·제목 잉크 위 끝에서 약 30DU 아래,
          원형 버튼 32DU, 좌우 여백 23/18DU */}
      {bare ? null : (
        <View style={[styles.header, { paddingLeft: 26 * m.scale + m.originX, paddingRight: 22 * m.scale + m.originX, paddingTop: 55 * m.scale, height: 104 * m.scale }]}>
          <Pressable style={{ flex: 1 }} onPress={() => setShelfMenuOpen(true)} accessibilityRole="button" accessibilityLabel={ko.menu.title}>
            <View style={{ height: 29*m.scale }} accessibilityRole="header" accessibilityLabel={ko.title}>
              <View style={{ position:'absolute', left:-0.4*m.scale, top:3.065*m.scale }}>
                <ReferenceUI name="heading" width={191*390/853*m.scale} height={51*390/853*m.scale}/>
              </View>
            </View>
            <Pressable
              onPress={() => setSelectedYear(years[(years.indexOf(year) + 1) % years.length])}
              disabled={years.length < 2}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={ko.yearA11y(year, count)}
              style={{ alignSelf: 'flex-start' }}>
              <Text style={[styles.summary, { fontSize: 12.25 * m.scale, marginTop: 5.1 * m.scale }]}>
                {ko.year(year)}
                {years.length > 1 ? ' ▾' : ''}
                {editing ? ` · ${ko.decorating}` : ''}
              </Text>
            </Pressable>
          </Pressable>
          <View style={[styles.actions, { gap: 8 * m.scale, marginTop: -18 * m.scale }]}>
            {/* 꾸미기를 끌며 시작한 동안(머리글을 아직 숨기기 전)에는 더하기를 숨긴다 */}
            {editing ? null : (
              // 시안: 둥근 테두리 원 버튼(약 33DU)과 따뜻한 짙은 갈색의 굵은 더하기
              <HeaderButton size={33.5 * m.scale} label={ko.add} onPress={() => router.push('/book/add')}>
                <Plus size={18 * m.scale} color={colors.homeTitle} strokeWidth={1.9} />
              </HeaderButton>
            )}
          </View>
        </View>
      )}

      <View
        ref={viewportRef}
        style={{ flex: 1 }}
        onLayout={(e) => {
          viewportH.value = e.nativeEvent.layout.height;
          setVpH(e.nativeEvent.layout.height);
          setVpTop(e.nativeEvent.layout.y);
        }}>
        <GestureDetector gesture={scrollNative}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          onScrollBeginDrag={() => {
            setPopId(null);
            setSelectedId(null);
          }}
          scrollEventThrottle={16}
          // 책을 끄는 동안만 손 스크롤을 막는다(가장자리 자동 스크롤). 꾸미기에서도 빈 벽을 끌면 스크롤.
          scrollEnabled={!drag}
          onContentSizeChange={(_w, h) => {
            contentH.value = h;
          }}
          showsVerticalScrollIndicator={false}>
          <GestureDetector gesture={gesture}>
            <View key={perfKey} style={{ height: contentHeight }} collapsable={false}>
              <ShelfScene
                rows={sceneRows}
                motions={motions}
                geo={geoSV}
                books={sceneBooks}
                m={m}
                width={winW}
                height={contentHeight}
                cam={camSV}
                shared={bookShared}
                reduceMotion={reduceMotion || !settled}
                planBudgetMs={drag ? 16 : 60}
                debug={debugGeom}
                handle={handleOn ? { gesture: headPan, shelfId: handleOn.shelfId, bookId: handleOn.bookId, offX: headOffX, offY: headOffY } : null}
                a11yLabelOf={a11yLabelOf}
                onA11y={onA11y}
                viewPitch={view.pitch}
                transitIds={transitIds}
                glowId={glowId}
                leaving={leaving}
              />
            </View>
          </GestureDetector>
        </Animated.ScrollView>
        </GestureDetector>

        {popId && books[popId] && placementOf(layout, popId) ? (
          <BookSheet
            book={books[popId]}
            status={lib.books[popId] ? STATUS_LABEL[lib.books[popId].status] : undefined}
            bottomInset={insets.bottom}
            reduceMotion={reduceMotion}
            onTop={revealAboveSheet}
            onClose={() => {
              setPopId(null);
              setSelectedId(null);
            }}
            onDetail={() => {
              const id = popId;
              setPopId(null);
              setSelectedId(null);
              router.push(`/book/${id}`);
            }}
            onRead={() => {
              const id = popId;
              setPopId(null);
              setSelectedId(null);
              router.push({ pathname: '/read', params: { book: id } });
            }}
            onBookmark={() => {
              const id = popId;
              setPopId(null);
              setSelectedId(null);
              router.push({ pathname: '/bookmark/new', params: { book: id } });
            }}
          />
        ) : null}


        {!store.demo && !editing && !layout.placements.length ? (
          <View pointerEvents="box-none" style={styles.emptyWrap}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{ko.empty.title}</Text>
              <Text style={styles.emptyBody}>{layout.drawer.length ? `${ko.empty.body}\n서랍에 ${layout.drawer.length}권이 있어요.` : ko.empty.body}</Text>
              <Pressable onPress={() => router.push('/book/add')} accessibilityRole="button" style={styles.emptyBtn}>
                <Plus size={icon.small} color={ui.onAccent} strokeWidth={icon.stroke} />
                <Text style={styles.emptyBtnText}>{ko.add}</Text>
              </Pressable>
              {layout.drawer.length ? (
                <Pressable onPress={() => router.push('/drawer')} accessibilityRole="button" hitSlop={8} style={{ marginTop: 12 }}>
                  <Text style={styles.emptyLink}>서랍 열기</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {toast ? (
          <View style={[styles.toast, { bottom: (editing ? 205 : navigation.height) + insets.bottom + 8 }]} accessibilityLiveRegion="polite">
            <Text style={styles.toastText}>{toast.text}</Text>
            {toast.action ? (
              <Pressable
                hitSlop={10}
                onPress={() => {
                  if (toast.action === 'undo') {
                    void undoMoves().then((done) => {
                      if (done) setToast({ text: ko.undone });
                    });
                  } else if (toast.action === 'retry-library') {
                    void libraryStore.flushPending().then(() => setToast(null)).catch(() => {});
                  } else if (toast.action === 'retry-load') {
                    void placementStore.retryLoad().then(() => { if (placementStore.get().save !== 'read-error') setToast(null); });
                  } else {
                    placementStore.retrySave();
                    setToast(null);
                  }
                }}>
                <Text style={styles.toastAction}>{toast.action === 'undo' ? ko.undo : ko.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 끄는 동안은 조작부를 내려 둔다(아래 줄과 끄는 책을 덮지 않게). 놓으면 그 책으로 다시 뜬다 */}
      {editing && !drag ? (
        <DecoratePanel
          bookId={editId}
          title={editId ? books[editId]?.title ?? null : null}
          pose={editDisplayPose}
          lean={(Math.sign(editPlacement?.tilt ?? 0) as -1 | 0 | 1)}
          canLean={canLean}
          msg={editMsg}
          canUndo={!!store.undo}
          onUndo={() => {
            void undoMoves().then((done) => {
              if (done) setEditMsg(null);
            });
          }}
          onDone={finishEditing}
          bottomInset={insets.bottom}
          reduceMotion={reduceMotion}
          onPose={editPose}
          onLean={editLean}
          spin={editPlacement?.spin ?? 0}
          onSpin={editSpin}
          depth={depthInfo}
          onDepth={editDepth}
          angles={anglesText}
          onHeight={setPanelH}
        />
      ) : null}

      <Modal visible={shelfMenuOpen} transparent statusBarTranslucent={MENU_FLAGS.translucent} navigationBarTranslucent={MENU_FLAGS.translucent} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setShelfMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setShelfMenuOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.menuTitle}>{ko.menu.title}</Text>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); setPopId(null); setSelectedId(null); setEditingKeep(true); }}>
            <Paintbrush size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.decorate}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/search'); }}>
            <Search size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.search}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/drawer'); }}>
            <BookMarked size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.drawer.title}{layout.drawer.length ? ` · ${layout.drawer.length}권` : ''}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/stats'); }}>
            <ChartNoAxesColumn size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.stats}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/settings'); }}>
            <Settings size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.settings}</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); showToast({ text: placementStore.addShelf() ? ko.menu.shelfAdded : ko.menu.shelfFail }); }}>
            <Plus size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.addShelf}</Text>
          </Pressable>
          {layout.shelves.length > 3 && layout.shelves.some((sh) => !layout.placements.some((p) => p.shelfId === sh.id)) ? (
            <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); showToast({ text: placementStore.pruneShelves() ? ko.menu.pruned : ko.menu.shelfFail }); }}>
              <Eraser size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.prune}</Text>
            </Pressable>
          ) : null}
          {PERF_ENABLED ? (
            <>
              <View style={styles.menuDivider} />
              <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); placementStore.setDemo(!store.demo); setPerfKey((k) => k + 1); }}>
                <Text style={styles.menuText}>{store.demo ? '예시 책장 끄기(측정)' : '예시 책장 보기(측정, 저장 안 함)'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); setDebugGeom((v) => !v); }}>
                <Text style={styles.menuText}>{debugGeom ? '형상 보기 끄기(측정)' : '형상 보기(측정)'}</Text>
              </Pressable>
              {store.demo ? (
                <>
                  <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); placementStore.resetSample(); }}>
                    <Text style={styles.menuText}>예시 배치로 초기화(측정)</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); placementStore.resetWallPilot(); }}>
                    <Text style={styles.menuText}>벽 기대기 시험(측정)</Text>
                  </Pressable>
                </>
              ) : null}
              {(['all', 'detail'] as const).map((lv) => (
                <Pressable
                  key={lv}
                  accessibilityRole="button"
                  style={styles.menuItem}
                  onPress={async () => {
                    setShelfMenuOpen(false);
                    for (const l of lv === 'all' ? PERF_LEVELS : PERF_DETAIL) await runPerf(l);
                    setPerfLevel('full');
                    setPerfKey((k) => k + 1);
                  }}>
                  <Text style={styles.menuText}>측정: {lv}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                style={styles.menuItem}
                onPress={() => {
                  setShelfMenuOpen(false);
                  const next = SHELF_VIEWS[(SHELF_VIEWS.indexOf(shelfView) + 1) % SHELF_VIEWS.length];
                  setShelfView(next);
                  setShelfViewState(next);
                  setPerfKey((k) => k + 1);
                  setToast({ text: `선반 보기: ${next}` });
                }}>
                <Text style={styles.menuText}>선반 보기: {shelfView}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontFamily: fonts.roundTitle, color: colors.homeTitle },
  summary: { fontFamily: fonts.round, color: colors.homeSummary, letterSpacing: 0.2 },
  actions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center' },
  circle: { borderWidth: 1, borderColor: colors.circle, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: ui.accent, borderColor: ui.accent },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: ui.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: uiFonts.uiBold, fontSize: 11, color: ui.onAccent },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    minHeight: 50,
    borderRadius: shape.input,
    backgroundColor: ui.ink,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    ...shape.floatShadow,
  },
  toastText: { ...type.sub, color: ui.onAccent, flexShrink: 1 },
  toastAction: { ...type.button, fontSize: 14, color: ui.inkAction },
  menuBackdrop: { flex: 1, backgroundColor: ui.scrim },
  menuSheet: { backgroundColor: ui.raised, borderTopLeftRadius: shape.sheet, borderTopRightRadius: shape.sheet, paddingHorizontal: space.page, paddingTop: 22 },
  menuTitle: { ...type.heading, marginBottom: space.tight },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: space.row },
  menuText: type.row,
  emptyWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyCard: { alignItems: 'center', backgroundColor: 'rgba(254,254,253,0.94)', borderRadius: shape.dialog, paddingVertical: 28, paddingHorizontal: 28, marginHorizontal: space.page },
  emptyTitle: { ...type.heading, textAlign: 'center' },
  emptyBody: { ...type.sub, textAlign: 'center', marginTop: 8 },
  emptyBtn: { marginTop: space.group, minHeight: 48, borderRadius: shape.button, backgroundColor: ui.accent, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyBtnText: { ...type.button, color: ui.onAccent },
  emptyLink: { ...type.sub, textDecorationLine: 'underline' },
  menuDivider: { height: shape.hairline, backgroundColor: ui.line, marginVertical: 6 },
});
