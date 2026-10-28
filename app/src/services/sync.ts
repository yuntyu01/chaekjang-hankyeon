// 서버 동기화(I/O). 앱은 서버 없이도 모두 동작하는 '로컬 우선' 구조이고, 서버 주소(EXPO_PUBLIC_API_URL)가 있을 때만 동기화한다.
// 흐름: 첫 연결 때 기기 계정을 만들어 토큰을 받고, 서재 전체를 올린다 → 이후에는 바뀐 것만 올리고(push) 서버의 변경을 받는다(pull).
// 사진은 파일 API로 따로 올리고 받는다. 충돌은 updatedAt이 더 새로운 쪽이 이긴다(domain/sync.ts).
import * as FS from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import Storage from 'expo-sqlite/kv-store';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';

import { buildPush, fullDirty, mergeRemote, type PullBody, type PushBody, type WireLayout } from '@/domain/sync';
import { captureSyncSnapshot, readPendingState, saveLayout, type SyncSnapshot } from '@/db/local-db';
import { ApiError, createApiClient } from '@/services/api-client';
import { IMAGE_DIR } from '@/store/files';
import { libraryStore } from '@/store/library-store';
import { clearPushed, loadDirty, markAllDirty, onLocalChange, pendingCount } from '@/store/sync-dirty';

const BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
const TOKEN_KEY = 'sync-token:v1';
const REV_KEY = 'sync-rev:v1';
const EPOCH_KEY = 'sync-epoch:v1';
const FILES_KEY = 'sync-files:v1'; // 이미 올린 파일 id
const ACCOUNT_KEY = 'account:v1'; // 카카오 연결 여부·닉네임(화면 표시용 사본)
const PAUSE_KEY = 'sync-paused:v1';
let paused = false;
let deletionPending = false;
let pauseLoaded: Promise<void> | null = null;
function loadPause() {
  return pauseLoaded ??= Storage.getItem(PAUSE_KEY).then(value => {
    deletionPending = value === 'delete-pending';
    paused = value === '1' || deletionPending;
    setStatus({ paused, deletionPending });
  }).catch(error => { pauseLoaded = null; throw error; });
}
async function pauseCloud(deleting = false) {
  paused = true;
  deletionPending = deleting;
  if (timer) clearTimeout(timer);
  timer = null;
  again = false;
  setStatus({ state: 'off', paused: true, deletionPending });
  await Storage.setItem(PAUSE_KEY, deleting ? 'delete-pending' : '1');
}

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error'; lastAt?: string; error?: string; pending: number; paused?: boolean; deletionPending?: boolean };
let status: SyncStatus = { state: BASE ? 'idle' : 'off', pending: 0 };
const listeners = new Set<() => void>();
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p, pending: pendingCount() };
  listeners.forEach((l) => l());
}
export const syncStatus = { get: () => status, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), available: !!BASE };

export type AccountInfo = { kakao: boolean; google?: boolean; nickname: string };
let account: AccountInfo = { kakao: false, nickname: '' };
export const accountInfo = { get: () => account };
let providers = { google: false, kakao: false, accountDeletion: false };
export const loginProviders = { get: () => providers };
let providersChecked = false;
async function refreshProviders() {
  try {
    const available = await api<{ google?: boolean; kakao?: boolean; accountDeletion?: boolean }>('GET', '/auth/providers', null);
    providers = { google: !!available.google, kakao: !!available.kakao, accountDeletion: !!available.accountDeletion };
    providersChecked = true;
    setStatus({});
  } catch { providersChecked = false; }
}
function setAccount(a: AccountInfo) {
  account = a;
  void Storage.setItem(ACCOUNT_KEY, JSON.stringify(a)).catch(() => {});
  setStatus({});
}

const api = createApiClient(BASE);

async function ensureToken(): Promise<string> {
  if (paused) throw new Error('서버 동기화가 중지되어 있어요');
  const saved = await Storage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const created = await api<{ token: string }>('POST', '/auth/device', null);
  // 토큰을 마지막에 기록한다. 중간에 앱이 꺼져도 다음 시작 때 전체 올리기를 다시 준비한다.
  await libraryStore.flushPending();
  await markAllDirty(fullDirty(libraryStore.get().lib));
  await Storage.setItem(REV_KEY, '0');
  await Storage.setItem(FILES_KEY, '[]');
  await Storage.setItem(TOKEN_KEY, created.token);
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

async function pushBatch(token: string, body: PushBody) {
  const result = await api<{ skipped?: string[] }>('POST', '/sync/push', token, body);
  // 서버의 최신 값이 이긴 항목은 이전 커서 밖에 있을 수 있다. 확인 표시 전에 처음부터 다시 읽는다.
  if (result?.skipped?.length) await Storage.setItem(REV_KEY, '0');
}

async function pushOnce(token: string, snapshot: SyncSnapshot) {
  const { body, count } = buildPush(snapshot.lib, snapshot.dirty, IMAGE_DIR);
  if (count !== Object.keys(snapshot.dirty).length) throw new Error('올릴 서재 기록을 찾지 못했어요');
  const saved = snapshot.layout;
  const layout = saved.dirty && saved.json ? { layoutJson: saved.json, version: 2, updatedAt: saved.at ?? new Date().toISOString() } : undefined;
  const layoutRevision = saved.dirty ? saved.revision : null;
  if (!count && !layout) {
    await clearPushed(snapshot.dirty, layoutRevision);
    return;
  }
  // 서버는 종류별 한 요청에 1,000개까지만 받는다. 큰 서재는 참조 순서대로 나눠 보내고
  // 성공한 묶음만 확인해, 중간에 끊겨도 나머지를 다시 보낼 수 있게 한다.
  const kinds = ['editions', 'books', 'bindings', 'rounds', 'sessions', 'bookmarks'] as const;
  if (kinds.some(kind => (body[kind]?.length ?? 0) > 1000)) {
    for (const kind of kinds) {
      const items = body[kind] ?? [];
      for (let offset = 0; offset < items.length; offset += 1000) {
        const chunk = items.slice(offset, offset + 1000);
        const batch: PushBody = { [kind]: chunk };
        const sent = Object.fromEntries(chunk.map(item => [`${kind}:${item.id}`, snapshot.dirty[`${kind}:${item.id}`]]));
        await uploadFiles(token, filesIn(batch));
        await pushBatch(token, batch);
        await clearPushed(sent, null);
      }
    }
    if (layout) await pushBatch(token, { layout });
    await clearPushed({}, layoutRevision);
    return;
  }
  await uploadFiles(token, filesIn(body));
  await pushBatch(token, { ...body, layout });
  await clearPushed(snapshot.dirty, layoutRevision);
}

let reloadLayout: (() => Promise<void> | void) | null = null;

async function pullAll(token: string) {
  let since = Number((await Storage.getItem(REV_KEY)) ?? '0') || 0;
  let epoch = Number((await Storage.getItem(EPOCH_KEY)) ?? '0') || 0;
  for (let guard = 0; guard < 200; guard++) {
    const p = await api<PullBody>('GET', `/sync/pull?since=${since}&limit=500`, token);
    // 새 서버에서 예전 커서가 놓쳤을 수 있는 기록을 한 번 처음부터 다시 받는다.
    if ((p.syncEpoch ?? 0) >= 2 && epoch < 2) {
      await Storage.setItem(REV_KEY, '0');
      await Storage.setItem(EPOCH_KEY, '2');
      epoch = 2;
      if (since !== 0) { since = 0; continue; }
    }
    const downloaded = new Set<string>();
    let applied = false;
    for (let retry = 0; retry < 20; retry++) {
      await libraryStore.flushPending();
      const pending = await readPendingState();
      if (libraryStore.hasPending()) continue;
      const m = mergeRemote(libraryStore.get().lib, p, IMAGE_DIR, pending.dirty);
      const files = m.files.filter(id => !downloaded.has(id));
      if (files.length) {
        await downloadFiles(token, files); // 사진을 먼저 받아 두고 서재에 반영한다.
        files.forEach(id => downloaded.add(id));
        continue; // 받는 동안 바뀐 로컬 기록을 다시 비교한다.
      }
      if (m.writes.length || m.erases.length) await libraryStore.applyRemote(m);
      applied = true;
      break;
    }
    if (!applied) throw new Error('변경을 받아오지 못했어요. 다시 시도해 주세요');
    if (p.layout) await applyLayout(p.layout);
    since = p.rev;
    await Storage.setItem(REV_KEY, String(since));
    if (!p.more) break;
  }
}

async function applyLayout(remote: WireLayout) {
  if (await saveLayout(remote.layoutJson, remote.updatedAt, false)) await reloadLayout?.();
}

let running = false;
let runningDone: Promise<void> | null = null;
let linking = false;
let accountChecked = false; // 앱을 켠 뒤 첫 동기화 때 한 번만 서버의 계정 정보를 읽는다
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let verifiedToken: string | null = null;

async function requireSafeServer(token: string) {
  if (verifiedToken === token) return;
  const response = await api<{ syncEpoch?: number }>('GET', '/sync/pull?since=0&limit=1', token);
  // 낮은 revision이 나중에 커밋되면 변경을 놓칠 수 있는 구 서버에는 쓰지 않는다.
  if ((response.syncEpoch ?? 0) < 2) throw new Error('서버 동기화 업데이트가 필요해요. 기록은 기기에 보관하고 있어요.');
  verifiedToken = token;
}

export async function syncNow() {
  if (!BASE) return;
  try { await loadPause(); }
  catch (error) { setStatus({ state: 'error', error: String((error as Error)?.message ?? error) }); return; }
  if (paused) return;
  if (linking) {
    again = true;
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  let finishRunning!: () => void;
  runningDone = new Promise<void>(resolve => { finishRunning = resolve; });
  setStatus({ state: 'syncing', error: undefined });
  try {
    await loadDirty();
    let token = await ensureToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await requireSafeServer(token);
        await libraryStore.flushPending();
        const snapshot = await captureSyncSnapshot(true);
        await pushOnce(token, snapshot);
        await pullAll(token);
        break;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          if (!deletionPending) await pauseCloud();
          throw new Error('계정 인증이 만료됐거나 삭제되어 동기화를 중지했어요. 기기의 기록은 남아 있어요.');
        }
        if (e instanceof ApiError && e.code === 'missing_reference' && attempt === 0) {
          await markAllDirty(fullDirty(libraryStore.get().lib)); // 부모가 서버에 없다 → 전부 올려 참조를 채운다
          continue;
        }
        throw e;
      }
    }
    setStatus({ state: 'idle', lastAt: new Date().toISOString() });
    if (!providersChecked) void refreshProviders();
    if (!accountChecked) {
      accountChecked = true;
      void refreshAccount(token);
    }
  } catch (e) {
    setStatus({ state: paused ? 'off' : 'error', error: String((e as Error)?.message ?? e) });
    schedule(60_000); // 연결이 안 되면 1분 뒤 다시
  } finally {
    running = false;
    runningDone = null;
    finishRunning();
    if (again) {
      again = false;
      schedule(1000);
    }
  }
}

// 서버 계정만 삭제한다. 요청 전에 동기화를 영구 중지하고, 진행 중인 쓰기가 끝난 뒤 요청한다.
export async function deleteCloudAccount() {
  if (!BASE) throw new Error('서버 주소가 설정되지 않았어요');
  if (linking) throw new Error('로그인 처리가 끝난 뒤 다시 시도해 주세요');
  linking = true;
  try {
    await loadPause();
    const token = await Storage.getItem(TOKEN_KEY);
    if (!token) throw new Error('삭제할 서버 계정 인증이 없어요');
    await pauseCloud(true);
    await runningDone;
    await api('DELETE', '/me', token, { confirmation: 'DELETE' });
    // 서버 접수 확인을 먼저 기록한다. 이후 정리 도중 종료돼도 삭제 대기 상태로 갇히지 않는다.
    await Storage.setItem(PAUSE_KEY, '1');
    deletionPending = false;
    setStatus({ state: 'off', paused: true, deletionPending: false });
    await Storage.removeItem(TOKEN_KEY);
    await Storage.removeItem(REV_KEY);
    await Storage.removeItem(FILES_KEY);
    verifiedToken = null;
    accountChecked = false;
    setAccount({ kakao: false, google: false, nickname: '' });
    setStatus({ state: 'off', paused: true, deletionPending: false, error: undefined });
  } finally {
    linking = false;
  }
}

// 사용자가 명시적으로 원할 때만 새 서버 계정을 만들고 이 기기의 기록을 다시 올린다.
export async function resumeCloudSync() {
  await loadPause();
  if (deletionPending) throw new Error('계정 삭제 요청을 먼저 완료해 주세요.');
  if (linking || running) throw new Error('진행 중인 작업이 끝난 뒤 다시 시도해 주세요.');
  await Storage.removeItem(TOKEN_KEY);
  await Storage.removeItem(REV_KEY);
  await Storage.removeItem(FILES_KEY);
  await Storage.removeItem(PAUSE_KEY);
  paused = false;
  verifiedToken = null;
  accountChecked = false;
  setAccount({ kakao: false, google: false, nickname: '' });
  setStatus({ state: 'idle', paused: false, deletionPending: false, error: undefined });
  await syncNow();
}

// ---------- 소셜 로그인(선택) ----------
// 공급자의 코드는 서버에서 교환한다. 앱은 기기 토큰에 묶인 일회용 티켓만 받는다.
export type KakaoResult = { ok: true; nickname: string; switched: boolean } | { ok: false; cancelled?: boolean; message: string };

export const linkKakao = () => linkSocial('kakao');
export const linkGoogle = () => linkSocial('google');

async function linkSocial(provider: 'kakao' | 'google'): Promise<KakaoResult> {
  if (!BASE) return { ok: false, message: '이 빌드에는 서버 주소가 없어요' };
  if (linking) return { ok: false, message: '로그인 처리 중이에요' };
  linking = true;
  let syncAfterLink = false;
  try {
    // 기존 계정의 pull 커서가 새 계정에 기록되지 않도록 동기화와 계정 변경을 겹치지 않는다.
    await runningDone;
    await loadPause();
    if (paused) throw new Error('동기화가 중지되어 있어요. 먼저 동기화를 다시 시작해 주세요.');
    await loadDirty();
    const token = await ensureToken();
    const returnUrl = Linking.createURL(`auth/${provider}`);
    if (returnUrl !== `chaekjang://auth/${provider}`) return { ok: false, message: '설치한 앱에서 로그인할 수 있어요.' };
    const { url } = await api<{ url: string }>('POST', `/auth/${provider}/start`, token, { returnUrl, accountLifecycle: '1' });
    const r = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (r.type !== 'success') return { ok: false, cancelled: true, message: '로그인을 취소했어요' };
    const q = Linking.parse(r.url).queryParams ?? {};
    if (q.error) return { ok: false, cancelled: q.error === 'denied', message: q.error === 'denied' ? '로그인을 취소했어요' : '로그인을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요' };
    if (typeof q.ticket !== 'string') return { ok: false, message: '로그인 응답을 읽지 못했어요' };
    const c = await api<{ token: string; switched: boolean; nickname: string }>('POST', `/auth/${provider}/claim`, token, { ticket: q.ticket });
    if (c.switched) {
      await Storage.setItem(REV_KEY, '0');
      await Storage.setItem(FILES_KEY, '[]');
      await libraryStore.flushPending();
      await markAllDirty(fullDirty(libraryStore.get().lib));
    }
    await Storage.setItem(TOKEN_KEY, c.token);
    setAccount(c.switched ? { kakao: provider === 'kakao', google: provider === 'google', nickname: c.nickname } : { ...account, [provider]: true, nickname: c.nickname });
    syncAfterLink = true;
    return { ok: true, nickname: c.nickname, switched: c.switched };
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) };
  } finally {
    linking = false;
    if (syncAfterLink || again) {
      again = false;
      schedule(500);
    }
  }
}

async function refreshAccount(token: string) {
  try {
    const me = await api<AccountInfo>('GET', '/me', token);
    if (await Storage.getItem(TOKEN_KEY) !== token) return;
    if (me.kakao !== account.kakao || !!me.google !== !!account.google || me.nickname !== account.nickname) setAccount({ kakao: me.kakao, google: !!me.google, nickname: me.nickname });
  } catch {
    // 표시용이라 실패해도 동기화는 계속한다
  }
}

function schedule(ms: number) {
  if (!BASE || paused) return;
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
  void refreshProviders();
  void loadPause().catch(error => setStatus({ state: 'error', error: String((error as Error)?.message ?? error) }));
  void loadDirty().then(() => setStatus({})).catch((error) => {
    setStatus({ state: 'error', error: String((error as Error)?.message ?? error) });
    schedule(60_000);
  });
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
    if (s === 'active') { void refreshProviders(); schedule(500); }
  });
  schedule(1500);
}
