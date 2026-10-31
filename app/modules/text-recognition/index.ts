// 기기 안 문장 인식(Android, ML Kit 한국어 모델) JS 쪽. 네이티브 모듈이 없는 곳(iOS·Expo Go·이전 빌드)에서는 available이 false다.
// 지원하지 않는 곳에서 가짜 결과를 돌려주지 않는다.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type OcrLine = { text: string; left: number; top: number; right: number; bottom: number; confidence: number };
export type OcrBlock = { text: string; lines: OcrLine[] };
export type OcrResult = { width: number; height: number; blocks: OcrBlock[] };

type Native = { recognize(uri: string): Promise<OcrResult> };

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('TextRecognition') : null;

export const textRecognitionAvailable = !!native;

export function recognizeText(uri: string): Promise<OcrResult> {
  if (!native) return Promise.reject(new Error('text recognition unavailable'));
  return native.recognize(uri);
}
