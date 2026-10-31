import { lowConfidenceLines, ocrText } from '../ocr-text';
import type { OcrResult } from '../../../modules/text-recognition';

const line = (text: string, confidence = 0.9) => ({ text, left: 0, top: 0, right: 0, bottom: 0, confidence });
const r: OcrResult = {
  width: 100,
  height: 100,
  blocks: [
    { text: '', lines: [line('사람은 누구나 자기 안에'), line('작은 정원을 하나씩 가지고'), line('있다.')] },
    { text: '', lines: [line('It was a beauti-'), line('ful morning.', 0.3)] },
  ],
};

describe('문장 인식 결과 → 갈피 문장', () => {
  it('줄 끝 이어 쓰기: 블록 안 줄을 잇고 블록 사이는 문단', () => {
    expect(ocrText(r, 'join')).toBe('사람은 누구나 자기 안에 작은 정원을 하나씩 가지고 있다.\n\nIt was a beautiful morning.');
  });
  it('줄바꿈 그대로(시): 인쇄된 줄 유지', () => {
    expect(ocrText(r, 'keep')).toBe('사람은 누구나 자기 안에\n작은 정원을 하나씩 가지고\n있다.\n\nIt was a beauti-\nful morning.');
  });
  it('빈 결과는 빈 문장(지어내지 않음)', () => {
    expect(ocrText({ width: 1, height: 1, blocks: [] }, 'join')).toBe('');
    expect(ocrText({ width: 1, height: 1, blocks: [{ text: '', lines: [line('  ')] }] }, 'keep')).toBe('');
  });
  it('신뢰도가 낮은 줄 수', () => {
    expect(lowConfidenceLines(r)).toBe(1);
  });
});
