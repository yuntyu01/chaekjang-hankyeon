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

import { LIB_KINDS, captureSyncSnapshot } from '@/db/local-db';
import type { Library } from '@/domain/library';

import { shelfBooks } from './boot';
import { IMAGE_DIR } from './files';
import { VIEW_SETTINGS_KEY } from './view-settings-key';
import { libraryStore } from './library-store';
import { EMPTY_LAYOUT, placementStore } from './placement-store';
import { settingsStore, type Settings } from './settings-store';
import { viewStore } from './view-store';

const VIEW_KEY = VIEW_SETTINGS_KEY;
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

const hasKey = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const toRef = (uri?: string) => (uri && uri.startsWith(IMAGE_DIR) ? `img:${uri.slice(IMAGE_DIR.length)}` : uri);

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

// 초기 백업에는 후에 추가된 기록 종류가 없을 수 있다.
function normalizeLibrary(lib: Partial<Library>): Library {
  return { editions: lib.editions ?? {}, books: lib.books ?? {}, rounds: lib.rounds ?? {}, sessions: lib.sessions ?? {}, bookmarks: lib.bookmarks ?? {}, bindings: lib.bindings ?? {} };
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
  await libraryStore.flushPending();
  const saved = await captureSyncSnapshot();
  const lib = saved.lib;
  const images: Record<string, string> = {};
  const refs = new Set<string>();
  const exported = mapImages(lib, uri => {
    const ref = toRef(uri);
    if (ref?.startsWith('img:')) refs.add(ref.slice(4));
    return ref;
  });
  for (const name of refs) images[name] = await FS.readAsStringAsync(`${IMAGE_DIR}${name}`, { encoding: FS.EncodingType.Base64 });
  return {
    app: 'chaekjang',
    format: 1,
    exportedAt: new Date().toISOString(),
    library: exported,
    layout: saved.layout.json,
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
  if (!d.library || typeof d.library !== 'object' || Array.isArray(d.library)) return '서재 기록이 없어요.';
  if (typeof d.exportedAt !== 'string' || !Number.isFinite(Date.parse(d.exportedAt))) return '백업 날짜가 올바르지 않아요.';
  if (d.layout !== null && typeof d.layout !== 'string') return '책장 배치가 올바르지 않아요.';
  if (d.images !== undefined && (!d.images || typeof d.images !== 'object' || Array.isArray(d.images))) return '사진 목록이 깨져 있어요.';
  for (const k of LIB_KINDS) {
    const t = (d.library as Record<string, unknown>)[k];
    if (t === undefined && k !== 'books' && k !== 'editions') continue;
    if (!t || typeof t !== 'object' || Array.isArray(t)) return `기록(${k})이 깨져 있어요.`;
    for (const [key, item] of Object.entries(t as Record<string, { id?: unknown }>)) {
      if (!item || typeof item.id !== 'string' || item.id !== key) return `기록(${k}) 중 id가 맞지 않는 항목이 있어요.`;
    }
  }
  const lib = normalizeLibrary(d.library as Partial<Library>);
  for (const e of Object.values(lib.editions)) if (typeof e.title !== 'string' || !Array.isArray(e.authors) || e.authors.some(a => typeof a !== 'string')) return '도서 정보가 올바르지 않아요.';
  for (const b of Object.values(lib.books)) if (typeof b.editionId !== 'string' || !hasKey(lib.editions, b.editionId) || !['want', 'reading', 'read', 'paused'].includes(b.status)) return '책과 도서 정보의 연결이 올바르지 않아요.';
  for (const r of Object.values(lib.rounds)) if (!hasKey(lib.books, r.myBookId) || !Number.isInteger(r.index) || r.index < 1) return '독서 회차가 올바르지 않아요.';
  for (const b of Object.values(lib.bindings)) if (!hasKey(lib.books, b.myBookId) || typeof b.spineColor !== 'string' || typeof b.motif !== 'string') return '장정 정보가 올바르지 않아요.';
  for (const m of Object.values(lib.bookmarks)) if (!hasKey(lib.books, m.myBookId) || typeof m.text !== 'string') return '갈피 정보가 올바르지 않아요.';
  for (const s of Object.values(lib.sessions)) if ((s.myBookId && !hasKey(lib.books, s.myBookId)) || (s.roundId && !hasKey(lib.rounds, s.roundId)) || !Number.isFinite(s.durationMs) || s.durationMs < 0) return '독서 시간 기록이 올바르지 않아요.';
  for (const [name, b64] of Object.entries(d.images ?? {})) {
    if (!/^[\w.-]{1,80}$/.test(name) || name === '.' || name === '..' || typeof b64 !== 'string') return '사진 목록이 깨져 있어요.';
  }
  if (d.layout) {
    try {
      const layout = JSON.parse(d.layout) as { version?: number; shelves?: unknown; placements?: unknown; drawer?: unknown };
      if (![1, 2].includes(layout?.version ?? 0) || !Array.isArray(layout.shelves) || !Array.isArray(layout.placements) || (layout.version === 2 && !Array.isArray(layout.drawer))) return '책장 배치가 올바르지 않아요.';
    } catch { return '책장 배치가 올바르지 않아요.'; }
  }
  try {
    let missing = false;
    mapImages(lib, uri => {
      if (uri !== undefined && typeof uri !== 'string') { missing = true; return uri; }
      if (uri?.startsWith('img:') && !hasKey(d.images ?? {}, uri.slice(4))) missing = true;
      return uri;
    });
    if (missing) return '사진 파일을 찾지 못했어요.';
  } catch { return '서재 기록이 올바르지 않아요.'; }
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

async function apply(data: Backup, options: { reuseFiles?: boolean; onLibrarySaved?: () => void } = {}) {
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  // 기존 파일을 덮어쓰지 않는다. 중간에 앱이 종료돼도 현재 서재 사진이 남는다.
  const renamed = new Map<string, string>();
  const prefix = `restore_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const refs = new Set<string>();
  mapImages(normalizeLibrary(data.library), uri => { if (uri?.startsWith('img:')) refs.add(uri.slice(4)); return uri; });
  let index = 0;
  for (const name of refs) {
    if (options.reuseFiles) { renamed.set(name, name); continue; }
    const ext = name.match(/\.(png|webp|jpe?g)$/i)?.[1]?.toLowerCase() ?? 'jpg';
    const fresh = `${prefix}_${index++}.${ext}`;
    await FS.writeAsStringAsync(`${IMAGE_DIR}${fresh}`, data.images[name], { encoding: FS.EncodingType.Base64 });
    renamed.set(name, fresh);
  }
  const at = new Date().toISOString();
  const lib = mapImages(normalizeLibrary(data.library), uri => uri?.startsWith('img:') ? `${IMAGE_DIR}${renamed.get(uri.slice(4))}` : uri);
  // 복원은 지금의 사용자 변경이다. 백업 당시 시각을 그대로 쓰면 서버가 최신 값으로 거절한다.
  for (const kind of LIB_KINDS) for (const item of Object.values(lib[kind])) item.updatedAt = at;
  await libraryStore.replaceAll(lib, { json: data.layout ?? JSON.stringify(EMPTY_LAYOUT), at });
  options.onLibrarySaved?.();
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
  let changed = false;
  const onLibrarySaved = () => { changed = true; };
  try {
    if (failAt === 'library') {
      await apply({ ...data, library: { ...data.library, books: { ...data.library.books, broken: { id: null } as never } } }, { onLibrarySaved });
    } else {
      await apply(data, { onLibrarySaved });
      if (failAt === 'after-library') throw new Error('시험용 실패(서재를 바꾼 뒤)');
    }
  } catch (e) {
    if (changed) {
      try { await apply(before, { reuseFiles: true }); }
      catch (rollback) { throw new Error(`복원과 이전 상태 복구에 실패했어요. (${String((rollback as Error)?.message ?? rollback)})`); }
    }
    throw new Error(`복원하지 못했어요. 이전 기록은 유지했어요. (${String((e as Error)?.message ?? e)})`);
  }
  // 이전 사진은 진행 중인 동기화나 실패 복구에 필요할 수 있으므로 여기서 지우지 않는다.
}
