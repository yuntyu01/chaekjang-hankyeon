// 데이터 내보내기·복원. 백업 범위: 내 서재 전부(판본·내 책·회차·세션·갈피·장정), 책장 배치, 책장 시점, 설정,
// 그리고 앱 폴더에 보관한 사진(실제 표지 사진·갈피 페이지 사진·장정 그림). 진행 중 독서(타이머)는 넣지 않는다.
// 파일 하나(JSON)에 사진을 base64로 담는다. 사진 주소는 'img:이름'으로 바꿔 저장해 다른 기기·재설치에서도 복원된다.
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Storage from 'expo-sqlite/kv-store';

import type { Library } from '@/domain/library';

import { IMAGE_DIR } from './files';
import { libraryStore } from './library-store';
import { placementStore } from './placement-store';
import { shelfBooks } from './boot';
import { settingsStore, type Settings } from './settings-store';
import { viewStore } from './view-store';

const LAYOUT_KEY = 'shelf-layout';
const VIEW_KEY = 'view-settings:v1';

type Backup = {
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

export async function exportBackup() {
  const lib = libraryStore.get().lib;
  const images: Record<string, string> = {};
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (info.exists) {
    for (const name of await FS.readDirectoryAsync(IMAGE_DIR)) images[name] = await FS.readAsStringAsync(`${IMAGE_DIR}${name}`, { encoding: FS.EncodingType.Base64 });
  }
  const data: Backup = {
    app: 'chaekjang',
    format: 1,
    exportedAt: new Date().toISOString(),
    library: mapImages(lib, toRef),
    layout: await Storage.getItem(LAYOUT_KEY),
    view: await Storage.getItem(VIEW_KEY),
    settings: settingsStore.raw(),
    images,
  };
  const stamp = data.exportedAt.slice(0, 10);
  const uri = `${FS.cacheDirectory}chaekjang-backup-${stamp}.json`;
  await FS.writeAsStringAsync(uri, JSON.stringify(data));
  const counts = { books: Object.keys(lib.books).length, bookmarks: Object.keys(lib.bookmarks).length, sessions: Object.keys(lib.sessions).length, images: Object.keys(images).length };
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: '책장 한켠 백업 저장' });
  return { uri, counts };
}

export async function readBackupFile(): Promise<{ ok: true; data: Backup; counts: Record<string, number> } | { ok: false; reason: 'canceled' | 'invalid'; message?: string }> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return { ok: false, reason: 'canceled' };
  try {
    const data = JSON.parse(await FS.readAsStringAsync(r.assets[0].uri)) as Backup;
    if (data.app !== 'chaekjang' || data.format !== 1 || !data.library?.books) return { ok: false, reason: 'invalid', message: '책장 한켠 백업 파일이 아니에요.' };
    return { ok: true, data, counts: { books: Object.keys(data.library.books).length, bookmarks: Object.keys(data.library.bookmarks ?? {}).length, sessions: Object.keys(data.library.sessions ?? {}).length, images: Object.keys(data.images ?? {}).length } };
  } catch (e) {
    return { ok: false, reason: 'invalid', message: `파일을 읽지 못했어요. ${String((e as Error)?.message ?? e)}` };
  }
}

// 지금 데이터를 백업 내용으로 바꾼다(사진 → 서재 → 배치·시점·설정 순)
export async function restoreBackup(data: Backup) {
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  for (const [name, b64] of Object.entries(data.images ?? {})) await FS.writeAsStringAsync(`${IMAGE_DIR}${name}`, b64, { encoding: FS.EncodingType.Base64 });
  const src = data.library as Partial<Library>;
  const lib = mapImages({ editions: src.editions ?? {}, books: src.books ?? {}, rounds: src.rounds ?? {}, sessions: src.sessions ?? {}, bookmarks: src.bookmarks ?? {}, bindings: src.bindings ?? {} }, fromRef);
  await libraryStore.replaceAll(lib);
  if (data.layout) await Storage.setItem(LAYOUT_KEY, data.layout);
  else await Storage.removeItem(LAYOUT_KEY);
  if (data.view) await Storage.setItem(VIEW_KEY, data.view);
  settingsStore.set(data.settings ?? {});
  await placementStore.load(shelfBooks(lib));
  await viewStore.load();
}
