// 아직 키·서버가 없어 연결하지 않은 외부 기능. 화면은 이 상태를 보고 대체 흐름(직접 입력·기본 장정·필사)으로 안내한다.
// 연결할 때는 각 함수만 실제 호출로 바꾸면 된다(화면·저장 구조는 그대로).
import type { MotifId } from '@/domain/types';

export type Connection = { available: boolean; label: string; reason?: string };

// AI 재장정: 평평한 표지·책등 그림과 질감만 만든다(제목 조판·몸체·회전·명암·그림자는 앱 코드가 그린다)
export const aiBinding: Connection & {
  generate?: (input: { title: string; author?: string; referencePhoto?: string; spineColor: string; motif: MotifId | 'none' }) => Promise<{ coverArtUri: string; spineArtUri: string }>;
} = { available: false, label: 'AI 재장정', reason: 'AI 서버가 아직 연결되지 않았어요. 기본 장정으로 추가하고 나중에 바꿀 수 있어요.' };

// 사진으로 책 찾기(표지·바코드 인식)
export const photoIdentify: Connection & { identify?: (photoUri: string) => Promise<{ query: string } | null> } = {
  available: false,
  label: '사진으로 책 찾기',
  reason: '사진 인식이 아직 연결되지 않았어요. 사진은 실제 표지로 쓰고, 제목은 직접 입력해 주세요.',
};

// 페이지 사진 문장 인식(OCR)
export const ocr: Connection & { recognize?: (photoUri: string) => Promise<string[]> } = {
  available: false,
  label: '문장 인식',
  reason: '문장 인식이 아직 연결되지 않았어요. 사진을 보면서 문장을 옮겨 적을 수 있어요.',
};
