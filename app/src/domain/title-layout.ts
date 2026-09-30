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

// 세운 책 제목 자리(장정 규칙). 시안 책등: 글자는 책등 폭의 약 1/4, 보통 굵기, 글자 사이가 넉넉하다(글자 크기의 약 1.45배),
// 책등 위에서 1/5쯤 내려와 시작한다. 우리 책등은 실제 두께라 시안보다 좁으므로 폭의 40%로 두되 읽을 수 있는 8.5DU 아래로는 줄이지 않는다.
// 길이에 따라: 짧은 제목(3글자 이하)은 더 넉넉한 간격, 긴 제목은 간격 → 시작 위치 → 크기 순으로 줄여 그림 자리를 지킨다.
// 그림 자리(모티프·풍경)를 먼저 지킨다: 제목은 그림 위 남은 칸에서 크기 → 간격 → 시작 위치로 맞추고,
// 그래도 안 되면 그림을 밀되 그림 칸(artBottom까지)의 최소 비율을 남긴다(작은 기호로 줄어들지 않게).
// artBottom: 그림 아래 끝(책 높이 비율), minArt: 남길 그림 칸(짧은 제목·긴 제목 공통 0.3, 그래도 안 되면 0.2까지).
export function spineTitleLayout(title: string, hDU: number, faceDU: number, artTop0: number, artBottom = 0.93) {
  const MIN = 8.5;
  const base = Math.max(MIN, Math.min(11, Math.round(faceDU * 0.4 * 2) / 2));
  const all: number[] = [];
  for (let v = base; v >= MIN - 1e-9; v -= 0.5) all.push(Math.round(v * 10) / 10);
  const short = units(title) <= 3;
  const pitches = short ? [1.5, 1.35, 1.2] : [1.4, 1.25, 1.12];
  const tops = [0.2, 0.12];
  const tryIt = (sizes: number[], maxArt: number) => {
    const hi = Math.max(artTop0, maxArt);
    for (let top = artTop0; top <= hi + 1e-9; top += 0.02) {
      for (const size of sizes)
        for (const pitch of pitches)
          for (const tt of tops) {
            const r = layoutVerticalTitle(title, (top - tt) * hDU - 4, faceDU, [size], 1, pitch);
            if (!r.columns.some((c) => c.endsWith('⋯'))) return { ...r, textTop: tt, artTop: Math.round(top * 100) / 100 };
          }
    }
    return null;
  };
  // ① 거의 제 크기로 그림 칸 0.3을 지키며 ② 최소 크기까지 ③ 그림 칸 0.2까지 ④ 그림을 0.85까지 밀어 한 열 ⑤ 두 열
  const r =
    tryIt(all.slice(0, 2), artBottom - 0.3) ??
    tryIt(all, artBottom - 0.3) ??
    tryIt(all, Math.min(0.85, artBottom - 0.2)) ??
    // 그림을 더 밀어서라도 한 열로(눕혀 읽히는 책은 한 줄이어야 한다)
    tryIt(all, 0.85);
  if (r) return r;
  for (const size of all) {
    const two = layoutVerticalTitle(title, (Math.min(0.85, artBottom - 0.2) - 0.12) * hDU - 4, faceDU, [size], 2, 1.25);
    if (!two.columns.some((c) => c.endsWith('⋯'))) return { ...two, textTop: 0.12, artTop: Math.min(0.85, artBottom - 0.2) };
  }
  return { ...layoutVerticalTitle(title, (0.85 - 0.08) * hDU - 4, faceDU, [MIN], 2, 1.1), textTop: 0.08, artTop: 0.85 };
}

// 앞표지 제목 조판(장정 규칙). 시안: 제목은 표지 폭의 약 8~9%, 보통 굵기, 하늘·빈 곳에 여유 있게 1~2줄.
// 목표 크기에서 한 줄이 표지 폭의 84%를 넘으면 단어를 깨지 않고 가장 고르게 2줄(그래도 넘치면 3줄), 그래도 넘치면 그때만 줄인다.
export const COVER_LINE_H = 1.45;
export function coverTitleLayout(title: string, wDU: number, _hDU: number): { lines: string[]; fontSize: number } {
  const words = title.trim().split(/\s+/);
  const width = (line: string) => [...line].reduce((n, ch) => n + (ch === ' ' ? 0.32 : 1), 0) * 1.06; // 자간 포함
  const maxW = wDU * 0.84;
  const target = Math.max(8, Math.min(11, wDU * 0.088));
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
  let fallback: { lines: string[]; fontSize: number } | null = null;
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    let best: string[] | null = null;
    let bestW = Infinity;
    for (const lines of splits(n)) {
      const w = Math.max(...lines.map(width));
      if (w < bestW) {
        bestW = w;
        best = lines;
      }
    }
    if (!best) continue;
    if (bestW * target <= maxW) return { lines: best, fontSize: Math.round(target * 10) / 10 };
    const fs = maxW / bestW;
    if (!fallback || fs > fallback.fontSize) fallback = { lines: best, fontSize: fs };
  }
  const f = fallback ?? { lines: [title], fontSize: target };
  return { lines: f.lines, fontSize: Math.max(7.5, Math.round(f.fontSize * 10) / 10) };
}
