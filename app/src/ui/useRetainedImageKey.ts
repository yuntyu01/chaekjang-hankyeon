import { useEffect, useId } from 'react';
import { scheduleOnUI } from 'react-native-worklets';
import { releaseRetainedImages } from './retained-images';

// Different mounted canvases must never rotate or clean up one another's
// snapshots, even when they show the same book or shelf.
export function useRetainedImageKey(label: string): string {
  const instance = useId();
  const key = `${label}:${instance}`;
  useEffect(() => () => { scheduleOnUI(releaseRetainedImages, key); }, [key]);
  return key;
}
