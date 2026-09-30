// 사진 파일 보관(앱 문서 폴더 images/). 실제 표지 사진·갈피 페이지 사진·장정 그림을 여기에 복사해 둔다.
// 백업에 이 폴더의 파일이 함께 들어간다(store/backup.ts).
import * as FS from 'expo-file-system/legacy';

export const IMAGE_DIR = `${FS.documentDirectory}images/`;

async function ensureDir() {
  const info = await FS.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
}

// 고른 사진(임시 캐시 주소)을 앱 폴더로 복사하고 새 주소를 돌려준다
export async function keepImage(srcUri: string, prefix: string): Promise<string> {
  await ensureDir();
  const ext = (srcUri.split('?')[0].match(/\.(jpe?g|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
  const dest = `${IMAGE_DIR}${prefix}_${Date.now().toString(36)}.${ext}`;
  await FS.copyAsync({ from: srcUri, to: dest });
  return dest;
}

export async function dropImage(uri?: string) {
  if (!uri || !uri.startsWith(IMAGE_DIR)) return;
  await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export const isLocalImage = (uri?: string) => !!uri && uri.startsWith(IMAGE_DIR);
