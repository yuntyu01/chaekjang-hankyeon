// 문장 인식 결과(블록 = 문단 후보, 줄 = 인쇄된 한 줄) → 갈피 문장. 인식한 글자만 쓰고 빈 곳을 지어내지 않는다.
// - 줄 끝 이어 쓰기(산문): 한 블록 안의 인쇄 줄바꿈을 잇는다(띄어쓰기 하나). 영어 단어가 하이픈으로 줄을 넘었으면 하이픈을 빼고 붙인다.
// - 줄바꿈 그대로(시 등): 인쇄된 줄을 그대로 둔다.
// 블록 사이는 빈 줄 하나(문단 구분). 앞뒤 공백은 정리한다.
import type { OcrResult } from '../../modules/text-recognition';

export type LineMode = 'join' | 'keep';

export function ocrText(r: OcrResult, mode: LineMode): string {
  const paras: string[] = [];
  for (const b of r.blocks) {
    const lines = b.lines.map((l) => l.text.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (mode === 'keep') {
      paras.push(lines.join('\n'));
      continue;
    }
    let out = lines[0];
    for (const next of lines.slice(1)) {
      if (/[A-Za-z]-$/.test(out) && /^[A-Za-z]/.test(next)) out = out.slice(0, -1) + next;
      else out = `${out} ${next}`;
    }
    paras.push(out.replace(/\s{2,}/g, ' '));
  }
  return paras.join('\n\n').trim();
}

// 인식 신뢰도가 낮은 줄 수(모델이 신뢰도를 주지 않으면 0으로 와서 세지 않는다)
export function lowConfidenceLines(r: OcrResult, below = 0.5): number {
  let n = 0;
  for (const b of r.blocks) for (const l of b.lines) if (l.confidence > 0 && l.confidence < below) n++;
  return n;
}
