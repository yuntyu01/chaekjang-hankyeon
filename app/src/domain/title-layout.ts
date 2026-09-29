// 세로 책등 제목 조판. 글자를 바로 세운 채 열로 쌓고, 제한된 크기·열 안에서만 맞춘다.
export type VerticalTitle = { fontSize: number; columns: string[] };

const SPACE_UNIT = 0.45;
// 세로 글자 간격(글자 크기 배수). 시안 책등은 글자 사이가 넉넉하다(약 1.25)
export const LINE_PITCH = 1.24;
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
  maxColumns = 2,
): VerticalTitle {
  const words = title.trim().split(/\s+/);
  for (const fontSize of fontSizes) {
    const cap = Math.floor(height / (fontSize * LINE_PITCH));
    const maxCols = Math.max(1, Math.floor((width * 0.84) / (fontSize * 1.18)));
    const one = units(title) <= cap ? [title] : null;
    if (one) return { fontSize, columns: one };
    if (maxCols >= 2 && maxColumns >= 2) {
      const cols = pack(words, cap);
      if (cols && cols.length <= Math.min(2, maxCols)) return { fontSize, columns: cols };
    }
  }
  // 넘치면 최소 글자 크기에서 말줄임
  const fontSize = fontSizes[fontSizes.length - 1];
  const cap = Math.max(1, Math.floor(height / (fontSize * LINE_PITCH)));
  const chars = [...title.replace(/\s+/g, ' ')];
  let out = '';
  for (const ch of chars) {
    if (units(out + ch) > cap - 1) break;
    out += ch;
  }
  return { fontSize, columns: [out.trimEnd() + '⋯'] };
}

// 세운 책 제목 자리: 제목이 먼저다. 그림 위에 다 들어가지 않으면(8.5DU 이상으로) 그림을 아래로 밀고 줄인다(최대 책 높이의 85%까지).
// 그래도 넘치는 아주 긴 제목은 8DU에서 말줄임(상세보기에는 전체 제목).
// 시안: 제목은 책등 위에서 약 1/5 내려온 곳에서 시작하고, 글자는 책등 폭의 절반 남짓(여백이 넉넉하다)
export function spineTitleLayout(title: string, hDU: number, faceDU: number, artTop0: number) {
  const textTop = hDU < 150 ? 0.14 : 0.18;
  const MAX_ART = 0.85;
  const base = faceDU < 26 ? 9.5 : 10.5;
  const sizes = [...new Set([base, base - 1, Math.max(8.5, base - 2), 8.5])];
  // 한 열을 먼저, 큰 글자부터: 그 조건으로 들어가는 가장 높은 그림 위치를 찾는다. 안 되면 두 열까지.
  // 두 열로 나누기 전에 시작 위치를 올려(0.08) 한 열에 넣어 본다(눕히면 한 줄로 읽히는 제목이 두 줄로 갈라지지 않게)
  for (const cols of [1, 2]) {
    for (const tt of cols === 1 ? [textTop, 0.08] : [textTop]) {
      for (const size of sizes) {
        for (let top = artTop0; top <= MAX_ART + 1e-9; top += 0.02) {
          const r = layoutVerticalTitle(title, (top - tt) * hDU - 4, faceDU, [size], cols);
          if (!r.columns.some((c) => c.endsWith('⋯'))) return { ...r, textTop: tt, artTop: Math.round(top * 100) / 100 };
        }
      }
    }
  }
  return { ...layoutVerticalTitle(title, (MAX_ART - textTop) * hDU - 4, faceDU, [8]), textTop, artTop: MAX_ART };
}
