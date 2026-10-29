jest.mock('react-native-reanimated', () => ({
  makeMutable: <T,>(value: T) => ({ value }),
  withTiming: (to: number) => to,
  Easing: { linear: (x: number) => x, cubic: (x: number) => x ** 3, out: (f: unknown) => f, inOut: (f: unknown) => f },
}));
jest.mock('react-native-worklets', () => ({
  scheduleOnUI: (f: (...args: unknown[]) => void, ...args: unknown[]) => f(...args),
  scheduleOnRN: (f: (...args: unknown[]) => void, ...args: unknown[]) => f(...args),
}));

import { holdTrack } from '@/domain/transition';
import type { Book3 } from '@/domain/book3';
import type { Motion, Tracks } from '../scene';

let planner: typeof import('../planner');
let scene: typeof import('../scene');
let frames: FrameRequestCallback[];
const tracks = (x: number): Tracks => {
  const b: Book3 = { id: 'book', dims: { T: 20, H: 200, W: 130 }, roll: 0, yaw: 0, t: { x, y: 0, z: 0 } };
  return { book: holdTrack(b) };
};
const queue = (m: Motion, rec: Tracks, wait = false, shelf = 'shelf') => {
  planner.queueApply(m, shelf, rec, false, 0, 'target', wait ? [{ id: 'book', shelfId: shelf }] : []);
};
const runFrames = () => {
  while (frames.length) {
    const next = frames;
    frames = [];
    next.forEach((run) => run(0));
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  frames = [];
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((run) => { frames.push(run); return frames.length; });
  planner = require('../planner');
  scene = require('../scene');
});
afterEach(() => {
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('retains only the newest application per shelf before a batch is flushed', () => {
  const m = scene.makeMotion([]);
  const other = scene.makeMotion([]);
  queue(other, tracks(-100), false, 'other');
  let latest = tracks(0);
  for (let x = 0; x < 100; x++) {
    latest = tracks(x);
    queue(m, latest);
  }
  expect(planner.lastPlan.pendingApplications).toBe(2);
  planner.flushApply();
  expect(m.tracks.value).toBe(latest);
  expect(planner.lastPlan.pendingApplications).toBe(0);
});

it('retires replaced plans while waiting for a destination canvas to mount', () => {
  const m = scene.makeMotion([]);
  queue(m, tracks(0), true);
  planner.flushApply();
  let latest = tracks(0);
  for (let x = 1; x <= 100; x++) {
    latest = tracks(x);
    queue(m, latest);
    planner.flushApply();
    expect(planner.lastPlan.pendingApplications).toBe(1);
  }
  expect(m.tracks.value).toEqual({});
  scene.presentSV.value = { book: { shelf: true } };
  planner.tryApplyPending();
  runFrames();
  expect(m.tracks.value).toBe(latest);
  expect(planner.lastPlan.pendingApplications).toBe(0);
});

it('retires a deferred animation start superseded before its two frame wait ends', () => {
  const m = scene.makeMotion([]);
  queue(m, tracks(10), true);
  planner.flushApply();
  scene.presentSV.value = { book: { shelf: true } };
  planner.tryApplyPending();
  expect(frames.length).toBeGreaterThan(0);
  const latest = tracks(20);
  queue(m, latest);
  planner.flushApply();
  expect(planner.lastPlan.pendingApplications).toBe(1);
  const start = planner.mirrorOf(m).start;
  runFrames();
  expect(m.tracks.value).toBe(latest);
  expect(planner.mirrorOf(m).start).toBe(start);
  expect(planner.lastPlan.pendingApplications).toBe(0);
});
