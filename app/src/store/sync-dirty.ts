// 서버에 아직 못 올린 변경 목록(기기 DB의 sync_dirty 표: 종류·id마다 한 줄, 앱을 껐다 켜도 남는다). 서재 저장소·배치 저장소가 여기에 변경을 알리고,
// 동기화 서비스(services/sync.ts)가 읽어 올린 뒤 비운다. 표 쓰기는 서재 기록과 같은 쓰기 대기열이라 같은 트랜잭션에 들어간다.
// 이 파일은 저장소를 불러오지 않아 순환이 없다.
import Storage from 'expo-sqlite/kv-store';

import { dirtyDeleteOp, dirtyPutOp, loadDirtyRows, write, type LibKind, type Op } from '@/db/local-db';
import { dirtyKey, type Dirty } from '@/domain/sync';

const LEGACY_KEY = 'sync-dirty:v1'; // 예전: 목록 전체를 JSON 한 덩어리로 저장
const LAYOUT_KEY = 'sync-layout-dirty:v1';
export const LAYOUT_AT_KEY = 'shelf-layout-at';
const LAYOUT_ROW = 'layout'; // sync_dirty의 배치 표시(kind = id = 'layout')

let dirty: Dirty = {};
let layoutDirty = false;
let loaded: Promise<void> | null = null;
let trigger: (() => void) | null = null;

export function onLocalChange(fn: () => void) {
  trigger = fn;
}

const save = (ops: Op[]) => void write(ops).catch(() => {}); // 못 쓰면 다음 전체 올리기가 보완한다
const split = (key: string) => {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)] as const;
};

export function loadDirty() {
  loaded ??= (async () => {
    try {
      let fromDb: Dirty = {};
      for (const r of await loadDirtyRows()) {
        if (r.kind === LAYOUT_ROW) layoutDirty = true;
        else fromDb[`${r.kind}:${r.id}`] = { deleted: !!r.deleted, at: r.at };
      }
      // 예전 저장본(kv JSON)이 있으면 표로 옮기고 지운다
      const legacy = await Storage.getItem(LEGACY_KEY);
      if (legacy) {
        const old = JSON.parse(legacy) as Dirty;
        save(Object.entries(old).filter(([k]) => !fromDb[k]).map(([k, v]) => dirtyPutOp(...split(k), v.deleted, v.at)));
        fromDb = { ...old, ...fromDb };
        await Storage.removeItem(LEGACY_KEY);
      }
      if ((await Storage.getItem(LAYOUT_KEY)) === '1') {
        layoutDirty = true;
        save([dirtyPutOp(LAYOUT_ROW, LAYOUT_ROW, false, new Date().toISOString())]);
      }
      await Storage.removeItem(LAYOUT_KEY);
      // 불러오는 사이에 생긴 변경이 있으면 그쪽이 더 새롭다
      dirty = { ...fromDb, ...dirty };
    } catch {
      // 못 읽으면 빈 목록으로 시작(다음 전체 올리기가 보완한다)
    }
  })();
  return loaded;
}

// 서재 항목이 바뀌었거나(deleted=false) 지워졌음(true)
export function noteChange(kind: LibKind, id: string, deleted: boolean, at: string) {
  dirty[dirtyKey(kind, id)] = { deleted, at };
  save([dirtyPutOp(kind, id, deleted, at)]);
  trigger?.();
}

export function noteLayoutChange(at: string) {
  layoutDirty = true;
  void Storage.setItem(LAYOUT_AT_KEY, at).catch(() => {});
  save([dirtyPutOp(LAYOUT_ROW, LAYOUT_ROW, false, at)]);
  trigger?.();
}

export const getDirty = () => dirty;
export const isLayoutDirty = () => layoutDirty;
export const pendingCount = () => Object.keys(dirty).length + (layoutDirty ? 1 : 0);

// 올린 것만 지운다(올리는 사이에 또 바뀐 항목은 at이 달라 남는다)
export function clearPushed(pushed: Dirty, layoutPushed: boolean) {
  const ops: Op[] = [];
  for (const [k, v] of Object.entries(pushed)) {
    if (dirty[k] && dirty[k].at === v.at && dirty[k].deleted === v.deleted) {
      delete dirty[k];
      ops.push(dirtyDeleteOp(...split(k)));
    }
  }
  if (layoutPushed && layoutDirty) {
    layoutDirty = false;
    ops.push(dirtyDeleteOp(LAYOUT_ROW, LAYOUT_ROW));
  }
  save(ops);
}

export function markAllDirty(all: Dirty) {
  const ops: Op[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (dirty[k]) continue; // 이미 있는 변경(삭제 표시 포함)이 우선
    dirty[k] = v;
    ops.push(dirtyPutOp(...split(k), v.deleted, v.at));
  }
  layoutDirty = true;
  ops.push(dirtyPutOp(LAYOUT_ROW, LAYOUT_ROW, false, new Date().toISOString()));
  save(ops);
}
