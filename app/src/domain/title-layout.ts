// 세로 책등 제목 조판. 글자를 바로 세운 채 열로 쌓고, 제한된 크기·열 안에서만 맞춘다.
export type VerticalTitle = { fontSize: number; columns: string[]; pitch: number };

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
  pitch = LINE_PITCH,
): VerticalTitle {
  const words = title.trim().split(/\s+/);
  for (const fontSize of fontSizes) {
    const cap = Math.floor(height / (fontSize * pitch));
    const maxCols = Math.max(1, Math.floor((width * 0.84) / (fontSize * 1.18)));
    const one = units(title) <= cap ? [title] : null;
    if (one) return { fontSize, columns: one, pitch };
    if (maxCols >= 2 && maxColumns >= 2) {
      const cols = pack(words, cap);
      if (cols && cols.length <= Math.min(2, maxCols)) return { fontSize, columns: cols, pitch };
    }
  }
  // 넘치면 최소 글자 크기에서 말줄임
  const fontSize = fontSizes[fontSizes.length - 1];
  const cap = Math.max(1, Math.floor(height / (fontSize * pitch)));
  const chars = [...title.replace(/\s+/g, ' ')];
  let out = '';
  for (const ch of chars) {
    if (units(out + ch) > cap - 1) break;
    out += ch;
  }
  return { fontSize, columns: [out.trimEnd() + '⋯'], pitch };
}

// 세운 책 제목 자리: 제목이 먼저다. 그림 위에 다 들어가지 않으면(8.5DU 이상으로) 그림을 아래로 밀고 줄인다(최대 책 높이의 85%까지).
// 그래도 넘치는 아주 긴 제목은 8DU에서 말줄임(상세보기에는 전체 제목).
// 시안: 제목은 책등 위에서 약 1/5 내려온 곳에서 시작하고, 글자는 책등 폭의 절반 남짓(여백이 넉넉하다)
export function spineTitleLayout(title: string, hDU: number, faceDU: number, artTop0: number) {
  const textTop = hDU < 150 ? 0.14 : 0.18;
  const MAX_ART = 0.85;
  // 짧은 제목은 책등 폭이 허락하는 만큼 크게(최대 13.5DU), 긴 제목만 필요한 만큼 줄인다(최소 9.5DU)
  const base = Math.max(10, Math.min(13.5, Math.round(faceDU * 0.52 * 2) / 2));
  const sizes: number[] = [];
  for (let v = base; v >= 9.5 - 1e-9; v -= 0.5) sizes.push(Math.round(v * 10) / 10);
  // 한 열을 먼저, 큰 글자부터: 그 조건으로 들어가는 가장 높은 그림 위치를 찾는다. 안 되면 두 열까지.
  // 두 열로 나누기 전에 시작 위치를 올려(0.08) 한 열에 넣어 본다(눕히면 한 줄로 읽히는 제목이 두 줄로 갈라지지 않게)
  // 긴 제목은 시작 위치를 올려서라도(0.08) 글자를 크게 둔다(작은 눈금처럼 보이지 않게): 크기가 먼저, 그다음 시작 위치
  for (const cols of [1, 2]) {
    for (const size of sizes) {
      for (const tt of cols === 1 ? [textTop, 0.08] : [textTop]) {
        // 글자를 줄이기 전에 세로 간격부터 좁혀 본다(넉넉한 1.24 → 1.1)
        for (const pitch of [LINE_PITCH, 1.1]) {
          for (let top = artTop0; top <= MAX_ART + 1e-9; top += 0.02) {
            const r = layoutVerticalTitle(title, (top - tt) * hDU - 4, faceDU, [size], cols, pitch);
            if (!r.columns.some((c) => c.endsWith('⋯'))) return { ...r, textTop: tt, artTop: Math.round(top * 100) / 100 };
          }
        }
      }
    }
  }
  return { ...layoutVerticalTitle(title, (MAX_ART - 0.08) * hDU - 4, faceDU, [9], 2, 1.1), textTop: 0.08, artTop: MAX_ART };
}

// 앞표지 제목 조판: 크고 선명하게. 단어를 깨지 않고 1~3줄로 나눠 볼 때 글자가 가장 커지는 나눔을 고른다.
// 폭: 표지 폭의 82% 안(글자 폭 ≈ 글자 크기, 띄어쓰기 0.32), 높이: 제목 칸(표지 높이의 34%) 안, 크기 9~18DU.
export const COVER_LINE_H = 1.32;
export function coverTitleLayout(title: string, wDU: number, hDU: number): { lines: string[]; fontSize: number } {
  const words = title.trim().split(/\s+/);
  const width = (line: string) => [...line].reduce((n, ch) => n + (ch === ' ' ? 0.32 : 1), 0);
  const maxW = wDU * 0.82;
  const maxH = hDU * 0.34;
  const cap = title.replace(/\s/g, '').length <= 4 ? 18 : 16;
  let best: { lines: string[]; fontSize: number } = { lines: [title], fontSize: 9 };
  const splits = (n: number): string[][] => {
    if (n === 1) return [[words.join(' ')]];
    const out: string[][] = [];
    const rec = (start: number, left: number, acc: string[]) => {
      if (left === 1) {
        if (start < words.length) out.push([...acc, words.slice(start).join(' ')]);
        return;
      }
      for (let i = start + 1; i <= words.length - left + 1; i++) rec(i, left - 1, [...acc, words.slice(start, i).join(' ')]);
    };
    rec(0, n, []);
    return out;
  };
  // 한 줄로도 충분히 크면(11.5DU 이상) 나누지 않는다(시안: 짧은 제목은 한 줄)
  const oneLine = Math.min(cap, maxW / width(title), maxH / COVER_LINE_H);
  if (oneLine >= 11.5) return { lines: [title], fontSize: Math.round(oneLine * 10) / 10 };
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    for (const lines of splits(n)) {
      const longest = Math.max(...lines.map(width));
      const fs = Math.min(cap, maxW / longest, maxH / (n * COVER_LINE_H));
      // 같은 크기면 줄 수가 적은 쪽(조금 더 커야 줄을 늘린다)
      if (fs > best.fontSize + (n > best.lines.length ? 0.6 : 0)) best = { lines, fontSize: fs };
    }
  }
  return { lines: best.lines, fontSize: Math.max(9, Math.round(best.fontSize * 10) / 10) };
}
