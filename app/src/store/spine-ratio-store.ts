// 책등 사진 비율(폭/높이)을 기기에 저장한다(domain/cover-url). 공개 그림에서 다시 잴 수 있는 값이라 동기화하지 않는다. 재는 일은 services/spine-ratio.
import Storage from 'expo-sqlite/kv-store';

import { loadSpineRatioEntries, spineRatioEntries } from '@/domain/cover-url';

const KEY = 'yes24-spine-ratios-v1';

export async function loadSpineRatios() {
  try {
    const raw = await Storage.getItem(KEY);
    if (raw) loadSpineRatioEntries(JSON.parse(raw) as [string, number][]);
  } catch {
    // 못 읽으면 다시 재면 된다
  }
}

export async function saveSpineRatios() {
  await Storage.setItem(KEY, JSON.stringify(spineRatioEntries())).catch(() => undefined);
}
