import type { Book3 } from '@/domain/book3';
import type { ShelfLayout } from '@/domain/types';
import { advanceShelfTransitions, initialShelfTransitions, nextTransitionExpiry } from '../shelf-transitions';

const pose: Book3 = { id: 'book', dims: { T: 10, H: 100, W: 50 }, t: { x: 20, y: 0, z: 0 }, roll: 0, yaw: 0 };
const base: ShelfLayout = {
  version: 2,
  shelves: [{ id: 'a', order: 0 }, { id: 'b', order: 1 }],
  placements: [{ bookId: 'book', shelfId: 'a', order: 0, pose: 'spine', tilt: 0 }],
  drawer: [],
};
const input = (layout: ShelfLayout, now = 100) => ({
  layout, now, transitMs: 200, fallMs: 150, scale: 2,
  baselineOf: (id: string) => id === 'a' ? 100 : 300,
  poseOf: () => pose,
  fallDirections: {}, fallIds: ['book'], dragActive: false, reduceMotion: false,
});

describe('shelf display transitions', () => {
  it('moves the displayed pose to destination coordinates without mutating the prior render', () => {
    const previous = initialShelfTransitions(base);
    const moved = { ...base, placements: [{ ...base.placements[0], shelfId: 'b' }] };
    const next = advanceShelfTransitions(previous, input(moved));
    expect(next.arrivals.b.book.t.y).toBe(100);
    expect(next.leaving).toEqual([{ id: 'book', from: 'a' }]);
    expect(nextTransitionExpiry(next)).toBe(300);
    expect(previous.transit.size).toBe(0);
    expect(previous.arrivals).toEqual({});
    expect(pose.t.y).toBe(0);
    // Abandoned candidate renders cannot become the start of another candidate.
    expect(advanceShelfTransitions(previous, input(base))).toBe(previous);
  });

  it('uses explicit fall metadata, removes it when a preview restores the book, and expires it', () => {
    const removed = { ...base, placements: [], drawer: ['book'] };
    const next = advanceShelfTransitions(initialShelfTransitions(base), { ...input(removed), fallDirections: { book: -1 } });
    expect(next.falling.get('book')?.d).toBe(-1);
    const restored = advanceShelfTransitions(next, input(base, 120));
    expect(restored.falling.size).toBe(0);
    expect(next.falling.size).toBe(1);
    const expired = advanceShelfTransitions(next, input(removed, 250));
    expect(expired.falling.size).toBe(0);
    expect(nextTransitionExpiry(expired)).toBeUndefined();
  });

  it('does not animate a manual drawer command or a reduced-motion fall', () => {
    const removed = { ...base, placements: [], drawer: ['book'] };
    expect(advanceShelfTransitions(initialShelfTransitions(base), { ...input(removed), fallIds: [] }).falling.size).toBe(0);
    expect(advanceShelfTransitions(initialShelfTransitions(base), { ...input(removed), reduceMotion: true }).falling.size).toBe(0);
    expect(advanceShelfTransitions(initialShelfTransitions(base), { ...input(removed), fallIds: [], dragActive: true }).falling.size).toBe(1);
  });

  it('keeps arrival identity until layout changes and removes expired transit residency', () => {
    const moved = { ...base, placements: [{ ...base.placements[0], shelfId: 'b' }] };
    const next = advanceShelfTransitions(initialShelfTransitions(base), input(moved));
    expect(advanceShelfTransitions(next, input(moved, 150))).toBe(next);
    const expired = advanceShelfTransitions(next, input(moved, 300));
    expect(expired.arrivals).toBe(next.arrivals);
    expect(expired.transit.size).toBe(0);
  });
});
