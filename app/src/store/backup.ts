// 데이터 내보내기·복원. 백업 범위: 내 서재 전부(판본·내 책·회차·세션·갈피·장정), 책장 배치, 책장 시점, 설정,
// 그리고 앱 폴더에 보관한 사진(실제 표지 사진·갈피 페이지 사진·장정 그림). 진행 중 독서(타이머)는 넣지 않는다.
// 파일 하나(JSON)에 사진을 base64로 담는다. 사진 주소는 'img:이름'으로 바꿔 저장해 다른 기기·재설치에서도 복원된다.
//
// 복원 안전장치: ① 파일 전체를 먼저 검사(형식·모든 항목의 id·사진 이름)하고 틀리면 아무것도 바꾸지 않는다.
// ② 바꾸기 전에 지금 상태를 메모리에 떠 두고, 도중에 실패하면 그 상태로 되돌린다(서재 표는 한 트랜잭션).
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Storage from 'expo-sqlite/kv-store';

import { LIB_KINDS } from '@/db/local-db';
import type { Library } from '@/domain/library';

import { shelfBooks } from './boot';
import { IMAGE_DIR } from './files';
import { fullDirty } from '@/domain/sync';
import { libraryStore } from './library-store';
import { markAllDirty, noteChange, noteLayoutChange } from './sync-dirty';
import { placementStore } from './placement-store';
import { settingsStore, type Settings } from './settings-store';
import { viewStore } from './view-store';

const LAYOUT_KEY = 'shelf-layout';
const VIEW_KEY = 'view-settings:v1';
const DIR_KEY = 'backup-dir:v1'; // 사용자가 고른 저장 폴더(SAF 주소)

export type Backup = {
  app: 'chaekjang';
  format: 1;
  exportedAt: string;
  library: Library;
  layout: string | null;
  view: string | null;
  settings: Settings;
  images: Record<string, string>;
};

const toRef = (uri?: string) => (uri && uri.startsWith(IMAGE_DIR) ? `img:${uri.slice(IMAGE_DIR.length)}` : uri);
const fromRef = (uri?: string) => (uri && uri.startsWith('img:') ? `${IMAGE_DIR}${uri.slice(4)}` : uri);

function mapImages(lib: Library, f: (u?: string) => string | undefined): Library {
  const out: Library = JSON.parse(JSON.stringify(lib));
  for (const e of Object.values(out.editions)) e.coverUri = f(e.coverUri);
  for (const m of Object.values(out.bookmarks)) m.photoUri = f(m.photoUri);
  for (const b of Object.values(out.bindings)) {
    b.coverArtUri = f(b.coverArtUri);
    b.spineArtUri = f(b.spineArtUri);
  }
  return out;
}

export const countsOf = (d: Pick<Backup, 'library' | 'images'>) => ({
  books: Object.keys(d.library.books ?? {}).length,
  bookmarks: Object.keys(d.library.bookmarks ?? {}).length,
  rounds: Object.keys(d.library.rounds ?? {}).length,
  sessions: Object.keys(d.library.sessions ?? {}).length,
  bindings: Object.keys(d.library.bindings ?? {}).length,
  images: Object.keys(d.images ?? {}).length,
});

// 지금 상태를 백업 객체로
export async function snapshot(): Promise<Backup> {
  const lib = libraryStore.get().lib;
  const images: Record<string, string> = {};
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (info.exists) {
    for (const name of await FS.readDirectoryAsync(IMAGE_DIR)) images[name] = await FS.readAsStringAsync(`${IMAGE_DIR}${name}`, { encoding: FS.EncodingType.Base64 });
  }
  return {
    app: 'chaekjang',
    format: 1,
    exportedAt: new Date().toISOString(),
    library: mapImages(lib, toRef),
    layout: await Storage.getItem(LAYOUT_KEY),
    view: await Storage.getItem(VIEW_KEY),
    settings: settingsStore.raw(),
    images,
  };
}

const fileName = (d: Backup) => `chaekjang-backup-${d.exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;

// 공유 창으로 내보내기
export async function exportShare() {
  const data = await snapshot();
  const uri = `${FS.cacheDirectory}${fileName(data)}`;
  await FS.writeAsStringAsync(uri, JSON.stringify(data));
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: '책장 한켠 백업' });
  return { name: fileName(data), counts: countsOf(data) };
}

// 폴더에 파일로 저장(처음 한 번 폴더를 고르고, 다음부터 같은 폴더에)
export async function exportToFolder(pickAgain = false): Promise<{ ok: true; name: string; counts: ReturnType<typeof countsOf> } | { ok: false; reason: 'denied' | 'error'; message?: string }> {
  const SAF = FS.StorageAccessFramework;
  let dir = pickAgain ? null : await Storage.getItem(DIR_KEY);
  if (!dir) {
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    dir = perm.directoryUri;
    await Storage.setItem(DIR_KEY, dir);
  }
  try {
    const data = await snapshot();
    const uri = await SAF.createFileAsync(dir, fileName(data).replace(/\.json$/, ''), 'application/json');
    await SAF.writeAsStringAsync(uri, JSON.stringify(data));
    return { ok: true, name: fileName(data), counts: countsOf(data) };
  } catch (e) {
    await Storage.removeItem(DIR_KEY); // 폴더 권한이 사라졌을 수 있다: 다음에는 다시 고르게
    return { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) };
  }
}

// 파일 검사: 틀리면 이유를 돌려준다(아무것도 바꾸지 않는다)
export function validateBackup(x: unknown): string | null {
  const d = x as Partial<Backup>;
  if (!d || d.app !== 'chaekjang' || d.format !== 1) return '책장 한켠 백업 파일이 아니에요.';
  if (!d.library || typeof d.library !== 'object') return '서재 기록이 없어요.';
  for (const k of LIB_KINDS) {
    const t = (d.library as Record<string, unknown>)[k];
    if (t === undefined) continue;
    if (!t || typeof t !== 'object') return `기록(${k})이 깨져 있어요.`;
    for (const [key, item] of Object.entries(t as Record<string, { id?: unknown }>)) {
      if (!item || typeof item.id !== 'string' || item.id !== key) return `기록(${k}) 중 id가 맞지 않는 항목이 있어요.`;
    }
  }
  for (const [name, b64] of Object.entries(d.images ?? {})) {
    if (!/^[\w.-]+$/.test(name) || typeof b64 !== 'string') return '사진 목록이 깨져 있어요.';
  }
  return null;
}

export async function readBackupFile(): Promise<{ ok: true; data: Backup; counts: ReturnType<typeof countsOf> } | { ok: false; reason: 'canceled' | 'invalid'; message?: string }> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return { ok: false, reason: 'canceled' };
  try {
    const data = JSON.parse(await FS.readAsStringAsync(r.assets[0].uri)) as Backup;
    const bad = validateBackup(data);
    if (bad) return { ok: false, reason: 'invalid', message: bad };
    return { ok: true, data, counts: countsOf(data) };
  } catch (e) {
    return { ok: false, reason: 'invalid', message: `파일을 읽지 못했어요. ${String((e as Error)?.message ?? e)}` };
  }
}

async function apply(data: Backup) {
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  for (const [name, b64] of Object.entries(data.images ?? {})) await FS.writeAsStringAsync(`${IMAGE_DIR}${name}`, b64, { encoding: FS.EncodingType.Base64 });
  const src = data.library as Partial<Library>;
  const lib = mapImages({ editions: src.editions ?? {}, books: src.books ?? {}, rounds: src.rounds ?? {}, sessions: src.sessions ?? {}, bookmarks: src.bookmarks ?? {}, bindings: src.bindings ?? {} }, fromRef);
  const before = libraryStore.get().lib;
  await libraryStore.replaceAll(lib);
  // 서버와도 같은 내용이 되게: 백업에 없는 항목은 삭제로, 있는 항목은 모두 다시 올린다
  const at = new Date().toISOString();
  for (const kind of LIB_KINDS) for (const id of Object.keys(before[kind])) if (!(id in lib[kind])) noteChange(kind, id, true, at);
  markAllDirty(fullDirty(lib));
  if (data.layout) await Storage.setItem(LAYOUT_KEY, data.layout);
  else await Storage.removeItem(LAYOUT_KEY);
  noteLayoutChange(new Date().toISOString());
  if (data.view) await Storage.setItem(VIEW_KEY, data.view);
  settingsStore.set(data.settings ?? {});
  await placementStore.load(shelfBooks(lib));
  await viewStore.load();
}

// 지금 데이터를 백업 내용으로 바꾼다. 실패하면 바꾸기 전 상태로 되돌리고 오류를 알린다.
// failAt(시험용): 이 단계에서 일부러 실패시켜 되돌리기를 확인한다
export async function restoreBackup(data: Backup, failAt?: 'library' | 'after-library') {
  const bad = validateBackup(data);
  if (bad) throw new Error(bad);
  const before = await snapshot();
  try {
    if (failAt === 'library') {
      await apply({ ...data, library: { ...data.library, books: { ...data.library.books, broken: { id: null } as never } } });
    } else {
      await apply(data);
      if (failAt === 'after-library') throw new Error('시험용 실패(서재를 바꾼 뒤)');
    }
  } catch (e) {
    await apply(before);
    throw new Error(`복원하지 못해 이전 상태로 되돌렸어요. (${String((e as Error)?.message ?? e)})`);
  }
  // 성공: 이전 사진 중 백업에 없는 것은 지운다
  const keep = new Set(Object.keys(data.images ?? {}));
  for (const name of await FS.readDirectoryAsync(IMAGE_DIR)) if (!keep.has(name)) await FS.deleteAsync(`${IMAGE_DIR}${name}`, { idempotent: true });
}
