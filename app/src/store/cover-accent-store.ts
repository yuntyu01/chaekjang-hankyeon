// 표지에서 뽑은 갈피 색을 기기에 저장한다(domain/cover-url). 공개 그림에서 다시 잴 수 있는 값이라 동기화하지 않는다. 재는 일은 services/cover-accent.
import Storage from 'expo-sqlite/kv-store';

import { coverAccentEntries, loadCoverAccentEntries } from '@/domain/cover-url';

// 뽑는 규칙이 바뀌면 번호를 올려 다시 잰다(v2: 작아도 뚜렷한 색, 2026-11-05)
const KEY = 'cover-accents-v2';

export async function loadCoverAccents() {
  try {
    const raw = await Storage.getItem(KEY);
    if (raw) loadCoverAccentEntries(JSON.parse(raw) as [string, string][]);
  } catch {
    // 못 읽으면 다시 재면 된다
  }
}

export async function saveCoverAccents() {
  await Storage.setItem(KEY, JSON.stringify(coverAccentEntries())).catch(() => undefined);
}
