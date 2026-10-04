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
