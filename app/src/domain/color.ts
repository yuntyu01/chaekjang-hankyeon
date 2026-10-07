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
export const TITLE_DARK = '#4A403A';
export const TITLE_LIGHT = '#F7EEDC';
export function titleInk(bg: string) {
  return contrast(TITLE_DARK, bg) >= contrast(TITLE_LIGHT, bg) * 2 ? TITLE_DARK : TITLE_LIGHT;
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
// ---------- 갈피(종이 탭) 색: 책 색 계열(2026-10-07 사용자 참고 사진) ----------
// 짙은·중간 색 책은 같은 색을 종이처럼 밝힌 두 장(한 장은 조금, 한 장은 더), 밝고 진한 색 책(살구 등)은 같은 색을 조금 짙게,
// 거의 흰 책(크림)은 정해 둔 갈피 색(accent)이나 따뜻한 귤색. 첫째 색 = 길쭉한 장, 둘째 = 짧은 장
// 흰색을 섞지 않고 같은 색상(hue)에서 밝기만 옮긴다(흰색을 섞으면 탁해진다): 첫째는 책 색에 가깝게 조금 더 선명하게, 둘째는 밝게
const hsl = (h: number, s: number, l: number) => toHex(fromHsl([h, Math.min(1, s), Math.max(0, Math.min(0.93, l))]));
export function tabColors(tone: string, accent?: string): [string, string] {
  const [h, s, l] = toHsl(parse(tone));
  if (l > 0.84 && s < 0.6) {
    const [ah, as, al] = toHsl(parse(accent ?? '#E7AE72'));
    return [hsl(ah, as, al), hsl(ah, as * 0.95, al + 0.12)];
  }
  if (l > 0.7) return [hsl(h, s * 1.1, l - 0.1), hsl(h, s, l - 0.03)];
  return [hsl(h, s * 1.15, l + 0.07), hsl(h, s * 1.1, l + 0.22)];
}
