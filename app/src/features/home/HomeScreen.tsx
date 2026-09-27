// 홈 책장. 선반 전체를 하나의 제스처로 받아 책 윤곽으로 터치를 판정한다(그림자는 판정에서 제외).
// 짧게 누르기 → 상세, 350ms 길게 누르기 → 드래그. 드래그 전 세로 이동은 스크롤이 가져간다.
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BookMarked, Check, Paintbrush, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { SHELF } from '@/domain/geometry';
import {
  addShelf,
  applySwapTarget,
  findSwapTarget,
  moveBy,
  moveToDrawer,
  moveToShelf,
  placeFromDrawer,
  placementOf,
  removeShelf,
  setPose,
  setTilt,
  shelfItems,
  sortedShelves,
  type SwapTarget,
  type FailReason,
  type Result,
} from '@/domain/layout-engine';
import { computeShelf, hitTest, type BookFrame } from '@/domain/shelf-scene';
import type { Pose, ShelfLayout, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { DragOverlay, frameBBox } from '@/ui/shelf/DragOverlay';
import { CONTENT_TOP, computeRows, rowAt, toContent, toScene, useShelfMetrics } from '@/ui/shelf/metrics';
import { ShelfRow, type DropHint } from '@/ui/shelf/ShelfRow';
import { colors, fonts, motion } from '@/ui/theme';

import { BookDetail, type MoveAction } from './BookDetail';
import { BookPopover } from './BookPopover';
import { DrawerSheet } from './DrawerSheet';

type Preview =
  | { kind: 'ok'; layout: ShelfLayout; target: SwapTarget }
  | { kind: 'same'; target: SwapTarget }
  | { kind: 'bad'; reason: FailReason | 'outside'; target: SwapTarget | null };

type Drag = {
  bookId: string;
  frame: BookFrame; // 집어 든 순간의 모양(오버레이 렌더용)
  boxW: number; // px
  grabX: number;
  grabY: number;
  preview: Preview | null;
  settling: ShelfLayout | null; // 놓은 뒤 스냅 애니메이션 동안 보여줄 레이아웃
  shelfId: string; // 꾹 누른 책의 선반(좌우로만 움직인다)
};

type Toast = { text: string; action?: 'undo' | 'retry' } | null;

// 선반별 프레임을 캐시해서 바뀐 선반만 다시 그린다.
function useShelfScenes(layout: ShelfLayout, books: Parameters<typeof computeShelf>[1]) {
  const cache = useRef(new Map<string, { sig: string; frames: BookFrame[] }>());
  return useMemo(() => {
    const out = new Map<string, BookFrame[]>();
    for (const s of layout.shelves) {
      const sig = JSON.stringify(layout.placements.filter((p) => p.shelfId === s.id));
      const hit = cache.current.get(s.id);
      if (hit && hit.sig === sig) {
        out.set(s.id, hit.frames);
        continue;
      }
      const frames = computeShelf(layout, books, s.id).frames;
      cache.current.set(s.id, { sig, frames });
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
  const reduceMotion = useReducedMotion();

  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null); // 서랍 책(시트)
  const [popId, setPopId] = useState<string | null>(null); // 선반 책(떠오르는 상자)
  const [vpH, setVpH] = useState(0);
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const showToast = useCallback((t: Toast) => setToast(t), []);
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
  // 꾹 눌러 좌우로 움직이면, 끌고 있는 책 가운데가 올라간 책과 자리를 바꾼다(눕힌 책끼리 가운데면 쌓기).
  const computePreview = (d: Drag, vx: number): Preview => {
    const centerPx = vx - d.grabX + d.boxW / 2;
    const centerDU = (centerPx - m.originX) / m.scale - SHELF.sideMargin;
    const target = findSwapTarget(layout, books, d.bookId, centerDU);
    if (d.preview?.target && JSON.stringify(d.preview.target) === JSON.stringify(target)) return d.preview;
    const r = applySwapTarget(layout, books, d.bookId, target);
    if (r.ok) return { kind: 'ok', layout: r.layout, target };
    if (r.reason === 'no-change') return { kind: 'same', target };
    return { kind: 'bad', reason: r.reason, target };
  };

  // ---------- 제스처 콜백(JS) ----------
  const onTap = (x: number, y: number) => {
    if (Date.now() - lastDragEnd.current < 350 || dragRef.current) return;
    const hit = hitAt(x, y);
    if (!hit) return;
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
    const row = rows.find((r) => r.shelfId === hit.shelfId)!;
    const box = frameBBox(hit);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    const d: Drag = {
      bookId: hit.bookId,
      frame: hit,
      boxW: box.width * m.scale,
      grabX: x - tl.x,
      grabY: y - tl.y,
      preview: { kind: 'same', target: { kind: 'self' } },
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

  const moveDrag = (vx: number) => {
    const d = dragRef.current;
    if (!d || d.settling) return;
    const preview = computePreview(d, vx);
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
    const finalRows = computeRows(final, books, m.scale);
    const row = finalRows.find((r) => r.shelfId === pl.shelfId)!;
    const f = computeShelf(final, books, pl.shelfId).frames.find((fr) => fr.bookId === d.bookId)!;
    const box = frameBBox(f);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    updateDrag({ ...d, frame: f, settling: final });
    const dur = reduceMotion ? 0 : motion.settle;
    lift.value = withTiming(0, { duration: dur });
    dragX.value = withTiming(tl.x, { duration: dur });
    dragY.value = withTiming(tl.y - scrollY.value, { duration: dur }, () => {
      scheduleOnRN(finishDrag);
    });
    if (!committed && d.preview?.kind !== 'ok') void Haptics.selectionAsync().catch(() => {});
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
      // 좌우로만 움직인다(세로는 그 선반에 고정)
      const vx = e.absoluteX - vpOrigin.value.x;
      dragX.value = vx - grab.value.x;
      scheduleOnRN(moveDrag, vx);
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

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // ---------- 표시할 레이아웃 ----------
  const shown = drag?.settling ?? (drag?.preview?.kind === 'ok' ? drag.preview.layout : layout);
  const shownShelves = useMemo(() => sortedShelves(shown), [shown]);
  const frames = useShelfScenes(shown, books);
  const rows = useMemo(() => computeRows(shown, books, m.scale), [shown, books, m.scale]);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.shelfId, r])), [rows]);

  // 정보 상자 위치: 선택한 책의 윤곽(현재 배치 기준)을 뷰포트 좌표로
  const popAnchor = useMemo(() => {
    if (!popId) return null;
    const p = placementOf(shown, popId);
    const row = p && rowOf.get(p.shelfId);
    const f = row && frames.get(p.shelfId)?.find((fr) => fr.bookId === popId);
    if (!row || !f) return null;
    const box = frameBBox(f);
    const tl = toContent(m, row, { x: box.minX, y: box.minY });
    const br = toContent(m, row, { x: box.minX + box.width, y: box.minY + box.height });
    const sy = popScroll.current;
    return { cx: (tl.x + br.x) / 2, top: tl.y - sy - 7 * m.scale, bottom: br.y - sy + (SHELF.below + 2) * m.scale };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popId, shown, rowOf, frames, m]);

  const hintFor = (shelfId: string): DropHint => {
    const p = drag?.preview;
    if (!drag || drag.settling || !p || !p.target || drag.shelfId !== shelfId) return null;
    if (p.kind === 'bad') return { text: ko.fail[p.reason] || ko.fail.outside, bad: true };
    if (p.target.kind === 'self') return null;
    return { text: ko.hint[p.target.kind], bad: false };
  };

  // ---------- 메뉴 동작 ----------
  const activeId = popId ?? detailId;
  const detailPlacement = detailId ? placementOf(layout, detailId) ?? null : null;
  const menuPose = (pose: Pose) => (activeId ? commit(setPose(layout, books, activeId, pose)) : null);
  const menuTilt = (t: Tilt) => (activeId ? commit(setTilt(layout, books, activeId, t)) : null);
  const menuMove = (mv: MoveAction, id = activeId): string | null => {
    if (!id) return null;
    if (mv === 'prev' || mv === 'next') return commit(moveBy(layout, books, id, mv === 'prev' ? -1 : 1));
    const p = placementOf(layout, id)!;
    const i = shelves.findIndex((s) => s.id === p.shelfId) + (mv === 'up' ? -1 : 1);
    if (i < 0 || i >= shelves.length) return null;
    return commit(moveToShelf(layout, books, id, shelves[i].id));
  };

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

  const onRemoveShelf = useCallback((id: string) => {
    const r = removeShelf(placementStore.get().layout, id);
    if (r.ok) placementStore.commit(r.layout);
  }, []);

  const year = new Date().getFullYear();
  const count = Object.values(books).filter((b) => b.finishedAt?.startsWith(String(year))).length;
  const draggedBook = drag ? books[drag.bookId] : null;
  const contentHeight = (rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : CONTENT_TOP) + (editing ? 110 : 24);

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
          <Text style={[styles.summary, { fontSize: 12.5 * m.scale, marginTop: 7 * m.scale }]}>{ko.summary(year, count)}</Text>
        </View>
        <View style={[styles.actions, { gap: 8 * m.scale, marginTop: -14 * m.scale }]}>
          <HeaderButton size={28 * m.scale} on={editing} label={editing ? ko.done : ko.decorate} onPress={() => setEditing((e) => !e)}>
            {editing ? (
              <Check size={14 * m.scale} color={colors.sheet} strokeWidth={1.8} />
            ) : (
              <Paintbrush size={13 * m.scale} color={colors.ink} strokeWidth={1.5} />
            )}
          </HeaderButton>
          <HeaderButton size={28 * m.scale} label={ko.add} onPress={() => showToast({ text: ko.addSoon })}>
            <Plus size={16 * m.scale} color={colors.ink} strokeWidth={1.4} />
          </HeaderButton>
          <HeaderButton size={28 * m.scale} label={`${ko.drawer.open}, ${ko.drawer.count(layout.drawer.length)}`} onPress={() => setDrawerOpen(true)}>
            <BookMarked size={14 * m.scale} color={colors.ink} strokeWidth={1.5} />
            {layout.drawer.length ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{layout.drawer.length}</Text>
              </View>
            ) : null}
          </HeaderButton>
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
            <View style={{ height: contentHeight, paddingTop: CONTENT_TOP }} collapsable={false}>
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
                  selectedId={popId ?? detailId ?? selectedId}
                  hint={hintFor(s.id)}
                  editing={editing && !drag}
                  canRemove={shelves.length > 1 && shelfItems(layout, s.id).length === 0}
                  reduceMotion={reduceMotion}
                  a11yLabelOf={a11yLabelOf}
                  onA11y={onA11y}
                  onRemove={onRemoveShelf}
                />
              ))}
              {editing && !drag ? (
                <View style={styles.addShelfWrap}>
                  <Pressable
                    style={[styles.addShelf, drag && styles.addShelfDrop]}
                    onPress={() => placementStore.commit(addShelf(layout, `shelf-${Date.now().toString(36)}`))}
                    accessibilityRole="button">
                    <Text style={styles.addShelfText}>{drag ? ko.dropNewShelf : ko.addShelf}</Text>
                  </Pressable>
                  {!drag ? <Text style={styles.editHint}>{ko.editHint}</Text> : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>
        </Animated.ScrollView>

        {drag && draggedBook ? (
          <DragOverlay book={draggedBook} frame={drag.frame} scale={m.scale} x={dragX} y={dragY} lift={lift} />
        ) : null}

        {popId && popAnchor && books[popId] && placementOf(layout, popId) ? (
          <BookPopover
            book={books[popId]}
            placement={placementOf(layout, popId)!}
            anchor={popAnchor}
            viewportH={vpH}
            reduceMotion={reduceMotion}
            onClose={() => {
              setPopId(null);
              setSelectedId(null);
            }}
            onPose={menuPose}
            onTilt={menuTilt}
            onMove={(mv) => menuMove(mv)}
            onToDrawer={() => {
              commit(moveToDrawer(layout, popId), ko.drawer.stored);
              setPopId(null);
              setSelectedId(null);
            }}
          />
        ) : null}

        {toast ? (
          <View style={styles.toast} accessibilityLiveRegion="polite">
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
          commit(moveToDrawer(layout, detailId), ko.drawer.stored);
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontFamily: fonts.bookTitle, color: colors.title },
  summary: { color: colors.summary, letterSpacing: 0.3 },
  actions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center' },
  circle: { borderWidth: 1, borderColor: colors.circle, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: colors.ink, borderColor: colors.ink },
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
  addShelfWrap: { alignItems: 'center', paddingTop: 10, gap: 10 },
  addShelf: {
    width: '86%',
    height: 64,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addShelfDrop: { backgroundColor: colors.dropOk },
  addShelfText: { fontSize: 14, color: colors.inkSoft },
  editHint: { fontSize: 12.5, color: colors.inkFaint },
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
});
