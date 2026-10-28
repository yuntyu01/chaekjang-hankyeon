// 동기화 대기 목록은 데이터와 함께 SQLite 트랜잭션으로 기록한다.
// 이 모듈의 사본은 화면 표시와 동기화 예약에만 쓰며, 업로드는 DB의 스냅숏을 읽는다.
import { acknowledgePending, onLocalDataChange, queueAllChanges, readPendingState, type Pending } from '@/db/local-db';
import type { Dirty } from '@/domain/sync';

let dirty: Pending = {};
let layoutRevision: number | null = null;
let loaded: Promise<void> | null = null;
let trigger: (() => void) | null = null;
let subscribed = false;

async function refresh() {
  const state = await readPendingState();
  dirty = state.dirty;
  layoutRevision = state.layout.dirty ? state.layout.revision : null;
}

export function onLocalChange(fn: () => void) { trigger = fn; }
export function loadDirty() {
  if (!subscribed) {
    subscribed = true;
    onLocalDataChange(() => {
      void refresh().then(() => trigger?.()).catch(() => trigger?.());
    });
  }
  loaded ??= refresh().catch(error => { loaded = null; throw error; });
  return loaded;
}
export const pendingCount = () => Object.keys(dirty).length + (layoutRevision === null ? 0 : 1);
export async function clearPushed(pushed: Pending, layoutPushed: number | null) {
  await acknowledgePending(pushed, layoutPushed);
  await refresh();
}
export async function markAllDirty(all: Dirty) {
  await queueAllChanges(all);
  await refresh();
}
