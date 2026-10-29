import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useShelfEditCommands } from '../useShelfEditCommands';
import { frontSpin } from '@/domain/layout-engine';
import type { ShelfLayout } from '@/domain/types';
import type { SceneMotion } from '@/ui/shelf/scene';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: number) => ({ value }), withTiming: (value: number) => value,
  Easing: { cubic: () => {}, out: () => {} },
}));
jest.mock('@/ui/perf', () => ({ PERF_ENABLED: false }));
jest.mock('@/ui/shelf/planner', () => ({ displayedPoses: () => ({}), previewInto: jest.fn(), settleInto: jest.fn() }));
jest.mock('@/domain/shelf-scene', () => ({
  computeShelf: () => ({ frames: [] }), withLeans: (layout: unknown) => layout,
  resolveLeans: (layout: unknown) => ({ layout, falls: {} }),
}));
jest.mock('@/domain/layout-engine', () => ({
  placementOf: () => ({ bookId: 'a', shelfId: 's', pose: 'front', tilt: 0, spin: 0, pitch: 0 }),
  frontStateOf: () => ({ qx: 0, state: { spin: 0, pitch: 0 } }),
  depthRange: () => null,
  frontSpin: jest.fn((layout: unknown, _books: unknown, _id: string, _state: unknown, _qx: number, spin: number) => ({ layout, state: { spin, pitch: 0 } })),
  frontRelease: (layout: unknown) => layout,
}));

let renderer: ReactTestRenderer;
let api: ReturnType<typeof useShelfEditCommands>;
let frames: Map<number, FrameRequestCallback>;
const commit = jest.fn(() => null);
const base: ShelfLayout = { version: 2, shelves: [], placements: [], drawer: [] };
function Harness() {
  api = useShelfEditCommands({
    layout: base, books: {}, editId: 'a', motions: [{ shelfId: 's', m: {} } as SceneMotion],
    scale: 1, reduceMotion: true, settled: true, commit,
    getCommittedLayout: () => base, getFallDirections: () => ({}), setEditId: () => {}, setEditMsg: () => {},
  });
  return null;
}
beforeEach(() => {
  frames = new Map(); let next = 0;
  commit.mockClear(); (frontSpin as jest.Mock).mockClear();
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((run) => { frames.set(++next, run); return next; });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { if (id != null) frames.delete(id); });
  act(() => { renderer = create(<Harness />); });
});
afterEach(() => { act(() => renderer.unmount()); jest.restoreAllMocks(); });

test('unmount cancels the pending front-handle frame without saving', () => {
  act(() => { api.onHandle('begin', 0, 0); api.onHandle('move', 20, 0); });
  expect(frames.size).toBe(1);
  act(() => renderer.unmount());
  expect(frames.size).toBe(0);
  expect(commit).not.toHaveBeenCalled();
});
test('gesture cancellation discards the queued pose', () => {
  act(() => { api.onHandle('begin', 0, 0); api.onHandle('move', 20, 0); api.onHandle('cancel', 0, 0); });
  expect(frames.size).toBe(0);
  expect(commit).not.toHaveBeenCalled();
});
test('releasing before RAF applies the final pointer once and saves it', () => {
  act(() => { api.onHandle('begin', 0, 0); api.onHandle('move', 20, 0); api.onHandle('end', 0, 0); });
  expect(frontSpin).toHaveBeenCalledTimes(1);
  expect((frontSpin as jest.Mock).mock.calls[0][5]).toBe(18);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
});
