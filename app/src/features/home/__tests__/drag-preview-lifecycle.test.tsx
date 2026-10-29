import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useShelfDragPreview } from '../useShelfDragPreview';
import type { Drag } from '../shelf-interaction';
import type { ShelfLayout } from '@/domain/types';
import type { RowGeom } from '@/ui/shelf/metrics';

jest.mock('@/ui/shelf/metrics', () => ({ rowAt: () => 0 }));
jest.mock('@/ui/perf', () => ({ PERF_ENABLED: false, PUSH_DEBUG: { on: false } }));
jest.mock('@/domain/layout-engine', () => ({
  sortedShelves: () => [{ id: 's' }],
  findSwapTarget: (_layout: unknown, _books: unknown, _id: string, x: number) => ({ kind: 'place', index: 0, x }),
  applySwapTarget: (layout: ShelfLayout, _books: unknown, _id: string, target: { x: number }) => ({ ok: true, layout: { ...layout, drawer: [`at-${target.x}`] } }),
}));
jest.mock('@/domain/shelf-scene', () => ({ resolveLeans: (layout: ShelfLayout) => ({ layout, falls: {} }) }));
jest.mock('@/ui/shelf/preview-hold', () => ({
  HOLD_MS: 250,
  fallSig: () => 'changed',
  stepHold: (hold: unknown, _sig: string, _x: number, rest: boolean) => ({ hold, take: rest }),
}));

let renderer: ReactTestRenderer;
let api: ReturnType<typeof useShelfDragPreview>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
const base: ShelfLayout = { version: 2, shelves: [], placements: [], drawer: [] };
let dragRef: { current: Drag | null };
let update: jest.Mock;
const target = jest.fn();
function Harness() {
  api = useShelfDragPreview({
    layout: base, books: {}, rows: [{ top: 0 } as RowGeom], scale: 1,
    dragRef, updateDrag: update, onTarget: target, onTiming: () => {},
  });
  return null;
}
const flushFrame = () => { const jobs = [...frames.values()]; frames.clear(); act(() => jobs.forEach((run) => run(0))); };

beforeEach(() => {
  jest.useFakeTimers();
  frames = new Map();
  nextFrame = 0;
  target.mockClear();
  dragRef = { current: { bookId: 'a', shelfId: 's', preview: { kind: 'same', key: 'self', shelfId: 's', hint: 'self' }, startVx: 10, startCenterDU: 10, widthDU: 5, members: ['a'], hold: { sig: '', at: 10 } } };
  update = jest.fn((drag) => { dragRef.current = drag; });
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((run) => { frames.set(++nextFrame, run); return nextFrame; });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { if (id != null) frames.delete(id); });
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => { act(() => renderer.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('unmount cancels both a queued move and a rest timer after a held preview', () => {
  api.moveDrag(11, 5, 0);
  flushFrame(); // held fall preview arms the resting timer
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  api.moveDrag(12, 5, 0, true); // another move is waiting for its animation frame
  const calls = target.mock.calls.length;
  act(() => renderer.unmount());
  expect(frames.size).toBe(0);
  jest.runAllTimers();
  flushFrame();
  expect(target).toHaveBeenCalledTimes(calls);
  expect(update).not.toHaveBeenCalled();
});

test('release computes the final queued pointer without waiting for RAF', () => {
  dragRef.current!.preview = null; // first preview does not need fall hysteresis
  api.moveDrag(22, 5, 0);
  const final = api.finalPreview(dragRef.current!);
  expect(final?.kind).toBe('ok');
  if (final?.kind === 'ok') expect(final.layout.drawer).toEqual(['at-22']);
  expect(update).not.toHaveBeenCalled();
  api.cancelPreview();
  expect(frames.size).toBe(0);
});
