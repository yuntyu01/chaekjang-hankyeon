// 앱 창 사진(Android 전용) JS 쪽. 네이티브 모듈이 없는 곳(iOS·Expo Go)에서는 available이 false다.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Native = {
  captureWindow(path: string, x: number, y: number, w: number, h: number, quality: number): Promise<{ width: number; height: number }>;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ScreenCapture') : null;

export const screenCaptureAvailable = !!native;

// 창 안 영역(물리 픽셀)을 JPEG로 path에 저장한다
export function captureWindow(path: string, rect: { x: number; y: number; w: number; h: number }, quality = 92) {
  if (!native) return Promise.reject(new Error('screen capture unavailable'));
  return native.captureWindow(path, Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h), quality);
}
