import { createArtCache } from '../art-cache';

it('keeps only recently used completed variants without invalidating mounted references', async () => {
  const cache = createArtCache<{ name: string }>(2);
  const first = await cache.load('a', async () => ({ name: 'a' }));
  await cache.load('b', async () => ({ name: 'b' }));
  expect(await cache.load('a', async () => { throw new Error('must reuse'); })).toBe(first);
  await cache.load('c', async () => ({ name: 'c' }));
  expect(cache.peek('b')).toBeUndefined();
  expect(cache.peek('a')).toBe(first);
  await cache.load('d', async () => ({ name: 'd' }));
  expect(cache.peek('a')).toBeUndefined();
  expect(first.name).toBe('a');
});

it('shares pending builds and retries failures instead of retaining failed promises', async () => {
  const cache = createArtCache<string>(2);
  let finish!: (value: string) => void;
  const build = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const first = cache.load('a', build);
  const second = cache.load('a', build);
  expect(first).toBe(second);
  await Promise.resolve();
  finish('ready');
  await expect(first).resolves.toBe('ready');
  expect(build).toHaveBeenCalledTimes(1);
  await expect(cache.load('bad', async () => { throw new Error('temporary'); })).rejects.toThrow('temporary');
  await expect(cache.load('bad', async () => 'recovered')).resolves.toBe('recovered');
});

it('evicts completed results even when many requests settle together', async () => {
  const cache = createArtCache<number>(3);
  await Promise.all(Array.from({ length: 100 }, (_, n) => cache.load(String(n), async () => n)));
  expect(Array.from({ length: 100 }, (_, n) => cache.peek(String(n))).filter((n) => n !== undefined)).toHaveLength(3);
});
