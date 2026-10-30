// 서버 동기화(I/O). 앱은 서버 없이도 모두 동작하는 '로컬 우선' 구조이고, 서버 주소(EXPO_PUBLIC_API_URL)가 있을 때만 동기화한다.
// 흐름: 첫 연결 때 기기 계정을 만들어 토큰을 받고, 서재 전체를 올린다 → 이후에는 바뀐 것만 올리고(push) 서버의 변경을 받는다(pull).
// 사진은 파일 API로 따로 올리고 받는다. 충돌은 updatedAt이 더 새로운 쪽이 이긴다(domain/sync.ts).
import * as FS from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import Storage from 'expo-sqlite/kv-store';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';

import { loadLayout, saveLayout } from '@/db/local-db';
import { buildPush, fullDirty, layoutFromWire, layoutToWire, mergeRemote, splitPush, type Dirty, type PullBody, type PushBody, type WireLayout } from '@/domain/sync';
import { IMAGE_DIR } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { clearPushed, getDirty, isLayoutDirty, LAYOUT_AT_KEY, loadDirty, markAllDirty, onLocalChange, pendingCount } from '@/store/sync-dirty';

const BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
const TOKEN_KEY = 'sync-token:v1';
const REV_KEY = 'sync-rev:v1';
const FILES_KEY = 'sync-files:v1'; // 이미 올린 파일 id
const ACCOUNT_KEY = 'account:v1'; // 카카오 연결 여부·닉네임(화면 표시용 사본)

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error'; lastAt?: string; error?: string; pending: number };
let status: SyncStatus = { state: BASE ? 'idle' : 'off', pending: 0 };
const listeners = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p, pending: pendingCount() };
  listeners.forEach((l) => l());
}
export const syncStatus = { get: () => status, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), available: !!BASE };

export type AccountInfo = { kakao: boolean; nickname: string };
let account: AccountInfo = { kakao: false, nickname: '' };
export const accountInfo = { get: () => account };
function setAccount(a: AccountInfo) {
  account = a;
  void Storage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  setStatus({});
}

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
  const layout = await loadLayout();
  if (!layout) return undefined;
  const at = (await Storage.getItem(LAYOUT_AT_KEY)) ?? new Date().toISOString();
  return layoutToWire(layout, at);
}

async function pushOnce(token: string, snapshot: Dirty, withLayout: boolean) {
  const { body, count } = buildPush(libraryStore.get().lib, snapshot, IMAGE_DIR);
  const layout = withLayout ? await currentLayout() : undefined;
  if (!count && !layout) {
    clearPushed(snapshot, withLayout);
    return;
  }
  await uploadFiles(token, filesIn(body));
  // 서버가 한 요청에 받는 수를 넘으면 참조 순서대로 나눠 올린다(처음 연결해 서재 전체를 올릴 때)
  for (const part of splitPush({ ...body, layout })) await api('POST', '/sync/push', token, part);
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
  const layout = layoutFromWire(remote);
  if (!layout) return;
  await saveLayout(layout, true);
  await Storage.setItem(LAYOUT_AT_KEY, remote.updatedAt);
  await reloadLayout?.();
}

let running = false;
let accountChecked = false; // 앱을 켠 뒤 첫 동기화 때 한 번만 서버의 계정 정보를 읽는다
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
    if (!accountChecked) {
      accountChecked = true;
      void refreshAccount(token);
    }
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

// ---------- 카카오 로그인(선택) ----------
// 서버가 코드를 교환한다(앱에는 카카오 키가 없다). 앱은 기기 토큰으로 시작 → 브라우저에서 동의 → 돌아온 티켓을 서버에 내고 그 계정의 토큰을 받는다.
// 이미 카카오에 이어진 다른 계정이면(다른 기기에서 먼저 로그인) 그 계정으로 바꾸고, 이 기기의 기록을 올려 합친다(updatedAt이 새로운 쪽이 이김).
export type KakaoResult = { ok: true; nickname: string; switched: boolean } | { ok: false; cancelled?: boolean; message: string };

export async function linkKakao(): Promise<KakaoResult> {
  if (!BASE) return { ok: false, message: '이 빌드에는 서버 주소가 없어요' };
  try {
    await loadDirty();
    const token = await ensureToken();
    const returnUrl = Linking.createURL('auth/kakao'); // 릴리스: chaekjang://auth/kakao, Expo Go: exp://…
    const { url } = await api<{ url: string }>('POST', '/auth/kakao/start', token, { returnUrl });
    const r = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (r.type !== 'success') return { ok: false, cancelled: true, message: '로그인을 취소했어요' };
    const q = Linking.parse(r.url).queryParams ?? {};
    if (q.error) return { ok: false, cancelled: q.error === 'denied', message: q.error === 'denied' ? '카카오 로그인을 취소했어요' : '카카오 로그인을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요' };
    if (typeof q.ticket !== 'string') return { ok: false, message: '로그인 응답을 읽지 못했어요' };
    const c = await api<{ token: string; switched: boolean; nickname: string }>('POST', '/auth/kakao/claim', token, { ticket: q.ticket });
    await Storage.setItem(TOKEN_KEY, c.token);
    if (c.switched) {
      await Storage.setItem(REV_KEY, '0');
      await Storage.setItem(FILES_KEY, '[]');
      markAllDirty(fullDirty(libraryStore.get().lib));
    }
    setAccount({ kakao: true, nickname: c.nickname });
    void syncNow();
    return { ok: true, nickname: c.nickname, switched: c.switched };
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) };
  }
}

async function refreshAccount(token: string) {
  try {
    const me = await api<{ kakao: boolean; nickname: string }>('GET', '/me', token);
    if (me.kakao !== account.kakao || me.nickname !== account.nickname) setAccount({ kakao: me.kakao, nickname: me.nickname });
  } catch {
    // 표시용이라 실패해도 동기화는 계속한다
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
  void Storage.getItem(ACCOUNT_KEY).then((raw) => {
    try {
      if (raw) account = JSON.parse(raw) as AccountInfo;
      setStatus({});
    } catch {
      // 깨진 값은 무시
    }
  });
  onLocalChange(() => schedule(4000));
  AppState.addEventListener('change', (s) => {
    if (s === 'active') schedule(500);
  });
  schedule(1500);
}
