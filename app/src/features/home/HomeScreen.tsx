// 홈 책장. 선반 전체를 하나의 제스처로 받고, 터치는 UI 스레드에서 지금 보이는 3D 자세·가림 순서로 앞에 보이는 책을 고른다
// (그리기·그림자·선택 빛·손잡이와 같은 장면 상태, ui/shelf/scene).
// 짧게 누르기 → 정보 상자, 350ms 길게 누르기 → 끌기. 끌기 전 세로 이동은 스크롤이 가져간다.
// 끌기: 같은 선반은 그 자리에 놓고 부딪히는 옆 책만 비키고, 다른 선반은 그 자리에 끼우기(눕힌 책 가운데면 쌓기).
// 놓을 곳이 없으면 책은 제자리에 있고 안내만 뜬다(따로 떠 있는 끌기 그림 없음). 화면 가장자리에서 자동 스크롤.
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BookMarked, ChartNoAxesColumn, Eraser, Paintbrush, Plus, Search, Settings } from '@/ui/icons';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { DESIGN_WIDTH, PLANK_INSET, SHELF_FRONT, SHELF_THICK, VIEW_DEG_PER_DP, viewSettle } from '@/domain/geometry';
import { useViewStore, viewStore } from '@/store/view-store';
import {
  itemWidth,
  moveBy,
  moveToShelf,
  placementOf,
  boxOf,
  shelfItems,
  sortedShelves,
  type Result,
} from '@/domain/layout-engine';
import { corners, fromPlaced, type Book3 } from '@/domain/book3';
import { frameBBox } from '@/domain/shelf-scene';
import { ko } from '@/i18n/ko';
import { settingsStore, useSettings } from '@/store/settings-store';
import { uiBus } from '@/store/ui-bus';
import { DEMO_BOOT_KEY } from '@/store/boot';
import Storage from 'expo-sqlite/kv-store';
import { bootMark, watchResponsive } from '@/ui/boot-trace';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { useShelfShared } from '@/ui/book3d/art';
import { useHomeSnapshot } from '@/ui/home-snapshot';
import { CONTENT_TOP, computeRows, LAYOUT, rowAffine, toContent, useShelfMetrics, type RowGeom } from '@/ui/shelf/metrics';
import { benchProjection, type BenchRow } from '@/ui/shelf/ShelfMotion';
import { flushApply, lastPlan, PULL_MS, WAIT_MAX } from '@/ui/shelf/planner';
import { liveSV, pickAt, plankFrontBand, rowPx, TRANSIT_ROW, warmSV, type Pick, type SceneGeo } from '@/ui/shelf/scene';
import { HANDLE_HIT, handlePoint, HeaderWall, SHELF_CAST_EXTENT, ShelfScene, type DropHint, type SceneRowProps } from '@/ui/shelf/ShelfScene';
import { ANIM, frameStats, logChunks, MENU_FLAGS, PERF_DETAIL, PERF_ENABLED, PERF_LEVELS, PUSH_DEBUG, setLightOff, setPerfLevel, TL, tl, tlEv, tlOn, tlu, TRANSIT_DEBUG, setShelfMode, setShelfView, SHELF_MODES, SHELF_VIEWS, type PerfLevel, type ShelfMode } from '@/ui/perf';
import { colors, fonts, motion, navigation } from '@/ui/theme';
// 책장 밖 UI(메뉴 시트·알림·빈 책장 안내)는 화면 공통 토큰을 쓴다(책장 장면·머리글은 theme.ts 그대로)
import { colors as ui, fonts as uiFonts, icon, press, shape, space, type } from '@/ui/screenTheme';
import { Btn, TextLink } from '@/ui/kit';

import { BookSheet } from './BookSheet';
import { STATUS_LABEL } from '@/features/book/labels';
import { libraryStore, useLibrary } from '@/store/library-store';
import { miniTimerStore } from '@/store/mini-timer-store';
import { tabBarStyle } from '@/ui/tabBar';

import { DecoratePanel } from './DecoratePanel';
import { TabBarVeil } from './TabBarVeil';
import { useShelfEditCommands } from './useShelfEditCommands';
import { useShelfInteraction } from './useShelfInteraction';
import { useShelfDragPreview } from './useShelfDragPreview';
import { useShelfDragLifecycle } from './useShelfDragLifecycle';
import { useScreenTasks } from './useScreenTasks';
import { useRowHolds } from './useRowHolds';
import { useShelfTransitions } from './useShelfTransitions';
import type { Drag } from './shelf-interaction';
import { useSceneMotions, useShelfScenes } from './useShelfSceneState';

type MoveAction = 'prev' | 'next' | 'up' | 'down';

type Toast = { text: string; action?: 'undo' | 'retry' | 'retry-library' | 'retry-load' } | null;

// 꾸미기 시점 끌기 영역(선반 앞면 띠)의 최소 높이·위아래 여유(px)
const EMPTY_IDS: readonly string[] = [];
const FRONT_HIT = 48;
const FRONT_PAD = 10;

// 머리글 글자는 시스템 글자 확대를 이 배수까지만 따른다(머리글 높이가 선반 배치에 묶여 있다)
const HEADER_TEXT_MAX = 1.3;

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
  const tasks = useScreenTasks();
  const insets = useSafeAreaInsets();
  const store = usePlacementStore();
  const { books, layout } = store;
  const { lib, error: libraryError } = useLibrary();
  const m = useShelfMetrics();
  const bookShared = useShelfShared(); // 책 그림 공용 자원(글꼴·종이 결). 캔버스 안에는 컨텍스트가 닿지 않아 여기서 읽어 넘긴다(바뀔 때만 줄을 다시 기록)
  const { width: winW, fontScale } = useWindowDimensions();
  // 시스템 글자가 커지면 머리글 글자(제목·연도)가 늘어난 만큼 위 여백을 줄인다(머리글 높이는 선반 배치에 묶여 그대로, 연도가 잘리지 않게)
  const headerGrow = (Math.min(Math.max(fontScale, 1), HEADER_TEXT_MAX) - 1) * (29 + 18 + 4);
  const sysReduceMotion = useReducedMotion();
  const appSettings = useSettings();
  // 동작 줄이기: 설정에서 기기 설정을 따르거나 앱에서 켜고 끈다
  const reduceMotion = appSettings.reduceMotion === 'system' ? sysReduceMotion : appSettings.reduceMotion === 'on';

  const { drag, dragRef, updateDrag, bookId: popId, editId, message: editMsg, editing, openBook, closeBook, setEditId, setEditMsg, setEditing } = useShelfInteraction();
  const selectedId = popId;
  const [debugGeom, setDebugGeom] = useState(false); // 개발용 형상 보기
  const [selectedYear, setSelectedYear] = useState<number | null>(null); // 헤더 독서 연도
  const [vpH, setVpH] = useState(0);
  // 줄 화면(스크롤 영역) 위 끝의 화면 y: 머리글 뒤 벽(HeaderWall) 높이
  const [vpTop, setVpTop] = useState(0);
  // 꾸미기 조작부가 화면 아래를 차지하는 동안 공통 미니 타이머는 숨긴다
  useEffect(() => {
    miniTimerStore.setHidden(editing);
    return () => miniTimerStore.setHidden(false);
  }, [editing]);
  const [panelH, setPanelH] = useState(0);
  const [shelfMenuOpen, setShelfMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const { holds, holdsRef, holdRows, releaseLater } = useRowHolds(() => dragRef.current?.members ?? []);

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
  // 다음 실행의 시작 화면에 띄울 홈 사진: 다른 화면·상자·끌기 없이 맨 위에 가만히 있을 때 찍는다
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const atRest = focused && settled && !drag && !popId && !editing && !shelfMenuOpen && !toast;
  useHomeSnapshot(atRest, [layout, books, bookShared, appSettings, view, winW, selectedYear], () => scrollY.value < 1);

  // 측정 번들: 끌기 한 번 동안 JS 쪽 시간(미리보기 계산, 미리보기 → 커밋, JS 프레임 간격)
  const dragJs = useRef({ preview: [] as number[], commit: [] as number[], js: [] as number[], commitStart: 0, raf: 0, last: 0 });
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
  const { arrivals, leaving, transitIds, drops } = useShelfTransitions({
    shown, scale: m.scale, rowOf, motions, reduceMotion, dragActive: !!drag,
    dragMembers: drag?.members ?? EMPTY_IDS,
    fallDirections: drag?.preview?.kind === 'ok' ? drag.preview.falls : store.fallDirections,
    fallIds: store.fellIds, holds, editing, editId, popId,
  });
  useLayoutEffect(() => {
    if (PERF_ENABLED && dragJs.current.commitStart) {
      dragJs.current.commit.push(performance.now() - dragJs.current.commitStart);
      dragJs.current.commitStart = 0;
    }
    if (TL.on) tl('home-commit');
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

  const { moveDrag, finalPreview, cancelPreview } = useShelfDragPreview({
    layout, books, rows, scale: m.scale, dragRef, updateDrag,
    onTarget: (d, preview) => {
      const h = holdsRef.current;
      if (preview.shelfId && h[d.bookId] && !h[d.bookId].includes(preview.shelfId)) {
        if (TL.on) tl(`ghost ${d.bookId}@${preview.shelfId}`);
        holdRows(d.members, [preview.shelfId]);
        warmSV.value = d.bookId;
      }
    },
    onTiming: (ms, changed) => {
      if (!PERF_ENABLED) return;
      dragJs.current.preview.push(ms);
      if (changed) dragJs.current.commitStart = performance.now();
    },
  });

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
    closeBook();
    scrollRef.current?.scrollTo({ y: Math.max(0, row.top - 60), animated: !reduceMotion });
    tasks.later('focus-book', () => {
      openBook(id);
    }, reduceMotion ? 50 : 450);
  };
  useFocusEffect(
    useCallback(() => {
      const run = () => {
        const id = uiBus.takeFocus();
        if (id) tasks.later('focus-request', () => focusRef.current(id), 60);
      };
      run();
      const unsubscribe = uiBus.subscribe(run);
      return () => { unsubscribe(); tasks.cancel('focus-request'); tasks.cancel('focus-book'); };
    }, []),
  );

  // ---------- 제스처 콜백(JS) ----------
  // pick: UI 스레드가 지금 보이는 자세·가림 순서로 고른 책(없으면 null)
  const onTap = (pick: Pick) => {
    tasks.cancel('focus-book');
    if (Date.now() - lastDragEnd.current < 350 || dragRef.current) return;
    if (editing) {
      // 꾸미는 중: 짧게 누르면 그 책을 고른다(정보 상자는 띄우지 않는다)
      setEditMsg(null);
      setEditId(pick ? pick.bookId : null);
      return;
    }
    if (!pick) {
      closeBook();

      return;
    }

    openBook(pick.bookId);
  };

  const beginDrag = (pick: Pick, x: number, y: number, absX: number, absY: number, scroll: number) => {
    if (!pick) return;
    const p = placementOf(layout, pick.bookId);
    if (!p || p.shelfId !== pick.shelfId) return;
    tasks.cancel('focus-book');
    // 꾹 눌러 책을 집으면 꾸미기 모드가 시작된다(줄 간격은 3D 값이라 줄이 움직이지 않는다)
    setEditingKeep(true);
    closeBook();
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

    holdRows(members, [p.shelfId]);
    updateDrag(d);
    if (PERF_ENABLED) dragPerfStart();
  };

  const { finishDrag, lastDragEnd } = useShelfDragLifecycle({
    dragRef, active, cancelPreview, updateDrag, releaseLater,
    setAutoScroll: (on) => autoScroll.setActive(on),
    onStop: () => { if (PERF_ENABLED) dragPerfStop(); },
  });

  // 놓기: 미리보기가 유효하면 그대로 확정·저장(화면은 이미 그 자리). 아니면 확정 배치(원래 자리)에 그대로 있다.
  const endDrag = (cancelled: boolean) => {
    const d = dragRef.current;
    active.value = false;
    if (!d) return;
    // 마지막 손가락 위치의 미리보기를 먼저 반영한다(프레임 안에 밀린 이동이 있으면. 넘어짐이 바뀌는 미리보기는 끄는 동안처럼 붙잡는다: 보이는 대로 놓인다)
    const preview = cancelled ? d.preview : finalPreview(d);
    lastDragEnd.current = Date.now();
    if (TL.on) tl(`release ${preview?.kind ?? 'none'}`);
    if (!cancelled && preview?.kind === 'ok') {
      const c0 = PERF_ENABLED ? performance.now() : 0;
      const ok = placementStore.commit({ layout: preview.layout, falls: preview.falls });
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
  const onHandleRef = useRef<(phase: 'begin' | 'move' | 'end' | 'cancel', dx: number, dy: number) => void>(() => {});
  const handleJS = useCallback((phase: 'begin' | 'move' | 'end' | 'cancel', dx: number, dy: number) => onHandleRef.current(phase, dx, dy), []);
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
        .onFinalize((_e, success) => {
          scheduleOnRN(handleJS, success ? 'end' : 'cancel', 0, 0);
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
    tasks.later('trace-end', () => {
      if (tlSession.current !== s) return;
      tl('tl-end');
      tlOn.value = false;
      tasks.later('trace-flush', () => {
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
  useLayoutEffect(() => () => {
    cancelAnimationFrame(dragJs.current.raf);
    dragJs.current.raf = 0;
    tlOn.value = false;
    TL.on = false;
    perfFrames.setActive(false);
  }, [perfFrames, tlOn]);
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
    const benchRows: BenchRow[] = rows.flatMap((r) => {
      const mo = motions.find((entry) => entry.shelfId === r.shelfId)?.m;
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
    if (!on && dragRef.current) finishDrag();
    if (on === editing) return;
    if (!on) {
      const last = rows.at(-1);
      const h = Math.max(vpH, (last ? last.top + last.height : 0) + (SHELF_CAST_EXTENT + 8) * m.scale);
      const max = Math.max(0, h - vpH);
      setTailPad(panelH);
      if (scrollY.value > max) {
        tasks.later('edit-scroll', () => {
          scheduleOnUI(() => {
            'worklet';
            scrollTo(scrollRef, 0, max, true);
          });
        }, 0);
        tasks.later('tail-padding', () => setTailPad(0), 450);
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
      tasks.later('sheet-scroll', () => scrollRef.current?.scrollTo({ y, animated: !reduceMotion }), 0);
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
      tasks.later('tail-padding', () => setTailPad(0), 450);
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
  const menuMove = (mv: MoveAction, id = popId): string | null => {
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
    tasks.later(`warm-${id}`, () => {
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
        if (!tasks.active()) return false;
        const live = liveSV.value;
        if (ids.every((id) => live[id]?.[TRANSIT_ROW])) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      if (TL.on) tl(`undo-ready ${ids.join(',')}`);
      releaseLater(ids);
      // 기다리는 동안 다른 조작이 확정됐으면(되돌릴 대상이 바뀜) 그 조작을 대신 되돌리지 않는다
      if (placementStore.get().undo !== back) return false;
    }
    return tasks.active() && placementStore.undo();
  }, [holdRows, releaseLater]);

  const { editPlacement, editDisplayPose, canLean, editPose, editLean, onHandle, headOffX, headOffY, anglesText, editDepth, depthInfo, editSpin } = useShelfEditCommands({
    layout, books, editId, motions, scale: m.scale, reduceMotion, settled, commit,
    getCommittedLayout: () => placementStore.get().layout,
    getFallDirections: () => placementStore.get().fallDirections,
    setEditId, setEditMsg,
  });
  onHandleRef.current = onHandle;
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
        openBook(bookId);
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
  const glowId = drag ? drag.bookId : editing ? editId : (popId ?? selectedId);
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
      {/* 시안 비율: 제목 잉크 약 86×21.5DU(예전 시안 글자 그림과 같은 크기를 Pretendard SemiBold 23.5DU 글자로), 연도는 그 아래 보조 정보,
          오른쪽 '전체 책'(글자 버튼)과 원형 더하기 32DU, 좌우 여백 23/18DU. 글자는 중립 회색(갈색 기 없음, 2026-10-31).
          머리글 높이가 정해져 있어 시스템 글자 확대는 1.3배까지만 따른다(선반과 겹치지 않게) */}
      {bare ? null : (
        <View style={[styles.header, { paddingLeft: 26 * m.scale + m.originX, paddingRight: 22 * m.scale + m.originX, paddingTop: (55 - headerGrow) * m.scale, height: 104 * m.scale }]}>
          <Pressable style={{ flex: 1 }} onPress={() => setShelfMenuOpen(true)} accessibilityRole="button" accessibilityLabel={ko.menu.title}>
            <Text style={[styles.title, { fontSize: 23.5 * m.scale, lineHeight: 29 * m.scale, letterSpacing: -0.2 * m.scale }]} numberOfLines={1} maxFontSizeMultiplier={HEADER_TEXT_MAX} accessibilityRole="header">
              {ko.title}
            </Text>
            <Pressable
              onPress={() => setSelectedYear(years[(years.indexOf(year) + 1) % years.length])}
              disabled={years.length < 2}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={ko.yearA11y(year, count)}
              style={{ alignSelf: 'flex-start' }}>
              <Text style={[styles.summary, { fontSize: 13.5 * m.scale, lineHeight: 18 * m.scale, marginTop: 4 * m.scale }]} maxFontSizeMultiplier={HEADER_TEXT_MAX}>
                {ko.year(year)}
                {years.length > 1 ? ' ▾' : ''}
                {editing ? ` · ${ko.decorating}` : ''}
              </Text>
            </Pressable>
          </Pressable>
          <View style={[styles.actions, { gap: 8 * m.scale, marginTop: (-18 + headerGrow / 2) * m.scale }]}>
            {/* 꾸미기를 끌며 시작한 동안(머리글을 아직 숨기기 전)에는 더하기를 숨긴다 */}
            {editing ? null : (
              <>
                {/* 등록한 모든 책(책장에 없는 책 포함)을 보고 골라 책장에 놓는 곳. 보관함 아이콘 대신 글자 */}
                <Pressable onPress={() => router.push('/books')} hitSlop={{ top: 8, bottom: 8, left: 6, right: 2 }} accessibilityRole="button" accessibilityLabel={ko.allBooks.title} style={({ pressed }) => [styles.allBooks, pressed && press]}>
                  <Text style={[styles.allBooksText, { fontSize: 15 * m.scale }]} maxFontSizeMultiplier={HEADER_TEXT_MAX}>{ko.allBooks.title}</Text>
                </Pressable>
                {/* 시안: 둥근 테두리 원 버튼(약 33DU)과 굵은 더하기 */}
                <HeaderButton size={33.5 * m.scale} label={ko.add} onPress={() => router.push('/book/add')}>
                  <Plus size={18 * m.scale} color={colors.homeTitle} strokeWidth={1.9} />
                </HeaderButton>
              </>
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
            closeBook();

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
        <TabBarVeil
          scrollY={scrollY}
          contentBottom={rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : 0}
          barTop={vpH - navigation.height - insets.bottom}
          height={navigation.height + insets.bottom}
          hidden={editing}
          instant={reduceMotion}
        />

        {popId && books[popId] && placementOf(layout, popId) ? (
          <BookSheet
            book={books[popId]}
            status={lib.books[popId] ? STATUS_LABEL[lib.books[popId].status] : undefined}
            bottomInset={insets.bottom}
            reduceMotion={reduceMotion}
            onTop={revealAboveSheet}
            onClose={() => {
              closeBook();

            }}
            onDetail={() => {
              const id = popId;
              closeBook();

              router.push(`/book/${id}`);
            }}
            onRead={() => {
              const id = popId;
              closeBook();

              router.push({ pathname: '/read', params: { book: id } });
            }}
            onBookmark={() => {
              const id = popId;
              closeBook();

              router.push({ pathname: '/bookmark/new', params: { book: id } });
            }}
          />
        ) : null}


        {!store.demo && !editing && !layout.placements.length ? (
          <View pointerEvents="box-none" style={styles.emptyWrap}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{ko.empty.title}</Text>
              <Text style={styles.emptyBody}>{layout.drawer.length ? `${ko.empty.body}\n책장에 없는 책이 ${layout.drawer.length}권 있어요.` : ko.empty.body}</Text>
              <Btn label={ko.add} onPress={() => router.push('/book/add')} icon={<Plus size={icon.small} color={ui.onAccent} strokeWidth={icon.stroke} />} style={styles.emptyBtn} />
              {layout.drawer.length ? <TextLink label="전체 책에서 고르기" tone="soft" onPress={() => router.push({ pathname: '/books', params: { filter: 'off' } })} style={{ marginTop: 4 }} /> : null}
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
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); closeBook();  setEditingKeep(true); }}>
            <Paintbrush size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.decorate}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/search'); }}>
            <Search size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.menu.search}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/books'); }}>
            <BookMarked size={icon.size} color={ui.ink} strokeWidth={icon.stroke} /><Text style={styles.menuText}>{ko.allBooks.title}{layout.drawer.length ? ` · 책장에 없는 책 ${layout.drawer.length}권` : ''}</Text>
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
  title: { fontFamily: uiFonts.uiBold, color: colors.homeTitle, includeFontPadding: false },
  summary: { fontFamily: uiFonts.ui, color: colors.homeSummary, includeFontPadding: false },
  allBooks: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  allBooksText: { fontFamily: uiFonts.ui, color: colors.homeTitle, includeFontPadding: false },
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
  emptyBtn: { marginTop: space.group, paddingHorizontal: 24 },
  menuDivider: { height: shape.hairline, backgroundColor: ui.line, marginVertical: 6 },
});
