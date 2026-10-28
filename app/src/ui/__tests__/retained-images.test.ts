import type { SkImage } from '@shopify/react-native-skia';
import { keepLatest, releaseRetainedImages } from '../retained-images';

const registry = () => (globalThis as unknown as { __kept?: Record<string, SkImage[]> }).__kept;
const image = () => ({ dispose: jest.fn() }) as unknown as SkImage;

afterEach(() => {
  for (const key of Object.keys(registry() ?? {})) releaseRetainedImages(key);
});

it('drops an unmounted owner without disposing images still referenced by a canvas', () => {
  const a = image();
  const b = image();
  keepLatest('book-a:mount-1', a);
  keepLatest('book-a:mount-2', b);
  releaseRetainedImages('book-a:mount-1');
  expect(registry()?.['book-a:mount-1']).toBeUndefined();
  expect(registry()?.['book-a:mount-2']).toEqual([b]);
  expect(a.dispose).not.toHaveBeenCalled();
  expect(b.dispose).not.toHaveBeenCalled();
});

it('keeps only three image generations per active owner', () => {
  const images = Array.from({ length: 4 }, image);
  for (const img of images) keepLatest('book', img);
  expect(registry()?.book).toEqual(images.slice(1));
  expect(images[0].dispose).toHaveBeenCalledTimes(1);
  keepLatest('book', images[3]);
  expect(registry()?.book).toHaveLength(3);
});

it('leaves no global per-book entries after repeated mount and unmount', () => {
  for (let i = 0; i < 200; i++) {
    const key = `book:${i}`;
    keepLatest(key, image());
    releaseRetainedImages(key);
  }
  expect(Object.keys(registry() ?? {})).toHaveLength(0);
  keepLatest('empty', null);
  expect(registry()?.empty).toBeUndefined();
});
