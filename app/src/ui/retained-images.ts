import type { SkImage } from '@shopify/react-native-skia';

type ImageRegistry = { __kept?: Record<string, SkImage[]> };

// Keep a few recent generations while a canvas switches to its new snapshot.
export function keepLatest<T extends SkImage | null>(key: string, image: T): T {
  'worklet';
  if (!image) return image;
  const g = globalThis as unknown as ImageRegistry;
  const kept = g.__kept ?? (g.__kept = {});
  const list = kept[key] ?? (kept[key] = []);
  if (list[list.length - 1] !== image) list.push(image);
  while (list.length > 3) list.shift()!.dispose();
  return image;
}

export function releaseRetainedImages(key: string) {
  'worklet';
  // Drop only this owner's extra references. A canvas can still have a final
  // frame in flight, so cleanup must not explicitly dispose these images.
  const kept = (globalThis as unknown as ImageRegistry).__kept;
  if (kept) delete kept[key];
}
