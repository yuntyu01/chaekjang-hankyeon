// 서버에 아직 못 올린 변경 목록(기기에 저장해 앱을 껐다 켜도 남는다). 서재 저장소·배치 저장소가 여기에 변경을 알리고,
// 동기화 서비스(services/sync.ts)가 읽어 올린 뒤 비운다. 이 파일은 저장소를 불러오지 않아 순환이 없다.
import Storage from 'expo-sqlite/kv-store';

import type { LibKind } from '@/db/local-db';
import { dirtyKey, type Dirty } from '@/domain/sync';

const KEY = 'sync-dirty:v1';
const LAYOUT_KEY = 'sync-layout-dirty:v1';
export const LAYOUT_AT_KEY = 'shelf-layout-at';

let dirty: Dirty = {};
let layoutDirty = false;
// 배치 업로드 중에 새 변경이 생겼는지 판별한다. 숫자는 실행 중에만 필요하다.
let layoutRevision = 0;
let loaded: Promise<void> | null = null;
let trigger: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function onLocalChange(fn: () => void) {
  trigger = fn;
}

export function loadDirty() {
  loaded ??= (async () => {
    try {
      const raw = await Storage.getItem(KEY);
      // 불러오는 사이에 생긴 변경이 있으면 합친다
      if (raw) dirty = { ...(JSON.parse(raw) as Dirty), ...dirty };
      layoutDirty = layoutDirty || (await Storage.getItem(LAYOUT_KEY)) === '1';
    } catch {
      // 못 읽으면 빈 목록으로 시작(다음 전체 올리기가 보완한다)
    }
  })();
  return loaded;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void Storage.setItem(KEY, JSON.stringify(dirty)).catch(() => {});
    void Storage.setItem(LAYOUT_KEY, layoutDirty ? '1' : '0').catch(() => {});
  }, 300);
}

// 서재 항목이 바뀌었거나(deleted=false) 지워졌음(true)
export function noteChange(kind: LibKind, id: string, deleted: boolean, at: string) {
  dirty[dirtyKey(kind, id)] = { deleted, at };
  save();
  trigger?.();
}

export function noteLayoutChange(at: string) {
  layoutDirty = true;
  layoutRevision++;
  void Storage.setItem(LAYOUT_AT_KEY, at).catch(() => {});
  save();
  trigger?.();
}

export const getDirty = () => dirty;
export const layoutSnapshot = () => layoutDirty ? layoutRevision : null;
export const pendingCount = () => Object.keys(dirty).length + (layoutDirty ? 1 : 0);

// 올린 것만 지운다(올리는 사이에 또 바뀐 항목은 at이 달라 남는다)
export function clearPushed(pushed: Dirty, layoutPushed: number | null) {
  for (const [k, v] of Object.entries(pushed)) if (dirty[k] && dirty[k].at === v.at && dirty[k].deleted === v.deleted) delete dirty[k];
  if (layoutPushed !== null && layoutPushed === layoutRevision) layoutDirty = false;
  save();
}

export function markAllDirty(all: Dirty) {
  dirty = { ...all, ...dirty };
  layoutDirty = true;
  layoutRevision++;
  save();
}
