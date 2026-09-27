// 세로 책등 제목 조판. 글자를 바로 세운 채 열로 쌓고, 제한된 크기·열 안에서만 맞춘다.
export type VerticalTitle = { fontSize: number; columns: string[] };

const SPACE_UNIT = 0.45;
const units = (s: string) => [...s].reduce((n, ch) => n + (ch === ' ' ? SPACE_UNIT : 1), 0);

function pack(words: string[], cap: number): string[] | null {
  const cols: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (units(next) <= cap) {
      cur = next;
      continue;
    }
    if (cur) cols.push(cur);
    if (units(w) > cap) return null;
    cur = w;
  }
  if (cur) cols.push(cur);
  return cols;
}

// height: 글자 영역 높이, width: 책등 폭. fontSizes는 큰 것부터 시도(최소값 아래로 줄이지 않음).
export function layoutVerticalTitle(
  title: string,
  height: number,
  width: number,
  fontSizes: number[],
): VerticalTitle {
  const words = title.trim().split(/\s+/);
  for (const fontSize of fontSizes) {
    const cap = Math.floor(height / (fontSize * 1.12));
    const maxCols = Math.max(1, Math.floor((width * 0.84) / (fontSize * 1.18)));
    const one = units(title) <= cap ? [title] : null;
    if (one) return { fontSize, columns: one };
    if (maxCols >= 2) {
      const cols = pack(words, cap);
      if (cols && cols.length <= Math.min(2, maxCols)) return { fontSize, columns: cols };
    }
  }
  // 넘치면 최소 글자 크기에서 말줄임
  const fontSize = fontSizes[fontSizes.length - 1];
  const cap = Math.max(1, Math.floor(height / (fontSize * 1.12)));
  const chars = [...title.replace(/\s+/g, ' ')];
  let out = '';
  for (const ch of chars) {
    if (units(out + ch) > cap - 1) break;
    out += ch;
  }
  return { fontSize, columns: [out.trimEnd() + '⋯'] };
}
