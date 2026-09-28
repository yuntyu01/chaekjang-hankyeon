// 홈 책장. 선반 전체를 하나의 제스처로 받아 책 윤곽으로 터치를 판정한다(그림자는 판정에서 제외).
// 짧게 누르기 → 정보 상자, 350ms 길게 누르기 → 드래그. 드래그 전 세로 이동은 스크롤이 가져간다.
// 드래그: 같은 선반은 올라간 책과 자리 바꾸기, 다른 선반은 그 자리에 끼우기(눕힌 책 가운데면 쌓기),
// 세 선반 사이에서 이동한다. 화면 가장자리에서 자동 스크롤.
import { useFocusEffect, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BookMarked, Paintbrush, Plus, Undo2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedRef,
  useFrameCallback,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { DESIGN_WIDTH, PLANK_INSET, SHELF, SHELF_USABLE_WIDTH } from '@/domain/geometry';
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
  setTilt,
  sortedShelves,
  type SwapTarget,
  type FailReason,
  type Result,
} from '@/domain/layout-engine';
import type { Book3 } from '@/domain/book3';
import { bodiesOf, computeShelf, hitTest, PLANK_BOUNDS, withLeans, type BookFrame } from '@/domain/shelf-scene';
import { planTransition } from '@/domain/transition';
import type { Pose, ShelfLayout, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { DragOverlay, frameBBox } from '@/ui/shelf/DragOverlay';
import { CONTENT_TOP, computeRows, rowAt, toContent, toScene, useShelfMetrics } from '@/ui/shelf/metrics';
import { currentStates, motionOf, previewShelf } from '@/ui/shelf/ShelfMotion';
import { ShelfRow, type DropHint } from '@/ui/shelf/ShelfRow';
import { SHELF_SHADOW_EXTENT } from '@/ui/shelf/ShelfShadow';
import { colors, fonts, motion, navigation } from '@/ui/theme';

import { BookDetail, type MoveAction } from './BookDetail';
import { BookPopover } from './BookPopover';
import { tabBarStyle } from '@/ui/tabBar';

import { DecoratePanel } from './DecoratePanel';
import { DrawerSheet } from './DrawerSheet';

type HintKind = SwapTarget['kind'] | 'beside';
// key: 같은 목표면 다시 계산하지 않으려는 식별자. shelfId: 안내를 띄울 선반
type Preview =
  | { kind: 'ok'; layout: ShelfLayout; key: string; shelfId: string; hint: HintKind }
  | { kind: 'same'; key: string; shelfId: string; hint: HintKind }
  | { kind: 'bad'; reason: FailReason | 'outside'; key: string; shelfId: string | null };

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
};

type Toast = { text: string; action?: 'undo' | 'retry' } | null;

// 선반별 프레임을 캐시해서 바뀐 선반만 다시 그린다.
function useShelfScenes(layout: ShelfLayout, books: Parameters<typeof computeShelf>[1]) {
  const cache = useRef(new Map<string, { sig: string; books: typeof books; frames: BookFrame[] }>());
  return useMemo(() => {
    const out = new Map<string, BookFrame[]>();
    for (const s of layout.shelves) {
      const sig = JSON.stringify(layout.placements.filter((p) => p.shelfId === s.id));
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
  }, [layout, books]);
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
  const reduceMotion = useReducedMotion();

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
  const lift = useSharedValue(0);

  useEffect(() => {
    void placementStore.load();
  }, []);

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
    const centerDU = (centerPx - m.originX) / m.scale - SHELF.sideMargin;
    const withinX = centerDU > -SHELF.sideMargin && centerDU < SHELF.innerLeft + SHELF_USABLE_WIDTH + SHELF.innerRight + SHELF.sideMargin;
    const reuse = (key: string) => (d.preview && d.preview.key === key ? d.preview : null);
    if (!withinX || index < 0) return reuse('outside') ?? { kind: 'bad', reason: 'outside', key: 'outside', shelfId: null };
    if (index >= shelves.length) return reuse('outside') ?? { kind: 'bad', reason: 'outside', key: 'outside', shelfId: null };
    const shelfId = shelves[index].id;
    if (shelfId === d.shelfId) {
      const t = findSwapTarget(layout, books, d.bookId, centerDU);
      const key = `same:${JSON.stringify(t)}`;
      const hit = reuse(key);
      if (hit) return hit;
      const r = applySwapTarget(layout, books, d.bookId, t);
      if (r.ok) return { kind: 'ok', layout: r.layout, key, shelfId, hint: t.kind };
      if (r.reason === 'no-change') return { kind: 'same', key, shelfId, hint: 'self' };
      return { kind: 'bad', reason: r.reason, key, shelfId };
    }
    const p = placementOf(layout, d.bookId)!;
    const t = findDropTarget(detach(layout, d.bookId, books), books, shelfId, centerDU, p.pose, d.boxW / m.scale);
    const key = `other:${JSON.stringify(t)}`;
    const hit = reuse(key);
    if (hit) return hit;
    const r = moveBook(layout, books, d.bookId, t);
    if (r.ok) return { kind: 'ok', layout: r.layout, key, shelfId, hint: t.kind === 'stack' ? 'stack' : t.x !== undefined ? 'place' : 'beside' };
    return { kind: 'bad', reason: r.reason, key, shelfId };
  };

  // ---------- 제스처 콜백(JS) ----------
  const onTap = (x: number, y: number) => {
    if (Date.now() - lastDragEnd.current < 350 || dragRef.current) return;
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
    // 꾹 눌러 책을 집으면 꾸미기 모드가 시작된다
    setEditing(true);
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
    };
    grab.value = { x: d.grabX, y: d.grabY };
    vpOrigin.value = { x: absX - x, y: absY - (y - scroll) };
    pointer.value = { x, y: y - scroll };
    dragX.value = tl.x;
    dragY.value = tl.y - scroll;
    lift.value = withTiming(1, { duration: reduceMotion ? 0 : 140 });
    active.value = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedId(null);
    updateDrag(d);
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
    // 스냅 목적지 계산
    const pl = placementOf(final, d.bookId)!;
    const finalRows = computeRows(final, books, m.scale, vpH, navigation.height + insets.bottom);
    const row = finalRows.find((r) => r.shelfId === pl.shelfId)!;
    const f = computeShelf(final, books, pl.shelfId).frames.find((fr) => fr.bookId === d.bookId)!;
    const box = frameBBox(f);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    updateDrag({ ...d, frame: f, from: null, settling: final });
    const dur = reduceMotion ? 0 : motion.settle;
    lift.value = withTiming(0, { duration: dur });
    dragX.value = withTiming(tl.x, { duration: dur });
    dragY.value = withTiming(tl.y - scrollY.value, { duration: dur }, () => {
      scheduleOnRN(finishDrag);
    });
    if (!committed && d.preview?.kind !== 'ok') void Haptics.selectionAsync().catch(() => {});
    // 놓은 뒤에도 꾸미기 모드는 유지하고, 놓은 책을 고른 상태로 둔다
    setEditId(d.bookId);
  };

  // 화면 이탈·앱 비활성화: 임시 배치를 버리고 확정 상태 유지
  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return;
    active.value = false;
    lift.value = 0;
    lastDragEnd.current = Date.now();
    updateDrag(null);
  }, [active, lift]);
  useFocusEffect(useCallback(() => cancelDrag, [cancelDrag]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') cancelDrag();
    });
    return () => sub.remove();
  }, [cancelDrag]);

  // ---------- 제스처 ----------
  const pan = Gesture.Pan()
    .activateAfterLongPress(motion.longPress)
    .onStart((e) => {
      scheduleOnRN(beginDrag, e.x, e.y, e.absoluteX, e.absoluteY, scrollY.value);
    })
    .onUpdate((e) => {
      if (!active.value) return;
      const vx = e.absoluteX - vpOrigin.value.x;
      const vy = e.absoluteY - vpOrigin.value.y;
      pointer.value = { x: vx, y: vy };
      dragX.value = vx - grab.value.x;
      dragY.value = vy - grab.value.y;
      scheduleOnRN(moveDrag, vx, vy, scrollY.value);
    })
    .onFinalize((_e, success) => {
      scheduleOnRN(endDrag, !success);
    });
  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e, success) => {
      if (success) scheduleOnRN(onTap, e.x, e.y);
    });
  const gesture = Gesture.Race(pan, tap);

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

  // ---------- 표시할 레이아웃 ----------
  const shown = drag?.settling ?? (drag?.preview?.kind === 'ok' ? drag.preview.layout : layout);
  const shownShelves = useMemo(() => sortedShelves(shown), [shown]);
  const frames = useShelfScenes(shown, books);
  // Keep drop bands steady while a book travels between differently sized rows.
  const rows = useMemo(() => {
    const base = drag && !drag.settling ? layout : shown;
    return computeRows(base, books, m.scale, vpH, navigation.height + insets.bottom);
  }, [shown, layout, books, m.scale, vpH, insets.bottom, !!drag, drag?.settling]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.shelfId, r])), [rows]);

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
  // 눕힌 책 돌리기: 끄는 동안은 미리보기(가능한 각도까지만), 놓으면 확정
  // 돌리기: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 실제로 된 각도를 돌려준다.
  const editSpin = (deg: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = placementOf(layout, editId)?.spin ?? 0;
    const r = setSpin(layout, books, editId, deg);
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
    setEditing(false);
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
  // 꾸미기 중엔 아래 조작부가 맨 아래 선반을 가리지 않도록 그 높이만큼 더 내릴 수 있게 한다
  const contentHeight = Math.max(vpH, (rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : CONTENT_TOP) + (SHELF_SHADOW_EXTENT + 8) * m.scale + (editing ? panelH : 0));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
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
                  setEditing(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={ko.decorate}
                style={[styles.pill, { height: 28 * m.scale, paddingHorizontal: 11 * m.scale, flexDirection: 'row', gap: 4 * m.scale }]}>
                <Paintbrush size={13 * m.scale} color={colors.ink} strokeWidth={1.6} />
                <Text style={[styles.pillText, { fontSize: 12.5 * m.scale }]}>{ko.decorate}</Text>
              </Pressable>
              <HeaderButton size={28 * m.scale} label="책 추가 및 책장 메뉴" onPress={() => setShelfMenuOpen(true)}>
                <Plus size={16 * m.scale} color={colors.ink} strokeWidth={1.4} />
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
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          onScrollBeginDrag={() => {
            setPopId(null);
            setSelectedId(null);
          }}
          scrollEventThrottle={16}
          scrollEnabled={!drag}
          onContentSizeChange={(_w, h) => {
            contentH.value = h;
          }}
          showsVerticalScrollIndicator={false}>
          <GestureDetector gesture={gesture}>
            <View style={{ height: contentHeight, paddingTop: rows[0]?.top ?? CONTENT_TOP }} collapsable={false}>
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
                  placeholderId={drag?.bookId ?? null}
                  selectedId={editing ? (drag ? null : editId) : (popId ?? detailId ?? selectedId)}
                  hint={hintFor(s.id)}
                  editing={editing && !drag}
                  canRemove={false}
                  reduceMotion={reduceMotion || !settled}
                  a11yLabelOf={a11yLabelOf}
                  onA11y={onA11y}
                  onRemove={() => {}}
                  debug={debugGeom}
                />
              ))}
            </View>
          </GestureDetector>
        </Animated.ScrollView>

        {drag && draggedBook ? (
          <DragOverlay book={draggedBook} frame={drag.frame} from={drag.from} scale={m.scale} x={dragX} y={dragY} lift={lift} />
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
          />
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
          onHeight={setPanelH}
        />
      ) : null}

      <BookDetail
        book={detailId ? books[detailId] : null}
        placement={detailPlacement}
        onClose={() => {
          setDetailId(null);
          setSelectedId(null);
        }}
        onPose={menuPose}
        onTilt={menuTilt}
        onMove={(mv) => menuMove(mv)}
        onToDrawer={() => {
          if (!detailId) return;
          commit(moveToDrawer(layout, detailId, books), ko.drawer.stored);
          setDetailId(null);
          setSelectedId(null);
        }}
        onToShelf={() => {
          if (!detailId) return null;
          const r = placeFromDrawer(layout, books, detailId);
          if (!r.ok) return r.reason === 'no-space' ? ko.drawer.noRoom : ko.fail[r.reason] || null;
          commit(r, ko.drawer.placed);
          setDetailId(null);
          return null;
        }}
      />
      <DrawerSheet
        visible={drawerOpen}
        books={layout.drawer.map((id) => books[id]).filter(Boolean)}
        scale={m.scale}
        onClose={() => setDrawerOpen(false)}
        onPick={(id) => {
          setDrawerOpen(false);
          setTimeout(() => setDetailId(id), 280);
        }}
      />
      <Modal visible={shelfMenuOpen} transparent statusBarTranslucent navigationBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setShelfMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setShelfMenuOpen(false)} accessibilityLabel="닫기" />
        <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.menuTitle}>{ko.title}</Text>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); showToast({ text: ko.addSoon }); }}>
            <Plus size={20} color={colors.ink} /><Text style={styles.menuText}>{ko.add}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); setEditing(true); }}>
            <Paintbrush size={20} color={colors.ink} /><Text style={styles.menuText}>{ko.decorate}</Text>
          </Pressable>
          {__DEV__ ? (
            <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); setDebugGeom((v) => !v); }}>
              <Text style={styles.menuText}>{debugGeom ? '형상 보기 끄기(개발)' : '형상 보기(개발)'}</Text>
            </Pressable>
          ) : null}
          {__DEV__ ? (
            <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); placementStore.resetSample(); }}>
              <Text style={styles.menuText}>예시 배치로 초기화(개발)</Text>
            </Pressable>
          ) : null}
          {__DEV__ ? (
            <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); placementStore.resetPilot(); }}>
              <Text style={styles.menuText}>눕힌 책 한 권 시험(개발)</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" style={styles.menuItem} onPress={() => { setShelfMenuOpen(false); setTimeout(() => setDrawerOpen(true), 280); }}>
            <BookMarked size={20} color={colors.ink} /><Text style={styles.menuText}>{ko.drawer.title}{layout.drawer.length ? ` · ${layout.drawer.length}권` : ''}</Text>
          </Pressable>
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
});
