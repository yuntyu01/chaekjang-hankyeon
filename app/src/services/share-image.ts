// 그린 PNG를 기기의 공유창으로 보내거나 사진첩에 저장한다(책 공유 카드·갈피 공유)
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { gallerySaveAvailable, saveImageToGallery } from '../../modules/screen-capture';

export { gallerySaveAvailable };

export class ShareImageError extends Error {
  constructor(public stage: 'unavailable' | 'image' | 'share' | 'save', message: string) {
    super(message);
  }
}

// 이미 그린 PNG(base64)를 파일로 두고 공유창을 연다(책 공유 카드: 화면 뷰를 뜨지 않고 같은 그림을 정해진 폭으로 그려 넘긴다)
export async function sharePngBase64(base64: string, opts: { name: string; dialogTitle: string }) {
  if (!(await Sharing.isAvailableAsync())) throw new ShareImageError('unavailable', '이 기기에서 공유 창을 열 수 없어요.');
  const uri = `${FS.cacheDirectory}${opts.name}_${Date.now().toString(36)}.png`;
  await FS.writeAsStringAsync(uri, base64, { encoding: FS.EncodingType.Base64 });
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: opts.dialogTitle });
  } catch (e) {
    throw new ShareImageError('share', String((e as Error)?.message ?? e));
  }
  return uri;
}


// 이미 그린 PNG(base64)를 사진첩 Pictures/책장한켠에 저장한다(Android 10+). 임시 파일은 저장 뒤 지운다
export async function savePngBase64(base64: string, opts: { name: string }) {
  if (!gallerySaveAvailable) throw new ShareImageError('unavailable', '이 기기에서는 사진첩에 바로 저장할 수 없어요. 공유를 눌러 저장해 주세요.');
  const stamp = Date.now().toString(36);
  const uri = `${FS.cacheDirectory}${opts.name}_${stamp}.png`;
  await FS.writeAsStringAsync(uri, base64, { encoding: FS.EncodingType.Base64 });
  try {
    return await saveImageToGallery(uri, `${opts.name}_${stamp}.png`);
  } catch (e) {
    throw new ShareImageError('save', String((e as Error)?.message ?? e));
  } finally {
    FS.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}

// 공유·저장 실패 안내 제목
export function shareErrorTitle(e: unknown) {
  const stage = (e as ShareImageError)?.stage;
  return stage === 'share' ? '공유 창을 열지 못했어요' : stage === 'save' ? '사진첩에 저장하지 못했어요' : stage === 'unavailable' ? '할 수 없어요' : '이미지를 만들지 못했어요';
}
