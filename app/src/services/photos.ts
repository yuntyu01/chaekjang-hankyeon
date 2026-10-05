// 사진 찍기·고르기. 권한을 거절해도 앱은 계속 쓸 수 있게 결과로 알려 준다(화면이 대체 입력을 안내).
import * as ImagePicker from 'expo-image-picker';

export type PhotoResult = { ok: true; uri: string; width?: number; height?: number } | { ok: false; reason: 'denied' | 'canceled' | 'error'; message?: string };

// crop: 찍은 뒤 문장 부분만 자를 수 있게 편집 화면을 연다(사진 갈피)
export async function pickPhoto(from: 'camera' | 'library', choice: { crop?: boolean } = {}): Promise<PhotoResult> {
  try {
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: !!choice.crop };
    const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]) return { ok: false, reason: 'canceled' };
    return { ok: true, uri: r.assets[0].uri, width: r.assets[0].width, height: r.assets[0].height };
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) };
  }
}

export const deniedMessage = (from: 'camera' | 'library') =>
  from === 'camera' ? '카메라 권한이 없어 사진을 찍을 수 없어요. 설정에서 허용하거나, 사진 보관함에서 고르거나, 직접 입력해 주세요.' : '사진 보관함 권한이 없어요. 설정에서 허용하거나 직접 입력해 주세요.';
