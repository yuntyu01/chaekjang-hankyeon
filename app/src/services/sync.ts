// 서버 동기화(I/O). 앱은 서버 없이도 모두 동작하는 '로컬 우선' 구조이고, 서버 주소(EXPO_PUBLIC_API_URL)가 있을 때만 동기화한다.
// 흐름: 첫 연결 때 기기 계정을 만들어 토큰을 받고, 서재 전체를 올린다 → 이후에는 바뀐 것만 올리고(push) 서버의 변경을 받는다(pull).
// 사진은 파일 API로 따로 올리고 받는다. 충돌은 updatedAt이 더 새로운 쪽이 이긴다(domain/sync.ts).
import * as FS from 'expo-file-system/legacy';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { buildPush, fullDirty, mergeRemote, type Dirty, type PullBody, type PushBody, type WireLayout } from '@/domain/sync';
import { IMAGE_DIR } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { clearPushed, getDirty, isLayoutDirty, LAYOUT_AT_KEY, loadDirty, markAllDirty, onLocalChange, pendingCount } from '@/store/sync-dirty';

const BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
const TOKEN_KEY = 'sync-token:v1';
const REV_KEY = 'sync-rev:v1';
const FILES_KEY = 'sync-files:v1'; // 이미 올린 파일 id
const LAYOUT_KV = 'shelf-layout';

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error'; lastAt?: string; error?: string; pending: number };
let status: SyncStatus = { state: BASE ? 'idle' : 'off', pending: 0 };
const listeners = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p, pending: pendingCount() };
  listeners.forEach((l) => l());
}
export const syncStatus = { get: () => status, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), available: !!BASE };

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function api<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    let code = 'http';
    let msg = `서버 응답 ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      msg = j.error?.message ?? msg;
    } catch {
      // 본문 없음
    }
    throw new ApiError(res.status, code, msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function ensureToken(): Promise<string> {
  const saved = await Storage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const created = await api<{ token: string }>('POST', '/auth/device', null);
  await Storage.setItem(TOKEN_KEY, created.token);
  await Storage.setItem(REV_KEY, '0');
  await Storage.setItem(FILES_KEY, '[]');
  markAllDirty(fullDirty(libraryStore.get().lib)); // 새 계정이니 가진 것을 모두 올린다
  return created.token;
}

const mime = (id: string) => (/\.png$/i.test(id) ? 'image/png' : /\.webp$/i.test(id) ? 'image/webp' : 'image/jpeg');

async function uploadFiles(token: string, ids: string[]) {
  if (!ids.length) return;
  const done = new Set<string>(JSON.parse((await Storage.getItem(FILES_KEY)) ?? '[]'));
  for (const id of ids) {
    if (done.has(id)) continue;
    const info = await FS.getInfoAsync(`${IMAGE_DIR}${id}`);
    if (!info.exists) continue; // 이 기기에 파일이 없으면(지워짐) 올릴 수 없다
    const r = await FS.uploadAsync(`${BASE}/files/${encodeURIComponent(id)}`, `${IMAGE_DIR}${id}`, { httpMethod: 'PUT', uploadType: FS.FileSystemUploadType.BINARY_CONTENT, headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime(id) } });
    if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, 'upload', `사진을 올리지 못했어요(${r.status})`);
    done.add(id);
  }
  await Storage.setItem(FILES_KEY, JSON.stringify([...done]));
}

async function downloadFiles(token: string, ids: string[]) {
  if (!ids.length) return;
  const dir = await FS.getInfoAsync(IMAGE_DIR);
  if (!dir.exists) await FS.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  const done = new Set<string>(JSON.parse((await Storage.getItem(FILES_KEY)) ?? '[]'));
  for (const id of ids) {
    if ((await FS.getInfoAsync(`${IMAGE_DIR}${id}`)).exists) continue;
    const r = await FS.downloadAsync(`${BASE}/files/${encodeURIComponent(id)}`, `${IMAGE_DIR}${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 200) {
      await FS.deleteAsync(`${IMAGE_DIR}${id}`, { idempotent: true }).catch(() => {});
      throw new ApiError(r.status, 'download', `사진을 받지 못했어요(${r.status})`);
    }
    done.add(id); // 서버에 있는 파일이니 다시 올리지 않는다
  }
  await Storage.setItem(FILES_KEY, JSON.stringify([...done]));
}

const filesIn = (b: PushBody) => [...new Set([...(b.bookmarks ?? []).map((x) => x.photoFileId), ...(b.editions ?? []).map((x) => x.coverFileId), ...(b.bindings ?? []).flatMap((x) => [x.coverArtFileId, x.spineArtFileId])].filter((x): x is string => !!x))];

async function currentLayout(): Promise<WireLayout | undefined> {
  const raw = await Storage.getItem(LAYOUT_KV);
  if (!raw) return undefined;
  const at = (await Storage.getItem(LAYOUT_AT_KEY)) ?? new Date().toISOString();
  return { layoutJson: raw, version: 2, updatedAt: at };
}

async function pushOnce(token: string, snapshot: Dirty, withLayout: boolean) {
  const { body, count } = buildPush(libraryStore.get().lib, snapshot, IMAGE_DIR);
  const layout = withLayout ? await currentLayout() : undefined;
  if (!count && !layout) {
    clearPushed(snapshot, withLayout);
    return;
  }
  await uploadFiles(token, filesIn(body));
  await api('POST', '/sync/push', token, { ...body, layout });
  clearPushed(snapshot, withLayout);
}

let reloadLayout: (() => Promise<void> | void) | null = null;

async function pullAll(token: string) {
  let since = Number((await Storage.getItem(REV_KEY)) ?? '0') || 0;
  for (let guard = 0; guard < 200; guard++) {
    const p = await api<PullBody>('GET', `/sync/pull?since=${since}&limit=500`, token);
    const m = mergeRemote(libraryStore.get().lib, p, IMAGE_DIR);
    await downloadFiles(token, m.files); // 사진을 먼저 받아 두고 서재에 반영한다(화면이 빈 사진을 보지 않게)
    if (m.writes.length || m.erases.length) libraryStore.applyRemote(m);
    if (p.layout) await applyLayout(p.layout);
    since = p.rev;
    await Storage.setItem(REV_KEY, String(since));
    if (!p.more) break;
  }
}

async function applyLayout(remote: WireLayout) {
  const localAt = (await Storage.getItem(LAYOUT_AT_KEY)) ?? '';
  if (Date.parse(remote.updatedAt) <= (Date.parse(localAt) || 0)) return; // 이 기기 배치가 더 새롭다
  await Storage.setItem(LAYOUT_KV, remote.layoutJson);
  await Storage.setItem(LAYOUT_AT_KEY, remote.updatedAt);
  await reloadLayout?.();
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function syncNow() {
  if (!BASE) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: undefined });
  try {
    await loadDirty();
    let token = await ensureToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await pushOnce(token, { ...getDirty() }, isLayoutDirty());
        await pullAll(token);
        break;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && attempt === 0) {
          await Storage.removeItem(TOKEN_KEY); // 계정이 사라졌다 → 새로 만들고 전부 다시 올린다
          token = await ensureToken();
          continue;
        }
        if (e instanceof ApiError && e.code === 'missing_reference' && attempt === 0) {
          markAllDirty(fullDirty(libraryStore.get().lib)); // 부모가 서버에 없다 → 전부 올려 참조를 채운다
          continue;
        }
        throw e;
      }
    }
    setStatus({ state: 'idle', lastAt: new Date().toISOString() });
  } catch (e) {
    setStatus({ state: 'error', error: String((e as Error)?.message ?? e) });
    schedule(60_000); // 연결이 안 되면 1분 뒤 다시
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(1000);
    }
  }
}

function schedule(ms: number) {
  if (!BASE) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, ms);
}

// 앱 시작 때 한 번 연결: 바뀔 때마다 4초 뒤 묶어 올리고, 앱이 다시 앞으로 오면 받아 온다.
export function initSync(hooks: { reloadLayout: () => Promise<void> | void }) {
  reloadLayout = hooks.reloadLayout;
  if (!BASE) return;
  void loadDirty().then(() => setStatus({}));
  onLocalChange(() => schedule(4000));
  AppState.addEventListener('change', (s) => {
    if (s === 'active') schedule(500);
  });
  schedule(1500);
}
