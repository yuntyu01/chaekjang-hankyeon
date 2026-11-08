// 화면에 그린 뷰를 PNG로 떠서 기기의 공유창을 연다(책 공유 카드). ready가 참이 될 때까지 잠깐 기다린다(3D 책 그림·표지 사진)
import { makeImageFromView } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export class ShareImageError extends Error {
  constructor(public stage: 'unavailable' | 'image' | 'share', message: string) {
    super(message);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function shareViewPng(ref: RefObject<View | null>, opts: { name: string; dialogTitle: string; ready?: () => boolean; waitMs?: number }) {
  if (!(await Sharing.isAvailableAsync())) throw new ShareImageError('unavailable', '이 기기에서 공유 창을 열 수 없어요.');
  for (let t = 0; opts.ready && !opts.ready() && t < (opts.waitMs ?? 6000); t += 100) await wait(100);
  if (opts.ready && !opts.ready()) throw new ShareImageError('image', '책 그림이 아직 준비되지 않았어요. 잠시 뒤 다시 눌러 주세요.');
  let img = null;
  for (let k = 0; k < 3 && !img; k++) {
    await wait(k ? 400 : 150);
    img = await makeImageFromView(ref).catch(() => null);
  }
  if (!img) throw new ShareImageError('image', '카드 이미지를 만들지 못했어요. 다시 눌러 주세요.');
  const uri = `${FS.cacheDirectory}${opts.name}_${Date.now().toString(36)}.png`;
  await FS.writeAsStringAsync(uri, img.encodeToBase64(), { encoding: FS.EncodingType.Base64 });
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: opts.dialogTitle });
  } catch (e) {
    throw new ShareImageError('share', String((e as Error)?.message ?? e));
  }
  return uri;
}
