// 앱 창 사진(Android 전용) JS 쪽. 네이티브 모듈이 없는 곳(iOS·Expo Go)에서는 available이 false다.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Native = {
  captureWindow(path: string, x: number, y: number, w: number, h: number, quality: number): Promise<{ width: number; height: number }>;
  hideStartPhoto(): void;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ScreenCapture') : null;

export const screenCaptureAvailable = !!native;

// 켜자마자 네이티브가 띄운 지난 홈 사진(StartPhoto.kt)을 걷는다. 띄운 적 없으면 아무 일도 없다
export function hideStartPhoto() {
  native?.hideStartPhoto();
}

// 창 안 영역(물리 픽셀)을 JPEG로 path에 저장한다
export function captureWindow(path: string, rect: { x: number; y: number; w: number; h: number }, quality = 92) {
  if (!native) return Promise.reject(new Error('screen capture unavailable'));
  return native.captureWindow(path, Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h), quality);
}
