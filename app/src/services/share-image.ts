// 그린 PNG를 기기의 공유창으로 보낸다(책 공유 카드)
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export class ShareImageError extends Error {
  constructor(public stage: 'unavailable' | 'image' | 'share', message: string) {
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

