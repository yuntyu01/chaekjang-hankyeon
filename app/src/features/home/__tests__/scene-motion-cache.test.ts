import { retainSceneMotions } from '../scene-motion-cache';
import type { Motion } from '@/ui/shelf/scene';

const motion = () => ({ tracks: { value: {} }, t: { value: 1 }, away: { value: {} }, awayT: { value: 0 } }) as Motion;

it('keeps active shelf identities and ordering while dropping removed cache entries', () => {
  const a = motion();
  const b = motion();
  const removed = motion();
  const previous = new Map([['a', a], ['b', b], ['removed', removed]]);
  const create = jest.fn(() => motion());
  const next = retainSceneMotions(['b', 'new', 'a'], previous, create);
  expect([...next.map.keys()]).toEqual(['b', 'new', 'a']);
  expect(next.motions.map((item) => item.shelfId)).toEqual(['b', 'new', 'a']);
  expect(next.map.get('a')).toBe(a);
  expect(next.map.get('b')).toBe(b);
  expect(create.mock.calls).toEqual([['new']]);
  // An in-progress animation can still hold this object; pruning isn't disposal.
  expect(previous.get('removed')).toBe(removed);
  expect(removed.t.value).toBe(1);
  expect(previous.has('new')).toBe(false);
});

it('initializes a re-added shelf from current frames instead of old animation state', () => {
  const old = motion();
  const removed = retainSceneMotions([], new Map([['shelf', old]]), () => { throw new Error('unexpected creation'); });
  const fresh = motion();
  const added = retainSceneMotions(['shelf'], removed.map, () => fresh);
  expect(removed.map.size).toBe(0);
  expect(added.map.get('shelf')).toBe(fresh);
  expect(added.map.get('shelf')).not.toBe(old);
});
