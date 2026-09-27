// 홈 책장. 선반 전체를 하나의 제스처로 받아 책 윤곽으로 터치를 판정한다(그림자는 판정에서 제외).
// 짧게 누르기 → 상세, 350ms 길게 누르기 → 드래그. 드래그 전 세로 이동은 스크롤이 가져간다.
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { SHELF, SHELF_USABLE_WIDTH } from '@/domain/geometry';
import {
  addShelf,
  detach,
  findDropTarget,
  moveBook,
  moveBy,
  moveToShelf,
  placementOf,
  removeShelf,
  sameTarget,
  setPose,
  setTilt,
  shelfItems,
  sortedShelves,
  type DropTarget,
  type FailReason,
  type Result,
} from '@/domain/layout-engine';
import { computeShelf, hitTest, type BookFrame } from '@/domain/shelf-scene';
import type { Pose, ShelfLayout, Tilt } from '@/domain/types';
import { ko } from '@/i18n/ko';
import { placementStore, usePlacementStore } from '@/store/placement-store';
import { DragOverlay, frameBBox } from '@/ui/shelf/DragOverlay';
import { CONTENT_TOP, useShelfMetrics } from '@/ui/shelf/metrics';
import { ShelfRow, type DropHint } from '@/ui/shelf/ShelfRow';
import { colors, fonts, motion } from '@/ui/theme';

import { BookDetail, type MoveAction } from './BookDetail';

type Preview =
  | { kind: 'ok'; layout: ShelfLayout; target: DropTarget }
  | { kind: 'same'; target: DropTarget }
  | { kind: 'bad'; reason: FailReason | 'outside'; target: DropTarget | null };

type Drag = {
  bookId: string;
  frame: BookFrame; // 집어 든 순간의 모양(오버레이 렌더용)
  boxW: number; // px
  grabX: number;
  grabY: number;
  preview: Preview | null;
  settling: ShelfLayout | null; // 놓은 뒤 스냅 애니메이션 동안 보여줄 레이아웃
  newShelfId: string; // 편집 중 '새 선반' 영역에 놓을 때 쓸 id
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

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const store = usePlacementStore();
  const { books, layout } = store;
  const m = useShelfMetrics();
  const reduceMotion = useReducedMotion();

  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastDragEnd = useRef(0);

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
    (r: Result): string | null => {
      if (!r.ok) return ko.fail[r.reason] || null;
      if (!placementStore.commit(r.layout)) return ko.fail['no-space'];
      showToast({ text: ko.moved, action: 'undo' });
      return null;
    },
    [showToast],
  );

  // ---------- 좌표 변환 ----------
  // 뷰포트 좌표 → 콘텐츠 좌표(스크롤 반영) → 선반 인덱스·설계 단위 x
  const locate = (vx: number, vy: number, scroll: number) => {
    const cy = vy + scroll;
    const i = Math.floor((cy - CONTENT_TOP) / m.rowHeight);
    return { cx: vx, cy, index: i };
  };

  const computePreview = (d: Drag, vx: number, vy: number, scroll: number): Preview => {
    const { cy, index } = locate(vx, vy, scroll);
    const p = placementOf(layout, d.bookId)!;
    const centerPx = vx - d.grabX + d.boxW / 2;
    const centerDU = (centerPx - m.originX) / m.scale - SHELF.sideMargin;
    const withinX = centerDU > -SHELF.sideMargin && centerDU < SHELF.innerPadding * 2 + SHELF_USABLE_WIDTH + SHELF.sideMargin;
    if (editing && index >= shelves.length && withinX) {
      // 새 선반 추가 영역
      const target: DropTarget = { kind: 'insert', shelfId: d.newShelfId, index: 0 };
      if (d.preview?.target && sameTarget(d.preview.target, target)) return d.preview;
      const withNew = addShelf(layout, d.newShelfId);
      const r = moveBook(withNew, books, d.bookId, target);
      return r.ok ? { kind: 'ok', layout: r.layout, target } : { kind: 'bad', reason: r.reason, target };
    }
    if (index < 0 || index >= shelves.length || cy < CONTENT_TOP || !withinX) {
      return { kind: 'bad', reason: 'outside', target: null };
    }
    const shelfId = shelves[index].id;
    const target = findDropTarget(detach(layout, d.bookId), books, shelfId, centerDU, p.pose);
    if (d.preview?.target && sameTarget(d.preview.target, target)) return d.preview;
    const r = moveBook(layout, books, d.bookId, target);
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
    setTimeout(() => setDetailId(hit.bookId), reduceMotion ? 0 : 170);
  };

  const hitAt = (x: number, y: number) => {
    const i = Math.floor((y - CONTENT_TOP) / m.rowHeight);
    const shelf = shelves[i];
    if (!shelf) return null;
    const top = m.shelfTop(i);
    const du = { x: (x - m.originX) / m.scale - SHELF.sideMargin, y: (y - top) / m.scale - SHELF.rowTopPad };
    return hitTest(frames.get(shelf.id) ?? [], du);
  };

  const beginDrag = (x: number, y: number, absX: number, absY: number, scroll: number) => {
    const hit = hitAt(x, y);
    if (!hit) return;
    const i = shelves.findIndex((s) => s.id === hit.shelfId);
    const box = frameBBox(hit);
    const tl = m.toContent(i, { x: box.minX, y: box.minY });
    const d: Drag = {
      bookId: hit.bookId,
      frame: hit,
      boxW: box.width * m.scale,
      grabX: x - tl.x,
      grabY: y - tl.y,
      preview: null,
      settling: null,
      newShelfId: `shelf-${Date.now().toString(36)}`,
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
    d.preview = { kind: 'same', target: { kind: 'insert', shelfId: hit.shelfId, index: -1 } };
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
    const shelfOrder = sortedShelves(final);
    const pl = placementOf(final, d.bookId)!;
    const idx = shelfOrder.findIndex((s) => s.id === pl.shelfId);
    const f = computeShelf(final, books, pl.shelfId).frames.find((fr) => fr.bookId === d.bookId)!;
    const box = frameBBox(f);
    const tl = m.toContent(idx, { x: box.minX, y: box.minY });
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

  // 가장자리 자동 스크롤. 스크롤하면서도 최신 좌표로 삽입 자리를 다시 계산한다.
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

  const hintFor = (shelfId: string): DropHint => {
    const p = drag?.preview;
    if (!drag || drag.settling || !p || !p.target || p.target.shelfId !== shelfId) return null;
    if (p.kind === 'bad') return { text: ko.fail[p.reason] || ko.fail.outside, bad: true };
    if (p.kind === 'same' && p.target.kind === 'insert' && p.target.index === -1) return null;
    if (p.target.shelfId === drag.newShelfId) return { text: ko.hint.newShelf, bad: false };
    return { text: p.target.kind === 'stack' ? ko.hint.stack : ko.hint.beside, bad: false };
  };

  // ---------- 메뉴 동작 ----------
  const detailPlacement = detailId ? placementOf(layout, detailId) ?? null : null;
  const menuPose = (pose: Pose) => (detailId ? commit(setPose(layout, books, detailId, pose)) : null);
  const menuTilt = (t: Tilt) => (detailId ? commit(setTilt(layout, books, detailId, t)) : null);
  const menuMove = (mv: MoveAction, id = detailId): string | null => {
    if (!id) return null;
    if (mv === 'prev' || mv === 'next') return commit(moveBy(layout, books, id, mv === 'prev' ? -1 : 1));
    const p = placementOf(layout, id)!;
    const i = shelves.findIndex((s) => s.id === p.shelfId) + (mv === 'up' ? -1 : 1);
    if (i < 0 || i >= shelves.length) return null;
    return commit(moveToShelf(layout, books, id, shelves[i].id));
  };

  const onA11y = useCallback(
    (bookId: string, action: string) => {
      if (action === 'activate') setDetailId(bookId);
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
  const contentHeight = CONTENT_TOP + shownShelves.length * m.rowHeight + (editing ? 110 : 24);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {ko.title}
          </Text>
          <Text style={styles.summary}>{ko.summary(year, count)}</Text>
        </View>
        <Pressable
          onPress={() => setEditing((e) => !e)}
          style={[styles.pill, editing && styles.pillOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: editing }}>
          {editing ? null : <Sparkles size={15} color={colors.ink} strokeWidth={1.6} />}
          <Text style={[styles.pillText, editing && { color: colors.sheet }]}>{editing ? ko.done : ko.decorate}</Text>
        </Pressable>
        <Pressable
          onPress={() => showToast({ text: ko.addSoon })}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel={ko.add}>
          <Plus size={24} color={colors.ink} strokeWidth={1.5} />
        </Pressable>
      </View>

      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          viewportH.value = e.nativeEvent.layout.height;
        }}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
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
                  height={m.rowHeight}
                  placeholderId={drag?.bookId ?? null}
                  selectedId={detailId ?? selectedId}
                  hint={hintFor(s.id)}
                  editing={editing && !drag}
                  canRemove={shelves.length > 1 && shelfItems(layout, s.id).length === 0}
                  reduceMotion={reduceMotion}
                  a11yLabelOf={a11yLabelOf}
                  onA11y={onA11y}
                  onRemove={onRemoveShelf}
                />
              ))}
              {editing && !(drag && shownShelves.some((s) => s.id === drag.newShelfId)) ? (
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8, gap: 10 },
  title: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 42, color: colors.ink, letterSpacing: 1 },
  summary: { fontSize: 14, color: colors.inkSoft, marginTop: 2, letterSpacing: 0.3 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inkFaint,
  },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillText: { fontSize: 13, color: colors.ink },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
