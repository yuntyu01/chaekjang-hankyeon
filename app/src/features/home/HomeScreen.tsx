// 홈 책장. 선반 전체를 하나의 제스처로 받아 책 윤곽으로 터치를 판정한다(그림자는 판정에서 제외).
// 짧게 누르기 → 정보 상자, 350ms 길게 누르기 → 드래그. 드래그 전 세로 이동은 스크롤이 가져간다.
// 드래그: 같은 선반은 올라간 책과 자리 바꾸기, 다른 선반은 그 자리에 끼우기(눕힌 책 가운데면 쌓기),
// 세 선반 사이에서 이동한다. 화면 가장자리에서 자동 스크롤.
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BookMarked, ChartNoAxesColumn, Eraser, Menu, Paintbrush, Plus, Search, Settings, Undo2 } from 'lucide-react-native';
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

import { DESIGN_WIDTH, PLANK_INSET, SHELF, SHELF_FRONT, SHELF_THICK, SHELF_USABLE_WIDTH, kyOf, VIEW_DEG_PER_DP, VIEW_KX, VIEW_PITCH_MAX, VIEW_PITCH_MIN, viewSettle } from '@/domain/geometry';
import { useViewStore, viewStore } from '@/store/view-store';
import {
  applySwapTarget,
  detach,
  findDropTarget,
  findSwapTarget,
  moveBook,
  moveBy,
  moveToDrawer,
  moveToShelf,
  placeFromDrawer,
  placementOf,
  rotateStep,
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
  sortedShelves,
  type SwapTarget,
  type FailReason,
  type Result,
} from '@/domain/layout-engine';
import { corners, fromPlaced, type Book3 } from '@/domain/book3';
import { bodiesOf, computeShelf, hitTest, PLANK_BOUNDS, withLeans, type BookFrame } from '@/domain/shelf-scene';
import { planTransition } from '@/domain/transition';
import type { Pose, ShelfLayout, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { settingsStore, useSettings } from '@/store/settings-store';
import { uiBus } from '@/store/ui-bus';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { DragOverlay, frameBBox } from '@/ui/shelf/DragOverlay';
import { CONTENT_TOP, computeRows, LAYOUT, rowAt, toContent, toScene, useShelfMetrics, type RowGeom } from '@/ui/shelf/metrics';
import { benchProjection, currentStates, motionOf, previewShelf, type BenchRow } from '@/ui/shelf/ShelfMotion';
import { ANIM, frameStats, PERF_DETAIL, PERF_ENABLED, PERF_LEVELS, setPerfLevel, setShelfMode, setShelfView, SHELF_MODES, SHELF_VIEWS, type PerfLevel, type ShelfMode } from '@/ui/perf';
import type { FrontState } from '@/domain/front-pose';
import { ShelfRow, type DropHint } from '@/ui/shelf/ShelfRow';
import { SHELF_CAST_EXTENT } from '@/ui/shelf/ShelfPlank';
import { colors, fonts, motion, navigation } from '@/ui/theme';

import { type MoveAction } from './BookDetail';
import { BookPopover } from './BookPopover';
import { tabBarStyle } from '@/ui/tabBar';

import { DecoratePanel } from './DecoratePanel';

type HintKind = SwapTarget['kind'] | 'beside';
// key: 같은 목표면 다시 계산하지 않으려는 식별자. shelfId: 안내를 띄울 선반
// index: 끼울 순서(다음 계산에서 경계 근처 떨림을 막는 데 쓴다)
type Preview =
  | { kind: 'ok'; layout: ShelfLayout; key: string; shelfId: string; hint: HintKind; index?: number }
  | { kind: 'same'; key: string; shelfId: string; hint: HintKind; index?: number }
  | { kind: 'bad'; reason: FailReason | 'outside'; key: string; shelfId: string | null; index?: number };

type Drag = {
  bookId: string;
  frame: BookFrame; // 집어 든 순간의 모양(오버레이 렌더용)
  from: Book3 | null; // 집어 든 순간 화면에 보이던 3D 자세(움직이는 도중이면 그 모습)
  boxW: number; // px
  grabX: number;
  grabY: number;
  preview: Preview | null;
  settling: ShelfLayout | null; // 놓은 뒤 스냅 애니메이션 동안 보여줄 레이아웃
  shelfId: string; // 꾹 누른 책의 원래 선반
  // 잡은 지점: 손가락 x(뷰포트)와 그때 책 상자(기대기 전 곧은 상자)의 가운데(DU). 놓을 자리는 이 둘의 차이만큼만 옮긴다
  // (기운 책의 화면 윤곽 가운데를 기준으로 하면 잡자마자 곧은 상자와의 차이만큼 자리가 튄다)
  startVx: number;
  startCenterDU: number;
};

type Toast = { text: string; action?: 'undo' | 'retry' } | null;
type Box = { x0: number; y0: number; x1: number; y1: number };

// 꾸미기 시점 끌기 영역(선반 앞면 띠)의 최소 높이·위아래 여유(px)
const FRONT_HIT = 48;
const FRONT_PAD = 10;

const shiftRows = (rows: RowGeom[], dy: number) => (dy ? rows.map((r) => ({ ...r, top: r.top + dy })) : rows);

// 선반별 프레임을 캐시해서 바뀐 선반만 다시 그린다.
function useShelfScenes(layout: ShelfLayout, books: Parameters<typeof computeShelf>[1], pitch: number) {
  const cache = useRef(new Map<string, { sig: string; books: typeof books; frames: BookFrame[] }>());
  return useMemo(() => {
    const out = new Map<string, BookFrame[]>();
    for (const s of layout.shelves) {
      // 보기 각이 바뀌면 투영(터치 영역)도 다시
      const sig = pitch + JSON.stringify(layout.placements.filter((p) => p.shelfId === s.id));
      const hit = cache.current.get(s.id);
      if (hit && hit.sig === sig && hit.books === books) {
        out.set(s.id, hit.frames);
        continue;
      }
      const frames = computeShelf(layout, books, s.id).frames;
      cache.current.set(s.id, { sig, books, frames });
      out.set(s.id, frames);
    }
    return out;
  }, [layout, books, pitch]);
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
  const m = useShelfMetrics();
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
  const [editing, setEditing] = useState(false);
  const [panelH, setPanelH] = useState(0);
  const leanRef = useRef<boolean | undefined>(undefined); // 앞뒤 막대를 끄는 동안의 벽 기대기 상태
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shelfMenuOpen, setShelfMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastDragEnd = useRef(0);
  const popScroll = useRef(0); // 정보 상자를 연 순간의 스크롤(렌더 중에 공유값을 읽지 않으려고)

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const contentH = useSharedValue(0);
  const active = useSharedValue(false);
  const grab = useSharedValue({ x: 0, y: 0 });
  const vpOrigin = useSharedValue({ x: 0, y: 0 }); // 뷰포트의 창(window) 좌표
  const pointer = useSharedValue({ x: 0, y: 0 }); // 뷰포트 좌표
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);


  // ---------- 보기 각(내려다보기 3°~8°): 꾸미기에서 선반 앞면을 위아래로 끌어 바꾼다(빈 벽을 끌면 스크롤) ----------
  // 화면 카메라는 공유 값(UI 스레드, 끄는 동안 매 프레임). 확정된 각은 보기 설정으로 저장하고 터치 영역·줄 높이에 쓴다.
  const view = useViewStore();
  const pitchSV = useSharedValue(view.pitch);
  const viewGoal = useSharedValue(view.pitch);
  const camSV = useDerivedValue(() => ({ kx: VIEW_KX, ky: Math.tan((pitchSV.value * Math.PI) / 180) }));
  useEffect(() => {
    if (view.loaded) {
      pitchSV.value = view.pitch;
      viewGoal.value = view.pitch;
    }
    // 불러온 뒤 한 번만(끄고 놓을 때는 애니메이션이 직접 맞춘다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.loaded]);
  const savePitch = useCallback((deg: number) => {
    if (deg !== viewStore.get().pitch) viewStore.setPitch(deg);
  }, []);
  // 줄 높이: 꾸미기 중에는 가장 내려다보는 각 기준(시점을 끌고 놓아도 줄이 튀지 않게), 평소에는 지금 보기 각
  const rowKy = editing ? kyOf(VIEW_PITCH_MAX) : undefined;
  // 꾸미기에 들어가고 나올 때 줄 높이가 바뀌어도(8° 기준 ↔ 지금 각) 보던 줄의 선반 바닥이 화면에서 제자리에 있도록
  // 줄 전체를 옮기는 양(rowShift)과, 나올 때 줄어드는 목록 끝을 잠시 유지하는 여백(tailPad)
  const [rowShift, setRowShift] = useState(0);
  const [tailPad, setTailPad] = useState(0);
  const pendingScroll = useRef<number | null>(null);


  const shelves = useMemo(() => sortedShelves(layout), [layout]);
  // 저장본을 불러와 처음 그릴 때는 움직이지 않는다(예시 배치에서 저장된 배치로 날아가지 않게)
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!store.loaded) return;
    const id = setTimeout(() => setSettled(true), 400);
    return () => clearTimeout(id);
  }, [store.loaded]);

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // 꾸미는 중에는 되돌리기가 상단에 있으므로 '옮겼어요 · 되돌리기' 알림은 띄우지 않는다
  const editingRef = useRef(false);
  const showToast = useCallback((t: Toast) => {
    if (editingRef.current && t?.action === 'undo') return;
    setToast(t);
  }, []);
  useEffect(() => {
    if (!toast || toast.action === 'retry') return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (store.save === 'error') setToast({ text: ko.saveError, action: 'retry' });
  }, [store.save]);
  useEffect(() => {
    if (!store.notice) return;
    setToast({ text: ko.refitMoved(store.notice) });
    placementStore.clearNotice();
  }, [store.notice]);

  const commit = useCallback(
    (r: Result, text: string = ko.moved): string | null => {
      if (!r.ok) return ko.fail[r.reason] || null;
      if (!placementStore.commit(r.layout)) return ko.fail['no-space'];
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

  const computePreview = (d: Drag, vx: number, vy: number, scroll: number): Preview => {
    const cy = vy + scroll;
    const index = rowIndexAt(cy);
    const centerPx = vx - d.grabX + d.boxW / 2;
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
      if (r.ok) return { kind: 'ok', layout: r.layout, key, shelfId, hint: t.kind, index: at };
      if (r.reason === 'no-change') return { kind: 'same', key, shelfId, hint: 'self', index: at };
      return { kind: 'bad', reason: r.reason, key, shelfId, index: at };
    }
    const p = placementOf(layout, d.bookId)!;
    const t = findDropTarget(detach(layout, d.bookId, books), books, shelfId, centerDU, p.pose, d.boxW / m.scale);
    const at = t.kind === 'insert' ? t.index : undefined;
    const key = `other:${JSON.stringify(t)}`;
    const hit = reuse(key);
    if (hit) return hit;
    const r = moveBook(layout, books, d.bookId, t);
    if (r.ok) return { kind: 'ok', layout: r.layout, key, shelfId, hint: t.kind === 'stack' ? 'stack' : 'place', index: at };
    return { kind: 'bad', reason: r.reason, key, shelfId, index: at };
  };

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
      popScroll.current = scrollY.value;
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
  const onTap = (x: number, y: number) => {
    if (Date.now() - lastDragEnd.current < 350 || dragRef.current) return;
    if (Date.now() - handleAt.current < 400) return; // 머리 손잡이를 누른 탭은 책 고르기가 아니다
    const hit = hitAt(x, y);
    if (editing) {
      // 꾸미는 중: 짧게 누르면 그 책을 고른다(정보 상자는 띄우지 않는다)
      setEditMsg(null);
      setEditId(hit ? hit.bookId : null);
      return;
    }
    if (!hit) {
      setPopId(null);
      setSelectedId(null);
      return;
    }
    setSelectedId(hit.bookId);
    popScroll.current = scrollY.value;
    setTimeout(() => setPopId(hit.bookId), reduceMotion ? 0 : 120);
  };

  const hitAt = (x: number, y: number) => {
    const row = rows[rowAt(rows, y)];
    if (!row) return null;
    return hitTest(frames.get(row.shelfId) ?? [], toScene(m, row, x, y));
  };

  const beginDrag = (x: number, y: number, absX: number, absY: number, scroll: number) => {
    const hit = hitAt(x, y);
    if (!hit) return;
    // 꾹 눌러 책을 집으면 꾸미기 모드가 시작된다(집은 책의 줄이 제자리에 있게)
    setEditingKeep(true, hit.shelfId);
    setPopId(null);
    setEditMsg(null);
    setEditId(hit.bookId);
    const row = rows.find((r) => r.shelfId === hit.shelfId)!;
    const box = frameBBox(hit);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    const d: Drag = {
      bookId: hit.bookId,
      frame: hit,
      from: (() => {
        const mo = motionOf(hit.shelfId);
        return mo ? currentStates(mo)[hit.bookId] ?? null : null;
      })(),
      boxW: box.width * m.scale,
      grabX: x - tl.x,
      grabY: y - tl.y,
      preview: { kind: 'same', key: `same:${JSON.stringify({ kind: 'self' })}`, shelfId: hit.shelfId, hint: 'self' },
      settling: null,
      shelfId: hit.shelfId,
      startVx: x,
      startCenterDU: (() => {
        const bx = boxOf(layout, books, hit.bookId);
        if (!bx) return (box.minX + box.width / 2);
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of corners(fromPlaced(bx))) {
          lo = Math.min(lo, c.x);
          hi = Math.max(hi, c.x);
        }
        return (lo + hi) / 2;
      })(),
    };
    grab.value = { x: d.grabX, y: d.grabY };
    vpOrigin.value = { x: absX - x, y: absY - (y - scroll) };
    pointer.value = { x, y: y - scroll };
    dragX.value = tl.x;
    dragY.value = tl.y - scroll;
    active.value = true;
    if (settingsStore.get().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedId(null);
    updateDrag(d);
    if (PERF_ENABLED) dragPerfStart();
  };

  const moveDrag = (vx: number, vy: number, scroll: number) => {
    const d = dragRef.current;
    if (!d || d.settling) return;
    const preview = computePreview(d, vx, vy, scroll);
    if (preview === d.preview) return;
    updateDrag({ ...d, preview });
  };

  const finishDrag = () => {
    lastDragEnd.current = Date.now();
    updateDrag(null);
    if (PERF_ENABLED) dragPerfStop();
  };

  // 놓기: 유효하면 확정·저장 후 새 자리로 스냅, 아니면 원래 자리로 복귀.
  const endDrag = (cancelled: boolean) => {
    const d = dragRef.current;
    active.value = false;
    if (!d) return;
    lastDragEnd.current = Date.now();
    let final = layout;
    let committed = false;
    if (!cancelled && d.preview?.kind === 'ok') {
      committed = placementStore.commit(d.preview.layout);
      if (committed) {
        final = d.preview.layout;
        showToast({ text: ko.moved, action: 'undo' });
      }
    } else if (!cancelled && d.preview?.kind === 'bad') {
      showToast({ text: ko.fail[d.preview.reason] || ko.fail.outside });
    }
    // 후보 자리에 선반 안 책으로 보이고 있었으면(끌기 표시가 없다) 그대로 끝낸다: 확정됐으면 그 자리, 아니면 선반 안에서 원래 자리로
    if (d.preview?.kind === 'ok' || d.preview?.kind === 'same') {
      if (!committed && d.preview.kind === 'ok' && settingsStore.get().haptics) void Haptics.selectionAsync().catch(() => {});
      finishDrag();
      setEditId(d.bookId);
      return;
    }
    // 떠 있던 책(자리 없음·선반 밖): 원래 자리로 돌아가 앉힌다
    const pl = placementOf(final, d.bookId)!;
    const finalRows = shiftRows(computeRows(final, books, m.scale, vpH, navigation.height + insets.bottom, rowKy), rowShift);
    const row = finalRows.find((r) => r.shelfId === pl.shelfId)!;
    const f = computeShelf(final, books, pl.shelfId).frames.find((fr) => fr.bookId === d.bookId)!;
    const box = frameBBox(f);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    updateDrag({ ...d, frame: f, from: null, settling: final });
    const dur = reduceMotion ? 0 : motion.settle;
    dragX.value = withTiming(tl.x, { duration: dur });
    dragY.value = withTiming(tl.y - scrollY.value, { duration: dur }, () => {
      scheduleOnRN(finishDrag);
    });
    if (settingsStore.get().haptics) void Haptics.selectionAsync().catch(() => {});
    // 놓은 뒤에도 꾸미기 모드는 유지하고, 놓은 책을 고른 상태로 둔다
    setEditId(d.bookId);
  };

  // 화면 이탈·앱 비활성화: 임시 배치를 버리고 확정 상태 유지
  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return;
    active.value = false;
    lastDragEnd.current = Date.now();
    updateDrag(null);
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
  const jsRef = useRef({ beginDrag, moveDrag, endDrag, onTap });
  jsRef.current = { beginDrag, moveDrag, endDrag, onTap };
  const jsBegin = useCallback((x: number, y: number, ax: number, ay: number, sc: number) => jsRef.current.beginDrag(x, y, ax, ay, sc), []);
  const jsMove = useCallback((x: number, y: number, sc: number) => jsRef.current.moveDrag(x, y, sc), []);
  const jsEnd = useCallback((cancel: boolean) => jsRef.current.endDrag(cancel), []);
  const jsTap = useCallback((x: number, y: number) => jsRef.current.onTap(x, y), []);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(motion.longPress)
        .onStart((e) => {
          scheduleOnRN(jsBegin, e.x, e.y, e.absoluteX, e.absoluteY, scrollY.value);
        })
        .onUpdate((e) => {
          if (!active.value) return;
          const vx = e.absoluteX - vpOrigin.value.x;
          const vy = e.absoluteY - vpOrigin.value.y;
          pointer.value = { x: vx, y: vy };
          dragX.value = vx - grab.value.x;
          dragY.value = vy - grab.value.y;
          scheduleOnRN(jsMove, vx, vy, scrollY.value);
        })
        .onFinalize((_e, success) => {
          scheduleOnRN(jsEnd, !success);
        }),
    [jsBegin, jsMove, jsEnd, scrollY, active, vpOrigin, pointer, dragX, dragY, grab],
  );
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(300)
        .maxDistance(10)
        .onEnd((e, success) => {
          if (success) scheduleOnRN(jsTap, e.x, e.y);
        }),
    [jsTap],
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
        })
        ,
    [handleJS],
  );
  // 목록 스크롤(네이티브 ScrollView). 손잡이·선반 앞면(시점)에서 시작한 끌기가 잡혀 있는 동안은 스크롤이 기다린다.
  const scrollNative = useMemo(() => Gesture.Native(), []);
  useMemo(() => {
    pan.requireExternalGestureToFail(headPan);
    tap.requireExternalGestureToFail(headPan);
    headPan.blocksExternalGesture(scrollNative);
  }, [pan, tap, headPan, scrollNative]);
  // 꾸미기 모드 시점 끌기: 누른 곳으로 역할을 정하고 놓을 때까지 유지한다.
  //   책 몸통 → 책 조작(탭·길게 눌러 옮기기), 고른 책 머리 손잡이 → 손잡이, 선반 앞면(넉넉한 띠) → 시점, 그 밖의 빈 벽 → 스크롤.
  // 선반 앞면에서 누르면 바로 잡아(스크롤이 끼어들지 않게) 손가락이 책 위를 지나가도 시점 조절로 남는다.
  // 판정 영역은 JS에서 줄마다 미리 계산한 콘텐츠 좌표 사각형으로 넘겨 둔다(UI 스레드에서 바로 판정).
  const bookBoxes = useSharedValue<Box[]>([]);
  const frontBoxes = useSharedValue<Box[]>([]);
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
          const inside = (r: Box) => t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
          for (const r of bookBoxes.value) {
            if (inside(r)) {
              mgr.fail();
              return;
            }
          }
          let front = false;
          for (const r of frontBoxes.value) if (inside(r)) front = true;
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
    [editingSV, bookBoxes, frontBoxes, viewStart, pitchSV, viewGoal, reduceMotionSV, savePitch, scrollNative],
  );
  const gesture = useMemo(() => Gesture.Simultaneous(viewPan, Gesture.Race(pan, tap)), [viewPan, pan, tap]);

  // 가장자리 자동 스크롤. 스크롤하면서도 최신 좌표로 놓을 자리를 다시 계산한다.
  useFrameCallback(() => {
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
    scheduleOnRN(moveDrag, pointer.value.x, pointer.value.y, next);
  });

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // ---------- 성능 측정(EXPO_PUBLIC_PERF=1 번들에서만 메뉴에 보인다) ----------
  // 같은 배치에서 그리기 단계를 바꿔 가며: ① 가만히 있을 때 ② 시점 3°→8°→3° 두 번(UI 스레드만, React 없음)의 실제 프레임 간격,
  // ③ 투영 계산만(그리기 없이 같은 함수), ④ 시점 확정 후 React 갱신(렌더·커밋) 시간과 그 뒤 프레임.
  const [perfKey, setPerfKey] = useState(0);
  const [shelfView, setShelfViewState] = useState<(typeof SHELF_VIEWS)[number]>('전체');
  // 측정 번들에서만: chaekjang:///?sv=0~4 로 선반 보기를 바로 고른다(비교 캡처용)
  // lv=<그리기 단계>(예: full, cast)로 단계만 바꿔 같은 화면을 비교한다
  const { sv, lv, sh, gap, rowfit, cam: camDebug, pitch: pitchParam, slow } = useLocalSearchParams<{ sv?: string; lv?: string; sh?: string; gap?: string; rowfit?: string; cam?: string; pitch?: string; slow?: string }>();
  if (PERF_ENABLED && slow !== undefined) ANIM.slow = Math.max(1, Number(slow) || 1);
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
  // 줄 높이 계산(rows) 전에 렌더 중에 바로 반영한다(효과에서 바꾸면 rows가 한 단계 늦은 값으로 계산된다)
  if (PERF_ENABLED && gap !== undefined) LAYOUT.topGap = Number(gap);
  // 비교안: chaekjang:///?rowfit=0.5 → 줄마다 필요한 높이 쪽으로 선반 위 공간을 절반만큼 줄인다
  if (PERF_ENABLED && rowfit !== undefined) LAYOUT.rowFit = Number(rowfit);
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
  const perfFrames = useFrameCallback((fi) => {
    if (!perfOn.value || fi.timeSincePreviousFrame === null) return;
    const dt = fi.timeSincePreviousFrame;
    perfDts.modify((a) => {
      'worklet';
      a.push(dt);
      return a;
    });
  }, false);
  const perfCommit = useRef<{ t0: number; done: (ms: number) => void } | null>(null);
  useEffect(() => {
    const c = perfCommit.current;
    if (!c) return;
    perfCommit.current = null;
    c.done(performance.now() - c.t0);
  }, [view.pitch]);
  // 책 끌기 한 번(집기 ~ 놓고 자리 잡기)의 프레임 간격
  const dragPerfStart = () => {
    perfDts.value = [];
    perfFrames.setActive(true);
    perfOn.value = true;
  };
  const dragPerfStop = () => {
    perfOn.value = false;
    perfFrames.setActive(false);
    console.log('[perf-drag]', JSON.stringify(frameStats(perfDts.value)));
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
      return mo ? [{ m: mo, clear: r.clear, plankAbove: i > 0 }] : [];
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
    setToast({ text: `${level} 전환 ${sweep.mean}ms(p90 ${sweep.p90}) 계산 ${(calc.faces + calc.received + calc.cast).toFixed(1)}ms React ${Math.round(reactMs)}ms` });
    viewStore.setPitch(VIEW_PITCH_MIN);
    pitchSV.value = VIEW_PITCH_MIN;
    viewGoal.value = VIEW_PITCH_MIN;
  };

  // ---------- 표시할 레이아웃 ----------
  const shown = drag?.settling ?? (drag?.preview?.kind === 'ok' ? drag.preview.layout : layout);
  // 끄는 책이 후보 선반의 자리(또는 제자리)에 있으면 선반 안 책으로 그린다(실제 깊이·가림 그대로, 떠 있는 끌기 표시 없음).
  // 놓을 곳이 없을 때(선반 밖·자리 없음)만 손가락을 따라가는 끌기 표시로 그린다. 어느 때든 한 권만.
  const dragInRow = !!drag && !drag.settling && (drag.preview?.kind === 'ok' || drag.preview?.kind === 'same');
  const shownShelves = useMemo(() => sortedShelves(shown), [shown]);
  const frames = useShelfScenes(shown, books, view.pitch);
  // Keep drop bands steady while a book travels between differently sized rows.
  const rows = useMemo(() => {
    const base = drag && !drag.settling ? layout : shown;
    return shiftRows(computeRows(base, books, m.scale, vpH, navigation.height + insets.bottom, rowKy), rowShift);
  }, [shown, layout, books, m.scale, vpH, insets.bottom, !!drag, drag?.settling, view.pitch, rowKy, rowShift, gap, rowfit]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.shelfId, r])), [rows]);
  useEffect(() => {
    const out: Box[] = [];
    const fronts: Box[] = [];
    for (const row of rows) {
      for (const f of frames.get(row.shelfId) ?? []) {
        const bb = frameBBox(f);
        const a = toContent(m, row, { x: bb.minX, y: bb.minY });
        const b = toContent(m, row, { x: bb.minX + bb.width, y: bb.minY + bb.height });
        // 아래로는 넓히지 않는다(책은 바닥선 밑으로 내려가지 않고, 바로 아래가 선반 앞면이다)
        out.push({ x0: a.x - 4, y0: a.y - 4, x1: b.x + 4, y1: b.y });
      }
      // 선반 앞면이 3°~8°에서 지나는 범위(윗모서리 3° ~ 아래모서리 8°)를 위아래로 넓혀 최소 FRONT_HIT 높이로
      const floor = row.top + row.clear * m.scale;
      let y0 = floor + SHELF_FRONT * kyOf(VIEW_PITCH_MIN) * m.scale;
      let y1 = floor + (SHELF_FRONT * kyOf(VIEW_PITCH_MAX) + SHELF_THICK) * m.scale;
      const grow = Math.max(FRONT_PAD, (FRONT_HIT - (y1 - y0)) / 2);
      y0 -= grow;
      y1 += grow;
      fronts.push({ x0: m.originX + PLANK_INSET * m.scale, y0, x1: m.originX + (DESIGN_WIDTH - PLANK_INSET) * m.scale, y1 });
    }
    bookBoxes.value = out;
    frontBoxes.value = fronts;
  }, [rows, frames, m, bookBoxes, frontBoxes]);

  // 꾸미기 켜기·끄기: 새 줄 높이로 바꾸면서 기준 줄(집은 책의 줄, 없으면 보이는 영역 가운데 줄)의 선반 바닥이
  // 화면에서 같은 자리에 오도록 줄을 옮긴다. 맨 윗줄이 콘텐츠 위 끝을 넘으면 넘는 만큼 스크롤로 받는다.
  const setEditingKeep = (on: boolean, anchorShelfId?: string) => {
    if (on === editing) return;
    const base = drag && !drag.settling ? layout : shown;
    const next = computeRows(base, books, m.scale, vpH, navigation.height + insets.bottom, on ? kyOf(VIEW_PITCH_MAX) : kyOf(view.pitch));
    if (!rows.length || next.length !== rows.length) {
      setEditing(on);
      return;
    }
    const sc = scrollY.value;
    const visible = editing ? vpH - panelH : vpH - navigation.height - insets.bottom;
    const mid = sc + visible / 2;
    let ai = anchorShelfId ? rows.findIndex((r) => r.shelfId === anchorShelfId) : rows.findIndex((r) => mid >= r.top && mid < r.top + r.height);
    if (ai < 0) ai = mid < rows[0].top ? 0 : rows.length - 1;
    const floorOf = (r: RowGeom) => r.top + r.clear * m.scale;
    let shift = floorOf(rows[ai]) - floorOf(next[ai]);
    let scroll = sc;
    if (next[0].top + shift < CONTENT_TOP) {
      scroll += CONTENT_TOP - (next[0].top + shift);
      shift = CONTENT_TOP - next[0].top;
    }
    // 나올 때: 조작부 여백이 빠져 목록 끝이 줄어도 지금 스크롤이 잘리지 않게 여백을 남겼다가, 넘친 만큼은 부드럽게 올린 뒤 뺀다
    if (!on) {
      const last = next.at(-1)!;
      const h = Math.max(vpH, last.top + shift + last.height + (SHELF_CAST_EXTENT + 8) * m.scale);
      const max = Math.max(0, h - vpH);
      setTailPad(panelH);
      if (scroll > max) {
        const to = max;
        setTimeout(() => {
          scheduleOnUI(() => {
            'worklet';
            scrollTo(scrollRef, 0, to, true);
          });
        }, 0);
        setTimeout(() => setTailPad(0), 450);
      } else setTailPad(0);
    }
    if (Math.abs(scroll - sc) >= 0.5) pendingScroll.current = scroll;
    setRowShift(shift);
    setEditing(on);
  };
  // 줄을 옮긴 렌더가 반영된 직후 같은 프레임에 스크롤을 맞춘다
  useLayoutEffect(() => {
    const y = pendingScroll.current;
    if (y === null) return;
    pendingScroll.current = null;
    scheduleOnUI(() => {
      'worklet';
      scrollTo(scrollRef, 0, y, false);
    });
  }, [rowShift, editing, scrollRef]);

  // 정보 상자 위치: 위 선반 칸(화면 밖이면 아래 칸)을 덮는 선반 크기 상자. 한 줄뿐이면 책 위 빈 곳.
  const popAnchor = useMemo(() => {
    if (!popId) return null;
    const p = placementOf(shown, popId);
    const idx = p ? rows.findIndex((r) => r.shelfId === p.shelfId) : -1;
    const row = rows[idx];
    const f = row && frames.get(p!.shelfId)?.find((fr) => fr.bookId === popId);
    if (!row || !f) return null;
    const sy = popScroll.current;
    const box = frameBBox(f);
    const cx = toContent(m, row, { x: box.minX + box.width / 2, y: 0 }).x;
    const left = m.originX + PLANK_INSET * m.scale;
    const width = (DESIGN_WIDTH - PLANK_INSET * 2) * m.scale;
    // 칸: 줄 윗끝부터 선반 판 윗면 조금 위까지(책이 서는 공간)
    const slot = (r: (typeof rows)[number]) => ({ left, width, top: r.top - sy + 2, height: r.clear * m.scale - 2 });
    const fits = (b: { top: number; height: number }) => b.top >= 0 && b.top + b.height <= vpH - navigation.height - insets.bottom;
    const up = idx > 0 ? slot(rows[idx - 1]) : null;
    const down = idx + 1 < rows.length ? slot(rows[idx + 1]) : null;
    if (up && fits(up)) return { cx, box: up, above: true };
    if (down && fits(down)) return { cx, box: down, above: false };
    const bookTop = toContent(m, row, { x: 0, y: box.minY }).y - sy;
    const h = (row.clear - 2) * m.scale - 4;
    return bookTop - h - 10 >= 0 || !down
      ? { cx, box: { left, width, top: Math.max(4, bookTop - h - 10), height: h }, above: true }
      : { cx, box: down, above: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popId, shown, rows, frames, m, vpH, insets.bottom]);

  const hintFor = (shelfId: string): DropHint => {
    const p = drag?.preview;
    if (!drag || drag.settling || !p || p.shelfId !== shelfId) return null;
    if (p.kind === 'bad') return { text: ko.fail[p.reason] || ko.fail.outside, bad: true };
    if (p.hint === 'self') return null;
    return { text: ko.hint[p.hint], bad: false };
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
    return commit(moveToShelf(layout, books, id, shelves[i].id));
  };

  // 자세·기울기 바꾸기 전에 경로를 확인한다: 옆 책이 비켜도 도중에 겹치지 않고 돌 수 없으면 바꾸지 않고 안내(브리프 규칙)
  const commitPath = (r: Result, id: string): string | null => {
    if (!r.ok) return commit(r);
    const shelfId = placementOf(layout, id)?.shelfId;
    const mo = shelfId ? motionOf(shelfId) : undefined;
    if (shelfId && mo) {
      const now = Object.values(currentStates(mo));
      const next = bodiesOf(withLeans(r.layout, books), books, shelfId);
      if (!planTransition(now, next, PLANK_BOUNDS)) return ko.fail['no-space'];
    }
    return commit(r);
  };

  // 꾸미기 조작부: 자세와 기대기(방향만 고르고 각도는 옆 책과의 틈으로)
  const editPlacement = editId ? placementOf(layout, editId) ?? null : null;
  const canLean = useMemo(() => {
    const out = { [-1]: false, 1: false } as { [-1]: boolean; 1: boolean };
    if (!editId || editPlacement?.pose !== 'spine') return out;
    for (const d of [-1, 1] as const) {
      if (Math.sign(editPlacement.tilt) === d) {
        out[d] = true;
        continue;
      }
      const r = setTilt(layout, books, editId, (d * 7) as Tilt);
      out[d] = r.ok && placementOf(withLeans(r.layout, books), editId)?.tilt !== 0;
    }
    return out;
  }, [editId, editPlacement, layout, books]);
  const editPose = (pose: Pose) => {
    if (!editId || editPlacement?.pose === pose) return;
    setEditMsg(commitPath(setPose(layout, books, editId, pose), editId));
  };
  const editLean = (d: -1 | 0 | 1) => {
    if (!editId || !editPlacement || Math.sign(editPlacement.tilt) === d) return;
    setEditMsg(commitPath(setTilt(layout, books, editId, (d * 7) as Tilt), editId));
  };
  // ---------- 표지 책 머리 손잡이: 위아래 = 뒤로 젖히기, 좌우 = 돌리기 ----------
  // 조금(10px) 움직인 뒤 주된 방향으로 조작을 정하고 놓을 때까지 고정한다. 시작 자세·포인터 위치 기준 변화량이라 잡는 순간 튀지 않는다.
  // 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기), 놓으면 한 번에 확정(되돌리기 한 번).
  const handleAt = useRef(0);
  const headRef = useRef<{ id: string; shelfId: string; qx: number; start: FrontState; cur: FrontState; axis: 'tilt' | 'spin' | null; last: ShelfLayout | null; dx: number; dy: number; raf: number } | null>(null);
  const [headLive, setHeadLive] = useState<FrontState | null>(null);
  const TILT_PER_DU = 0.35; // 머리를 1DU 밀면 0.35° 젖힘(20°에 약 57DU)
  const SPIN_PER_DU = 0.3; // 좌우 1DU에 0.3°(12°에 40DU)
  const headStep = () => {
    const h = headRef.current;
    if (!h) return;
    h.raf = 0;
    if (!h.axis) {
      if (Math.hypot(h.dx, h.dy) < 10) return;
      h.axis = Math.abs(h.dx) > Math.abs(h.dy) ? 'spin' : 'tilt';
    }
    const r =
      h.axis === 'tilt'
        ? frontTilt(layout, books, h.id, h.cur, h.qx, h.start.pitch + (-h.dy / m.scale) * TILT_PER_DU)
        : frontSpin(layout, books, h.id, h.cur, h.qx, h.start.spin + (h.dx / m.scale) * SPIN_PER_DU);
    if (!r) return;
    h.cur = r.state;
    h.last = r.layout;
    previewShelf(h.shelfId, computeShelf(withLeans(r.layout, books, h.shelfId), books, h.shelfId).frames);
    setHeadLive(r.state);
  };
  const onHandle = (phase: 'begin' | 'move' | 'end', dx: number, dy: number) => {
    handleAt.current = Date.now();
    if (phase === 'begin') {
      const f = editId ? frontStateOf(layout, books, editId) : null;
      const shelfId = editId ? placementOf(layout, editId)?.shelfId : undefined;
      headRef.current = f && editId && shelfId ? { id: editId, shelfId, qx: f.qx, start: f.state, cur: f.state, axis: null, last: null, dx: 0, dy: 0, raf: 0 } : null;
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
    if (!h.last) return;
    // 벽에 기대 있으면 그대로, 받침 없이 기울었으면 제자리에서 선다. 설 수 없으면 조작 전으로.
    const fin = frontRelease(layout, books, h.id, h.cur, h.qx);
    if (!fin) {
      previewShelf(h.shelfId, frames.get(h.shelfId) ?? []);
      setEditMsg(ko.fail['no-space']);
      return;
    }
    setEditMsg(commitPath({ ok: true, layout: fin }, h.id));
  };
  onHandleRef.current = onHandle;
  const frontInfo = editId ? frontStateOf(layout, books, editId) : null;
  const anglesText = frontInfo ? ko.decoratePanel.angles((headLive ?? frontInfo.state).spin, (headLive ?? frontInfo.state).pitch) : null;

  // 앞뒤: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 옆 책·벽에 닿으면 가능한 데까지. 실제로 된 깊이를 돌려준다.
  const editDepth = (z: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = boxOf(layout, books, editId)?.z ?? 0;
    // 끄는 동안은 직전 미리보기의 벽 기대기 상태를 이어받는다(경계 여유가 한 번의 끌기 안에서도 작동하게)
    const r = setDepth(layout, books, editId, z, leanRef.current);
    leanRef.current = done ? undefined : r.ok ? !!placementOf(r.layout, editId)?.wallLean : leanRef.current;
    const got = r.ok ? boxOf(r.layout, books, editId)?.z ?? cur : cur;
    const limited = Math.abs(got - z) >= 1;
    const restore = () => shelfId && previewShelf(shelfId, frames.get(shelfId) ?? []);
    if (!done) {
      if (shelfId) {
        if (r.ok) previewShelf(shelfId, computeShelf(withLeans(r.layout, books, shelfId), books, shelfId).frames);
        else restore();
      }
      setEditMsg(limited ? ko.decoratePanel.depthLimit : null);
      return got;
    }
    if (!r.ok) {
      restore();
      setEditMsg(r.reason === 'no-change' ? null : ko.decoratePanel.depthLimit);
      return cur;
    }
    const err = commitPath(r, editId);
    if (err) restore();
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
    const restore = () => shelfId && previewShelf(shelfId, frames.get(shelfId) ?? []);
    if (!done) {
      if (!shelfId) return got;
      if (r.ok) previewShelf(shelfId, computeShelf(withLeans(r.layout, books, shelfId), books, shelfId).frames);
      else restore();
      setEditMsg(limitMsg);
      return got;
    }
    if (!r.ok) {
      restore();
      setEditMsg(r.reason === 'no-change' ? limitMsg : ko.fail[r.reason] || null);
      return cur;
    }
    const err = commitPath(r, editId);
    if (err) restore();
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

  const onA11y = useCallback(
    (bookId: string, action: string) => {
      if (action === 'activate') {
        popScroll.current = scrollY.value;
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
      const parts = [b.title, b.author, ko.poseState[p.pose], ko.tiltState[String(p.tilt) as '0']];
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
  const draggedBook = drag ? books[drag.bookId] : null;
  // 꾸미기에서 책을 고르면(탭) 그 책이 아래 조작부에 가릴 때만 가리지 않을 만큼 스크롤한다.
  // 꾸미기에 들어가고 나올 때는 스크롤하지 않는다(보던 줄 그대로, 손으로 스크롤할 수 있다).
  const prevEditId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditId.current;
    prevEditId.current = editId;
    if (!editing || !panelH || !editId || editId === prev || dragRef.current) return;
    const p = placementOf(layout, editId);
    const row = p ? rowOf.get(p.shelfId) : undefined;
    const f = row && frames.get(row.shelfId)?.find((fr) => fr.bookId === editId);
    if (!row || !f) return;
    const box = frameBBox(f);
    const top = toContent(m, row, { x: 0, y: box.minY }).y;
    const bottom = row.top + (row.clear + SHELF.lip) * m.scale + 8;
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
  }, [editId, editing, panelH]);

  const contentHeight = Math.max(vpH, (rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : CONTENT_TOP) + (SHELF_CAST_EXTENT + 8) * m.scale + (editing ? panelH : tailPad));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {PERF_ENABLED && camDebug === '1' ? (
        <Text pointerEvents="none" style={{ position: 'absolute', zIndex: 99, left: 8, bottom: navigation.height + insets.bottom + 4, fontSize: 11, color: '#7A2E1E', backgroundColor: 'rgba(255,255,255,0.8)' }}>
          {`저장 ${view.pitch}° · ${camNow || `적용 ${view.pitch}°`} · 배율 ${m.scale.toFixed(4)}dp/DU(${(m.scale * PixelRatio.get()).toFixed(3)}px/DU) · 줄 높이 기준 ky ${(rowKy ?? kyOf(view.pitch)).toFixed(4)} · 꾸미기 ${editing ? '켬' : '끔'}`}
        </Text>
      ) : null}
      {/* 시안 비율: 제목 26DU·요약 12.5DU·원형 버튼 28DU, 좌우 여백 23/18DU */}
      <View style={[styles.header, { paddingLeft: 23 * m.scale + m.originX, paddingRight: 18 * m.scale + m.originX, paddingTop: 20 * m.scale, height: 84 * m.scale }]}>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.title, { fontSize: 26 * m.scale, lineHeight: 34 * m.scale }]}
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}>
            {ko.title}
          </Text>
          <Pressable
            onPress={() => setSelectedYear(years[(years.indexOf(year) + 1) % years.length])}
            disabled={years.length < 2}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={ko.yearA11y(year, count)}
            style={{ alignSelf: 'flex-start' }}>
            <Text style={[styles.summary, { fontSize: 12.5 * m.scale, marginTop: 7 * m.scale }]}>
              {ko.year(year)}
              {years.length > 1 ? ' ▾' : ''}
              {editing ? ` · ${ko.decorating}` : ''}
            </Text>
          </Pressable>
        </View>
        <View style={[styles.actions, { gap: 8 * m.scale, marginTop: -14 * m.scale }]}>
          {editing ? (
            <>
              <Pressable
                onPress={() => {
                  if (placementStore.undo()) setEditMsg(null);
                }}
                disabled={!store.undo}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={ko.undo}
                style={{ opacity: store.undo ? 1 : 0.35, padding: 4 }}>
                <Undo2 size={20 * m.scale} color={colors.ink} strokeWidth={1.6} />
              </Pressable>
              <Pressable onPress={finishEditing} accessibilityRole="button" accessibilityLabel={ko.done} style={[styles.pill, { height: 30 * m.scale, paddingHorizontal: 16 * m.scale }]}>
                <Text style={[styles.pillText, { fontSize: 13.5 * m.scale }]}>{ko.done}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={() => {
                  setPopId(null);
                  setSelectedId(null);
                  setEditingKeep(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={ko.decorate}
                style={[styles.pill, { height: 28 * m.scale, paddingHorizontal: 11 * m.scale, flexDirection: 'row', gap: 4 * m.scale }]}>
                <Paintbrush size={13 * m.scale} color={colors.ink} strokeWidth={1.6} />
                <Text style={[styles.pillText, { fontSize: 12.5 * m.scale }]}>{ko.decorate}</Text>
              </Pressable>
              <HeaderButton size={28 * m.scale} label={ko.add} onPress={() => router.push('/book/add')}>
                <Plus size={16 * m.scale} color={colors.ink} strokeWidth={1.4} />
              </HeaderButton>
              <HeaderButton size={28 * m.scale} label={ko.menu.title} onPress={() => setShelfMenuOpen(true)}>
                <Menu size={15 * m.scale} color={colors.ink} strokeWidth={1.5} />
              </HeaderButton>
            </>
          )}
        </View>
      </View>

      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          viewportH.value = e.nativeEvent.layout.height;
          setVpH(e.nativeEvent.layout.height);
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
            <View key={perfKey} style={{ height: contentHeight, paddingTop: rows[0]?.top ?? CONTENT_TOP }} collapsable={false}>
              {shownShelves.map((s) => (
                <ShelfRow
                  key={s.id}
                  shelfId={s.id}
                  frames={frames.get(s.id) ?? []}
                  books={books}
                  scale={m.scale}
                  originX={m.originX}
                  height={rowOf.get(s.id)?.height ?? 0}
                  clear={rowOf.get(s.id)?.clear ?? SHELF.minClear}
                  placeholderId={drag && !dragInRow ? drag.bookId : null}
                  dragId={dragInRow ? drag!.bookId : null}
                  selectedId={editing ? (drag ? null : editId) : (popId ?? detailId ?? selectedId)}
                  hint={hintFor(s.id)}
                  editing={editing && !drag}
                  canRemove={false}
                  reduceMotion={reduceMotion || !settled}
                  a11yLabelOf={a11yLabelOf}
                  onA11y={onA11y}
                  onRemove={() => {}}
                  debug={debugGeom}
                  topRow={s.id === shownShelves[0]?.id}
                  handle={editing && !drag && editId && placementOf(layout, editId)?.shelfId === s.id ? headPan : undefined}
                  cam={camSV}
                />
              ))}
            </View>
          </GestureDetector>
        </Animated.ScrollView>
        </GestureDetector>

        {drag && draggedBook && !dragInRow ? (
          <DragOverlay book={draggedBook} frame={drag.frame} from={drag.from} scale={m.scale} x={dragX} y={dragY} />
        ) : null}

        {popId && popAnchor && books[popId] && placementOf(layout, popId) ? (
          <BookPopover
            book={books[popId]}
            anchor={popAnchor}
            reduceMotion={reduceMotion}
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
                <Plus size={16} color={colors.bg} strokeWidth={1.8} />
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
                    if (placementStore.undo()) setToast({ text: ko.undone });
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

      {editing ? (
        <DecoratePanel
          title={editId ? books[editId]?.title ?? null : null}
          pose={editPlacement?.pose ?? null}
          lean={(Math.sign(editPlacement?.tilt ?? 0) as -1 | 0 | 1)}
          canLean={canLean}
          msg={editMsg}
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

      <Modal visible={shelfMenuOpen} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setShelfMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setShelfMenuOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.menuTitle}>{ko.menu.title}</Text>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/search'); }}>
            <Search size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.menu.search}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/drawer'); }}>
            <BookMarked size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.drawer.title}{layout.drawer.length ? ` · ${layout.drawer.length}권` : ''}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/stats'); }}>
            <ChartNoAxesColumn size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.menu.stats}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); router.push('/settings'); }}>
            <Settings size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.menu.settings}</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); showToast({ text: placementStore.addShelf() ? ko.menu.shelfAdded : ko.menu.shelfFail }); }}>
            <Plus size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.menu.addShelf}</Text>
          </Pressable>
          {layout.shelves.length > 3 && layout.shelves.some((sh) => !layout.placements.some((p) => p.shelfId === sh.id)) ? (
            <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); showToast({ text: placementStore.pruneShelves() ? ko.menu.pruned : ko.menu.shelfFail }); }}>
              <Eraser size={20} color={colors.ink} strokeWidth={1.6} /><Text style={styles.menuText}>{ko.menu.prune}</Text>
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
  title: { fontFamily: fonts.serif, color: colors.title },
  summary: { color: colors.summary, letterSpacing: 0.3 },
  actions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center' },
  circle: { borderWidth: 1, borderColor: colors.circle, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pill: { borderWidth: 1, borderColor: colors.circle, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: colors.ink },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, color: colors.sheet, fontWeight: '600' },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toastText: { color: colors.sheet, fontSize: 13.5, flexShrink: 1 },
  toastAction: { color: '#F2D9A6', fontSize: 13.5, fontWeight: '600' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(34,30,24,0.2)' },
  menuSheet: { backgroundColor: colors.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  menuTitle: { fontFamily: fonts.serif, fontSize: 22, color: colors.ink, marginBottom: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54 },
  menuText: { fontSize: 16, color: colors.ink },
  emptyWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyCard: { alignItems: 'center', backgroundColor: 'rgba(251,247,240,0.92)', borderRadius: 18, paddingVertical: 24, paddingHorizontal: 28 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 21, color: colors.ink },
  emptyBody: { fontSize: 13.5, lineHeight: 20, color: colors.inkSoft, textAlign: 'center', marginTop: 8 },
  emptyBtn: { marginTop: 16, height: 44, borderRadius: 22, backgroundColor: colors.ink, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyBtnText: { color: colors.bg, fontSize: 15 },
  emptyLink: { fontSize: 13.5, color: colors.inkSoft, textDecorationLine: 'underline' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: 6 },
});
