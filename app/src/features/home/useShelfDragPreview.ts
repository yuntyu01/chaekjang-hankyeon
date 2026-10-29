// Owns drag preview scheduling and fall hysteresis, separate from screen gestures.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { applySwapTarget, bookXs, detach, findDropTarget, findSwapTarget, moveBook, placementOf, sortedShelves, type BookMap } from '@/domain/layout-engine';
import { SHELF, SHELF_USABLE_WIDTH } from '@/domain/geometry';
import { resolveLeans } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';
import { rowAt, type RowGeom } from '@/ui/shelf/metrics';
import { fallSig, HOLD_MS, stepHold, type Hold } from '@/ui/shelf/preview-hold';
import { PERF_ENABLED, PUSH_DEBUG } from '@/ui/perf';
import type { Drag, Preview } from './shelf-interaction';

type Move = { vx: number; vy: number; scroll: number; rest: boolean };
type Options = {
  layout: ShelfLayout; books: BookMap; rows: RowGeom[]; scale: number;
  dragRef: RefObject<Drag | null>;
  updateDrag: (drag: Drag | null) => void;
  onTarget: (drag: Drag, preview: Preview) => void;
  onTiming: (calculationMs: number, changed: boolean) => void;
};
export function useShelfDragPreview({ layout, books, rows, scale, dragRef, updateDrag, onTarget, onTiming }: Options) {
  const shelves = sortedShelves(layout);
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
    const centerDU = d.startCenterDU + (vx - d.startVx) / scale;
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
      if (r.ok) return { kind: 'ok', ...resolveLeans(r.layout, books, shelfId), key, shelfId, hint: t.kind, index: at, push: PUSH_DEBUG.on && t.kind === 'place' ? pushInfo(d, r.layout, shelfId, t.x) : undefined };
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
    if (r.ok) {
      const source = resolveLeans(r.layout, books, d.shelfId);
      const target = resolveLeans(source.layout, books, shelfId);
      return { kind: 'ok', layout: target.layout, falls: { ...source.falls, ...target.falls }, key, shelfId, hint: t.kind === 'stack' ? 'stack' : 'place', index: at, push: PUSH_DEBUG.on && t.kind === 'insert' ? pushInfo(d, r.layout, shelfId, t.x) : undefined };
    }
    return { kind: 'bad', reason: r.reason, key, shelfId, index: at };
  };

  // 같은 줄 안에서 다른 책의 넘어짐이 바뀌는 미리보기는 손가락이 조금 더 가거나 멈춘 뒤에 받아들인다(그동안 앞 미리보기 그대로).
  // rest: 손가락이 HOLD_MS 동안 멈춰 있다
  const holdPreview = (d: Drag, next: Preview, vx: number, rest = false): { preview: Preview; hold: Hold } => {
    const x = d.startCenterDU + (vx - d.startVx) / scale;
    const sig = next.kind === 'ok' ? fallSig(layout, next.layout, d.bookId) : '';
    const cur = d.preview;
    if (!cur || cur.kind === 'bad' || next.kind === 'bad' || cur.shelfId !== next.shelfId) return { preview: next, hold: { sig, at: x } };
    const r = stepHold(d.hold, sig, x, rest);
    return { preview: r.take ? next : cur, hold: r.hold };
  };
  const pending = useRef<Move | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRest = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancelPreview = () => {
    clearRest();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
  };
  // A queued frame always consults the latest layout and callbacks.
  const current = useRef({ computePreview, holdPreview, updateDrag, onTarget, onTiming });
  current.current = { computePreview, holdPreview, updateDrag, onTarget, onTiming };
  const moveRef = useRef<(vx: number, vy: number, scroll: number, rest?: boolean) => void>(() => {});
  const moveDrag = (vx: number, vy: number, scroll: number, rest = false) => {
    pending.current = { vx, vy, scroll, rest };
    if (!rest) clearRest();
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const d = dragRef.current, mv = pending.current;
      if (!d || !mv) return;
      const api = current.current;
      const start = PERF_ENABLED ? performance.now() : 0;
      const next = api.computePreview(d, mv.vx, mv.vy, mv.scroll);
      const held = api.holdPreview(d, next, mv.vx, mv.rest);
      if (held.preview !== next) {
        clearRest();
        timer.current = setTimeout(() => {
          timer.current = null;
          if (dragRef.current && pending.current === mv) moveRef.current(mv.vx, mv.vy, mv.scroll, true);
        }, HOLD_MS);
      }
      api.onTarget(d, held.preview);
      api.onTiming(PERF_ENABLED ? performance.now() - start : 0, held.preview !== d.preview);
      if (held.preview === d.preview) {
        if (held.hold !== d.hold) dragRef.current = { ...d, hold: held.hold };
      } else api.updateDrag({ ...d, preview: held.preview, hold: held.hold });
    });
  };
  moveRef.current = moveDrag;
  const finalPreview = (drag: Drag): Preview | null => {
    const mv = pending.current;
    return mv && frame.current !== null
      ? current.current.holdPreview(drag, current.current.computePreview(drag, mv.vx, mv.vy, mv.scroll), mv.vx).preview
      : drag.preview;
  };
  useLayoutEffect(() => cancelPreview, []);
  return { moveDrag, finalPreview, cancelPreview };
}
