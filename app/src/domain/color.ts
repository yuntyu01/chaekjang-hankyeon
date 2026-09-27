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

// 밝은 책엔 먹색, 어두운 책엔 크림색 글자
export function inkFor(hex: string) {
  return luminance(hex) > 0.36 ? '#2A2A2C' : '#F6EEDD';
}
