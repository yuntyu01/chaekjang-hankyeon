// 책장에 그리는 표지·책등 그림(YES24 주소 등)을 기기에 받아 두고 읽는다.
// 책은 사진을 기다리지 않는다: 기기에 있으면 바로 쓰고, 없으면 코드로 그린 장정을 먼저 보이고 받는 대로 바꾼다. 못 받으면 조금 뒤·앱으로 돌아올 때 다시 받는다.
// Skia useImage는 네트워크 실패를 알리지 않아(2.6.2: 그림 해석 실패일 때만 onError) 인터넷이 없으면 책이 영영 안 그려졌다(2026-11-02 시험).
// 다시 받을 수 있는 그림이라 캐시 폴더에 둔다(기기가 지워도 다시 받는다).
import * as FS from 'expo-file-system/legacy';
import { AppState, type NativeEventSubscription } from 'react-native';

export const COVER_DIR = `${FS.cacheDirectory ?? ''}covers/`;
const DOWNLOAD_MS = 20000;
const READ_MS = 8000;
export const COVER_RETRY_MS = 60000;

// 약속이 끝나지 않아도(Skia.Data.fromURI는 실패해도 끝나지 않을 수 있다) 정한 시간 뒤 null로 끝낸다
export function withTimeout<T>(work: Promise<T>, ms = READ_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export const isRemoteImage = (uri: string) => /^https?:\/\//i.test(uri);

// 주소 → 파일 이름(같은 주소는 늘 같은 파일)
export function coverFileName(uri: string) {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < uri.length; i++) {
    const c = uri.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}.img`;
}
const fileOf = (uri: string) => `${COVER_DIR}${coverFileName(uri)}`;

async function existing(file: string) {
  try {
    const info = await FS.getInfoAsync(file);
    return info.exists && (!('size' in info) || info.size > 0);
  } catch {
    return false;
  }
}

type Fetched = { file: string | null; retry: boolean };
const running = new Map<string, Promise<Fetched>>();
// 지금 받고 있는 조각 파일: 정리(pruneCoverCache)가 지우면 옮기기에 실패해 그 표지가 다시 받을 때까지 안 보인다
const receiving = new Set<string>();

async function fetchOnce(uri: string): Promise<Fetched> {
  const file = fileOf(uri);
  const part = `${file}.${Date.now().toString(36)}.part`;
  receiving.add(part);
  try {
    await FS.makeDirectoryAsync(COVER_DIR, { intermediates: true }).catch(() => undefined);
    const res = await withTimeout(FS.downloadAsync(uri, part), DOWNLOAD_MS);
    if (res?.status === 200) {
      await FS.moveAsync({ from: part, to: file });
      return { file, retry: false };
    }
    await FS.deleteAsync(part, { idempotent: true }).catch(() => undefined);
    // 없는 그림(4xx)은 이번 실행에서 다시 받지 않는다. 연결 실패·서버 오류는 다시 받는다
    return { file: null, retry: !res || res.status >= 500 };
  } catch {
    await FS.deleteAsync(part, { idempotent: true }).catch(() => undefined);
    return { file: null, retry: true };
  } finally {
    receiving.delete(part);
  }
}

// 같은 주소를 여러 책이 동시에 원해도 한 번만 받는다
function fetchCover(uri: string): Promise<Fetched> {
  const now = running.get(uri);
  if (now) return now;
  const job = fetchOnce(uri).finally(() => running.delete(uri));
  running.set(uri, job);
  return job;
}

// ---------- 다시 받기: 시간이 지나거나 앱으로 돌아오면 기다리던 책들을 한꺼번에 깨운다 ----------
const waiting = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let appState: NativeEventSubscription | null = null;

function disarm() {
  if (timer) clearTimeout(timer);
  timer = null;
  appState?.remove();
  appState = null;
}
function wakeAll() {
  const list = [...waiting];
  waiting.clear();
  disarm();
  list.forEach((fn) => fn());
}
function retryLater(fn: () => void) {
  waiting.add(fn);
  if (!timer) timer = setTimeout(wakeAll, COVER_RETRY_MS);
  if (!appState) appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') wakeAll();
  });
  return () => {
    waiting.delete(fn);
    if (!waiting.size) disarm();
  };
}

// 받아 둔 표지 정리(앱을 켠 뒤 한 번): 강제 종료로 남은 조각 파일을 지우고, 받은 지 오래된 표지를 지우고, 상한을 넘으면 오래된 것부터 지운다.
// 만료: YES24 답변(2026-11)은 이미지 파일을 일시적 저장(캐싱) 범위에서만 허용하고 장기 보관은 안 된다. 기간 기준은 정해져 있지 않아 90일로 둔다(지운 표지는 다음에 볼 때 다시 받는다)
export const COVER_CACHE_MAX_BYTES = 150 * 1024 * 1024;
export const COVER_CACHE_MAX_AGE_SEC = 90 * 24 * 3600;
export async function pruneCoverCache(maxBytes = COVER_CACHE_MAX_BYTES, nowMs = Date.now()) {
  try {
    const names = await FS.readDirectoryAsync(COVER_DIR);
    const files: { path: string; size: number; at: number }[] = [];
    for (const name of names) {
      const path = `${COVER_DIR}${name}`;
      if (name.endsWith('.part')) {
        if (!receiving.has(path)) await FS.deleteAsync(path, { idempotent: true }).catch(() => undefined);
        continue;
      }
      const info = await FS.getInfoAsync(path);
      if (!info.exists) continue;
      const at = info.modificationTime ?? 0;
      if (at > 0 && nowMs / 1000 - at > COVER_CACHE_MAX_AGE_SEC) {
        await FS.deleteAsync(path, { idempotent: true }).catch(() => undefined);
        continue;
      }
      files.push({ path, size: info.size ?? 0, at });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= maxBytes) break;
      await FS.deleteAsync(f.path, { idempotent: true }).catch(() => undefined);
      total -= f.size;
    }
  } catch {
    // 폴더가 아직 없거나 읽지 못하면 다음에 다시 한다
  }
}

export type CoverState<T> = { image: T | null; pending: boolean };

// 표지 하나를 지켜본다. pending은 '기기에 있는지 확인하는 짧은 동안'만 true라 책은 네트워크를 기다리지 않는다. 그만 볼 때 돌려준 함수를 부른다.
export function watchCover<T>(uri: string | null | undefined, decode: (file: string) => Promise<T | null>, onState: (s: CoverState<T>) => void): () => void {
  if (!uri) {
    onState({ image: null, pending: false });
    return () => undefined;
  }
  let alive = true;
  let cancelRetry: (() => void) | null = null;
  const read = async (file: string) => (await withTimeout(decode(file))) ?? null;

  const download = async () => {
    const got = await fetchCover(uri);
    if (!alive) return;
    if (got.file) {
      const image = await read(got.file);
      if (!alive) return;
      if (image) return onState({ image, pending: false });
      // 받았는데 그림이 아니다(오류 페이지 등): 남기지 않고 이번 실행에서는 그만 받는다
      await FS.deleteAsync(got.file, { idempotent: true }).catch(() => undefined);
      return;
    }
    if (got.retry) cancelRetry = retryLater(() => void download());
  };

  void (async () => {
    if (!isRemoteImage(uri)) {
      // 기기 안 그림(내가 찍은 사진 등): 파일이 없으면 Skia가 끝나지 않을 수 있어 먼저 확인한다
      const image = !uri.startsWith('file:') || (await existing(uri)) ? await read(uri) : null;
      if (alive) onState({ image, pending: false });
      return;
    }
    const file = fileOf(uri);
    if (await existing(file)) {
      const image = await read(file);
      if (!alive) return;
      if (image) return onState({ image, pending: false });
      await FS.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      if (!alive) return;
    }
    if (!alive) return;
    onState({ image: null, pending: false });
    await download();
  })();

  return () => {
    alive = false;
    cancelRetry?.();
  };
}
