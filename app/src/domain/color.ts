// 색 계산 도우미. 책 색에서 명암과 글자색을 만든다.
function parse(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

// amount > 0이면 밝게, < 0이면 어둡게
export function shade(hex: string, amount: number) {
  const rgb = parse(hex);
  return toHex(rgb.map((v) => (amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
}

export function luminance(hex: string) {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}


export function contrast(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// 제목 색: 바탕 색에 대해 대비가 더 큰 쪽. 밝은 바탕엔 따뜻한 짙은 갈색 먹(시안 #4A3F3A), 어두운 바탕엔 따뜻한 밝은색.
// 대비비 공식은 중간 밝기의 진한 색(붉은·푸른 책등 등) 위 밝은 글자를 낮게 쳐서, 먹색은 2배 이상 앞설 때만 고른다
// (시안 책장 18권 중 17권이 시안과 같은 색. 연한 쑥색 #A7AF95만 시안은 밝은 글자, 여기선 대비 3.5:1을 지키려 먹색).
// 제목 먹색: 밝은 장정은 짙은 남색 먹(그림자 참고 그림 책등 제목의 가장 진한 획 약 (30~55, 40~60, 47~67)), 어두운 장정은 밝은 크림
// 2026-11-01 사용자 '책 글씨는 될 수 있으면 흰색, 검정은 완전 검정 말고 회색빛 검정': 밝은 글자는 흰색, 먹색은 중립 회색빛 검정.
export const TITLE_DARK = '#3A3B3D';
export const TITLE_LIGHT = '#FFFFFF';
// 예전 자동 글자색(남색 먹·크림, 그림 표지의 갈색 먹): 장정에 저장돼 있어도 지금 규칙으로 다시 고른다
export const LEGACY_TITLE_INKS = ['#2F3944', '#F7EEDC', '#4A3F3A'];
// 그림 위 제목처럼 밝음·어두움을 그림에 맞춰 정해 둔 색은 같은 쪽의 새 색으로만 바꾼다
export const modernInk = (c: string) => (c.toUpperCase() === '#F7EEDC' ? TITLE_LIGHT : LEGACY_TITLE_INKS.includes(c.toUpperCase()) ? TITLE_DARK : c);
// 2026-11-01 사용자가 다시 '될 수 있으면 흰색'(10-31 3:1 기준은 중간 톤 책까지 먹색이었다): 밝은 글자 대비가 2.7:1 이상이면 흰색.
// 시안의 문장 수집(#CE886F 2.85)·여행의 이유(#819AB1 2.92)는 시안처럼 흰 글자. 10-31에 흐리다고 한 연한 올리브(#9FA568 2.61)와 파스텔은 회색빛 검정.
export const TITLE_MIN_CONTRAST = 2.7;
export function titleInk(bg: string) {
  const dark = contrast(TITLE_DARK, bg);
  const light = contrast(TITLE_LIGHT, bg);
  if (light < TITLE_MIN_CONTRAST) return dark > light ? TITLE_DARK : TITLE_LIGHT;
  return dark >= light * 2 ? TITLE_DARK : TITLE_LIGHT;
}

// 책에 그릴 제목 색: 자동으로 고른 색(예전 값·지금 두 색)이 저장돼 있으면 지금 규칙으로 다시 고른다. 사용자가 글자색을 고르는 기능이 없어 그 밖의 값은 시안 지정 색뿐이다
export function displayInk(stored: string | undefined, face: string) {
  const auto = !stored || LEGACY_TITLE_INKS.includes(stored.toUpperCase()) || stored.toUpperCase() === TITLE_DARK || stored.toUpperCase() === TITLE_LIGHT;
  return auto ? titleInk(face) : stored;
}

export function rgbHex(r: number, g: number, b: number) {
  return toHex([r, g, b]);
}

// ---------- HSL ----------
function toHsl([r, g, b]: number[]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]: number[]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
// ---------- 갈피 색: 책장 갈피 탭·갈피 카드 뒤 종이·테이프가 같은 색 하나에서 나온다(2026-11-05 사용자 '책등색처럼 많은 비율 색상으로', '책장 갈피도 마찬가지로') ----------
// 색 하나 = 표지에서 흰색·검정·회색을 뺀 가장 넓은 색(rebinding accentColorOf). 표지 19권 중 14권은 가장 넓은 색이 무채색이라 그대로 쓰면 흰 종이에 묻히거나 검은 갈피가 된다.
// 고를 색이 없는 표지는 차분한 세 색 중 책마다 하나. 같은 색상(hue)에서 밝기·채도만 옮긴다(벽에 묻히거나 형광처럼 튀지 않게)
const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hsl = (h: number, s: number, l: number) => toHex(fromHsl([h, Math.min(1, s), clampTo(l, 0, 0.93)]));
const ACCENT_FALLBACK = ['#C9A27E', '#8FA695', '#9A97BD'];
export function isNeutralColor(hex: string) {
  const [, s, l] = toHsl(parse(hex));
  return l > 0.86 || l < 0.14 || s < 0.14;
}
function accentHsl(accent: string | undefined, key: string) {
  let k = 0;
  for (let i = 0; i < key.length; i++) k = (Math.imul(k, 31) + key.charCodeAt(i)) >>> 0;
  return toHsl(parse(accent && /^#[\da-f]{6}$/i.test(accent) ? accent : ACCENT_FALLBACK[k % ACCENT_FALLBACK.length]));
}
// 책장 갈피 탭: 첫째 = 길쭉한 장, 둘째 = 짧은 장(더 밝게)
export function tabColors(accent: string | undefined, key: string): [string, string] {
  const [h, s, l] = accentHsl(accent, key);
  const sat = clampTo(s, 0.28, 0.62);
  const base = clampTo(l, 0.42, 0.72);
  return [hsl(h, sat, base), hsl(h, sat, base + 0.12)];
}
// 갈피 카드: 뒤 종이와 테이프(앞 종이는 흰색이라 옅어도 갈린다)
export function paperColors(accent: string | undefined, key: string) {
  const [h, s] = accentHsl(accent, key);
  const sat = clampTo(s, 0.28, 0.55);
  return { paper: hsl(h, sat, 0.86), tape: hsl(h, sat, 0.8) };
}
