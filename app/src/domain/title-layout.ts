// 세로 책등 제목 조판. 글자를 바로 세운 채 열로 쌓고, 제한된 크기·열 안에서만 맞춘다.
export type VerticalTitle = { fontSize: number; columns: string[]; pitch: number };

// 세로 조판의 띄어쓰기(글자 크기 배수). 맞추기(여기)와 그리기(art.tsx)가 같은 값을 쓴다.
// 시안 책등: 단어 사이가 글자 높이의 약 0.4~0.65배 더 벌어진다(글자 크기의 약 0.4배).
export const SPINE_SPACE = 0.4;
const SPACE_UNIT = SPINE_SPACE;
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

// 세운 책 제목 자리(장정 규칙). 시안 책장 책등 11권을 잰 값: 글자 크기는 책등 폭의 약 0.34배, 보통 굵기, 글자 간격(칸)은
// 글자 크기의 약 1.1배(잉크 높이의 1.2~1.3배), 첫 글자 잉크 위 끝은 책 높이의 약 0.23(긴 제목은 0.17~0.2)에서 시작한다.
// 우리 책등은 실제 두께라 시안보다 좁으므로 폭의 40%로 두되 읽을 수 있는 8.5DU 아래로는 줄이지 않는다.
// 길이에 따라: 짧은 제목(3글자 이하)은 조금 더 넉넉한 간격, 긴 제목은 간격 → 시작 위치 → 크기 순으로 줄여 그림 자리를 지킨다.
// 그림 자리(모티프·풍경)를 먼저 지킨다: 제목은 그림 위 남은 칸에서 크기 → 간격 → 시작 위치로 맞추고,
// 그래도 안 되면 그림을 밀되 그림 칸(artBottom까지)의 최소 비율을 남긴다(작은 기호로 줄어들지 않게).
// artBottom: 그림 아래 끝(책 높이 비율), minArt: 남길 그림 칸(짧은 제목·긴 제목 공통 0.3, 그래도 안 되면 0.2까지).
export function spineTitleLayout(title: string, hDU: number, faceDU: number, artTop0: number, artBottom = 0.93) {
  const MIN = 8.5;
  // 글자 크기: 책등 폭의 0.4, 8.5~11DU. 우리 책등은 실제 두께라 시안보다 좁아 폭 비율(시안 약 0.30)보다
  // 책 높이 비율(시안 잉크 높이 ≈ 책 높이의 0.064)을 맞춘다(0.37로 줄이면 시안보다 눈에 띄게 작았다)
  const base = Math.max(MIN, Math.min(11, Math.round(faceDU * 0.4 * 2) / 2));
  const all: number[] = [];
  for (let v = base; v >= MIN - 1e-9; v -= 0.5) all.push(Math.round(v * 10) / 10);
  const short = units(title) <= 3;
  const pitches = short ? [1.16, 1.1, 1.04] : [1.1, 1.05, 1.0];
  const tops = [0.215, 0.17, 0.12];
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
    const two = layoutVerticalTitle(title, (Math.min(0.85, artBottom - 0.2) - 0.12) * hDU - 4, faceDU, [size], 2, 1.05);
    if (!two.columns.some((c) => c.endsWith('⋯'))) return { ...two, textTop: 0.12, artTop: Math.min(0.85, artBottom - 0.2) };
  }
  return { ...layoutVerticalTitle(title, (0.85 - 0.08) * hDU - 4, faceDU, [MIN], 2, 1.0), textTop: 0.08, artTop: 0.85 };
}

// 책등 제목 조판을 바꾸는 눕힘 정도(|roll|, 도): 세로 조판(세운 책등)은 from~mid에서 옅어져 사라지고, 가로 조판(눕힌 책등)은
// mid~to에서 나타난다. 몸체는 경로대로 계속 돌고(면 변환), 글자는 각 조판 그대로 책등 면에 붙어 있다(몸체 회전과 조판 변경은 따로).
// 두 조판이 겹쳐 제목이 두 번 보이는 때가 없게 차례로 바꾼다. mid 45°는 자세 판정(눕힘/세움)의 경계와 같다.
export const TITLE_SWAP = { from: 36, mid: 45, to: 54 };
function smoothstep(a: number, b: number, v: number) {
  'worklet';
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function titleOpacity(roll: number) {
  'worklet';
  const r = Math.abs(roll);
  return { v: 1 - smoothstep(TITLE_SWAP.from, TITLE_SWAP.mid, r), h: smoothstep(TITLE_SWAP.mid, TITLE_SWAP.to, r) };
}

// 눕힌 책등 제목 조판(가로 한 줄). 세운 책등의 세로 조판과 따로 정하고, 몸체 회전과 상관없이 자세(눕힘)에 따라 바꿔 보인다.
// 시안 책장 더미(좋은 문장은 이렇게 온다·찰나의 마음): 머리 쪽 끝에서 길이의 약 13~15%부터 한 줄, 글자는 책등 두께의 약 0.32~0.35,
// 두께 방향 가운데(3뷰 눕힘은 0.42로 더 크다). 크기는 두께의 0.38, 11DU까지(시안 두 권 모두 잉크 약 10DU). 길이: 글자 1, 띄어쓰기 0.32, 자간 2%.
// 넘치면 크기를 줄이고(7.5DU까지), 그래도 넘치면 말줄임.
export const LYING_START = 0.14;
const LYING_END = 0.08;
export const LYING_TRACK = 0.02;
const lineUnits = (s: string) => [...s].reduce((n, ch) => n + (ch === ' ' ? 0.32 : 1), 0) * (1 + LYING_TRACK);
export type LyingTitle = { fontSize: number; text: string; start: number };
export function lyingTitleLayout(title: string, hDU: number, tDU: number): LyingTitle {
  const text0 = title.trim().replace(/\s+/g, ' ');
  const room = hDU * (1 - LYING_START - LYING_END);
  const target = Math.max(7.5, Math.min(11, tDU * 0.38));
  const fit = room / Math.max(1, lineUnits(text0));
  if (fit >= target) return { fontSize: Math.round(target * 10) / 10, text: text0, start: LYING_START };
  if (fit >= 7.5) return { fontSize: Math.floor(fit * 10) / 10, text: text0, start: LYING_START };
  // 가장 작은 크기에서도 넘치면 들어가는 만큼만 남기고 말줄임
  const cap = room / 7.5;
  let out = '';
  for (const ch of [...text0]) {
    if (lineUnits(out + ch + '⋯') > cap) break;
    out += ch;
  }
  return { fontSize: 7.5, text: `${out.trimEnd()}⋯`, start: LYING_START };
}

// 앞표지 제목 조판(장정 규칙). 시안 표지 세 권을 잰 값(표지 폭 W 비율):
// - 짧은 제목(느린 계절·여름의 숲): 한 줄, 잉크 높이 약 0.107~0.12W(글자 크기 약 0.135W, 14DU까지), 줄 길이 약 0.45~0.5W
// - 긴 제목(우리가 빛의 속도로 갈 수 없다면): 단어를 깨지 않고 고르게 두 줄, 글자 크기 약 0.09W, 긴 줄 길이 약 0.65W, 줄 간격 약 1.46
// 규칙: 줄 수마다 한 줄이 차지할 수 있는 폭(한 줄 0.56W, 여러 줄 0.72W)과 글자 크기 상한으로
// 크기를 정하고(한 줄 상한 0.135W, 여러 줄 0.1W, 둘 다 14DU), 줄을 늘려 글자가 15% 넘게 커질 때만 줄을 늘린다. 제목 칸 높이는 표지 높이의 30% 안. 읽기 하한 7.5DU.
// 자간 0, 띄어쓰기 0.33(단어 사이가 시안처럼 또렷하게). 글자 폭은 한글 한 글자 0.91(글꼴 값)로 셈한다.
export const COVER_LINE_H = 1.46;
export const COVER_TRACK = 0;
export const COVER_SPACE = 0.33;
const COVER_ADV = 0.91;
export function coverTitleLayout(title: string, wDU: number, hDU: number): { lines: string[]; fontSize: number } {
  const words = title.trim().split(/\s+/);
  const width = (line: string) => [...line].reduce((n, ch) => n + (ch === ' ' ? COVER_SPACE : COVER_ADV + COVER_TRACK), 0);
  const sizeFor = (n: number, w: number) =>
    Math.min((n === 1 ? 0.135 : 0.1) * wDU, 14, ((n === 1 ? 0.56 : 0.72) * wDU) / w, (0.3 * hDU) / (n * COVER_LINE_H));
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
  let pick: { lines: string[]; fontSize: number } | null = null;
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
    const fs = sizeFor(n, bestW);
    if (!pick || fs > pick.fontSize * 1.15) pick = { lines: best, fontSize: fs };
  }
  const f = pick ?? { lines: [title], fontSize: 7.5 };
  const desired = Math.max(7.5, Math.round(f.fontSize * 10) / 10);
  // Extremely long titles must still fit inside the cover. The normal reading
  // minimum cannot override the available print area; the UI shows the full title.
  const fit = Math.min((wDU * 0.86) / Math.max(1, ...f.lines.map(width)), (hDU * 0.3) / (f.lines.length * COVER_LINE_H));
  return { lines: f.lines, fontSize: desired <= fit ? desired : Math.floor(fit * 10) / 10 };
}
