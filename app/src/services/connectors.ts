// 아직 키·서버가 없어 연결하지 않은 외부 기능. 화면은 이 상태를 보고 대체 흐름(직접 입력·기본 장정·필사)으로 안내한다.
// 연결할 때는 각 함수만 실제 호출로 바꾸면 된다(화면·저장 구조는 그대로).
import { recognizeText, textRecognitionAvailable, type OcrResult } from '../../modules/text-recognition';

export type Connection = { available: boolean; label: string; reason?: string };

// 페이지 사진 문장 인식(OCR): 기기 안 ML Kit 한국어 모델(modules/text-recognition, Android). 사진을 밖으로 보내지 않는다.
// 모듈이 없는 곳(iOS·이전 빌드)에서는 연결하지 않음으로 두고 가짜 결과를 주지 않는다
export const ocr: Connection & { recognize?: (photoUri: string) => Promise<OcrResult> } = textRecognitionAvailable
  ? { available: true, label: '문장 인식', recognize: recognizeText }
  : { available: false, label: '문장 인식', reason: '이 기기에서는 문장 인식을 쓸 수 없어요. 사진을 보면서 옮겨 적거나 사진으로 남길 수 있어요.' };
