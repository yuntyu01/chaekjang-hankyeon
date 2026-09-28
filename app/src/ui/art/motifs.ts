// 개발용 샘플 모티프(SVG 문자열, viewBox 0 0 24 60). 그림 재료가 없는 책(등록 도서)의 책등·표지에 쓰는 작은 그림.
// Skia가 SVG로 그린다(Skia.SVG.MakeFromString → ImageSVG).
import { devMotifFor } from '@/domain/motif-slots';
import type { MotifId } from '@/domain/types';

const leafPair = (y: number, s: number, c: string) =>
  `<path d="M12 ${y} Q${12 - 7 * s} ${y - 3 * s} ${12 - 8 * s} ${y - 9 * s} Q${12 - 2 * s} ${y - 7 * s} 12 ${y} Z" fill="${c}"/>` +
  `<path d="M12 ${y - 3 * s} Q${12 + 7 * s} ${y - 6 * s} ${12 + 8 * s} ${y - 12 * s} Q${12 + 2 * s} ${y - 10 * s} 12 ${y - 3 * s} Z" fill="${c}"/>`;

function draw(motif: MotifId, c: string): string {
  switch (motif) {
    case 'sprig':
      return `<path d="M12 60 Q11 36 13 8" stroke="${c}" stroke-width="1" fill="none"/>${[54, 44, 34, 24].map((y, i) => leafPair(y, 1 - i * 0.14, c)).join('')}<circle cx="13" cy="7" r="1.6" fill="${c}"/>`;
    case 'leaf':
      return (
        `<path d="M12 60 Q13 34 11 10" stroke="${c}" stroke-width="1" fill="none"/>` +
        [52, 40, 28, 16]
          .map(
            (y) =>
              `<path d="M12 ${y} Q3 ${y - 6} 4 ${y - 14} Q9 ${y - 8} 12 ${y} Z" fill="${c}" opacity="0.95"/>` +
              `<path d="M12 ${y - 5} Q21 ${y - 11} 20 ${y - 19} Q15 ${y - 13} 12 ${y - 5} Z" fill="${c}" opacity="0.85"/>`,
          )
          .join('')
      );
    case 'cotton':
      return (
        `<path d="M12 60 Q12 40 10 26 M11 40 Q16 32 18 22 M10 30 Q6 20 7 12" stroke="${c}" stroke-width="1" fill="none"/>` +
        [
          [18, 20],
          [7, 11],
          [12, 34],
          [10, 24],
        ]
          .map(
            ([x, y]) =>
              `<circle cx="${x}" cy="${y}" r="3.6" fill="#FFFFFF"/><circle cx="${x - 1.8}" cy="${y + 1}" r="2.6" fill="#F7F3EA"/>` +
              `<circle cx="${x + 1.8}" cy="${y + 1}" r="2.6" fill="#FBF8F2"/><path d="M${x - 3} ${y + 3} l3 -1.4 l3 1.4" stroke="${c}" stroke-width="0.8" fill="none"/>`,
          )
          .join('')
      );
    case 'moon':
      return `<path d="M15 18 a10 10 0 1 0 5 16 a8 8 0 1 1 -5 -16 Z" fill="${c}"/>`;
    case 'star':
      return (
        `<path d="M12 18 L13.6 26.4 L22 28 L13.6 29.6 L12 38 L10.4 29.6 L2 28 L10.4 26.4 Z" fill="${c}"/>` +
        `<path d="M19 10 L19.6 12.4 L22 13 L19.6 13.6 L19 16 L18.4 13.6 L16 13 L18.4 12.4 Z" fill="${c}" opacity="0.8"/><circle cx="6" cy="44" r="0.9" fill="${c}"/>`
      );
    case 'wave':
      return [22, 30, 38]
        .map((y, i) => `<path d="M2 ${y} q5 -5 10 0 t10 0" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="${1 - i * 0.2}"/>`)
        .join('');
    case 'flower':
      return (
        `<path d="M12 60 Q12 40 12 18 M12 40 Q17 34 19 28 M12 32 Q7 28 5 22" stroke="${c}" stroke-width="1" fill="none"/>` +
        [
          [12, 16],
          [19, 26],
          [5, 20],
        ]
          .map(
            ([x, y]) =>
              `<path d="M${x} ${y - 4} Q${x + 4} ${y - 3} ${x + 3} ${y + 2} L${x + 1} ${y + 1} L${x} ${y + 3} L${x - 1} ${y + 1} L${x - 3} ${y + 2} Q${x - 4} ${y - 3} ${x} ${y - 4} Z" fill="#FFFDF7" stroke="${c}" stroke-width="0.5"/>`,
          )
          .join('') +
        leafPair(52, 0.8, c)
      );
    case 'pine':
      return `<path d="M12 14 L4 34 L9 34 L3 48 L21 48 L15 34 L20 34 Z M11 48 h2 v6 h-2 Z" fill="${c}"/>`;
    case 'bud':
      return (
        `<path d="M12 60 Q12 38 12 16 M12 44 Q16 38 18 32 M12 36 Q8 30 6 26" stroke="${c}" stroke-width="1" fill="none"/>` +
        [
          [12, 14],
          [18, 30],
          [6, 24],
        ]
          .map(([x, y]) => `<path d="M${x} ${y - 4} Q${x + 3} ${y} ${x} ${y + 3} Q${x - 3} ${y} ${x} ${y - 4} Z" fill="${c}"/>`)
          .join('') +
        leafPair(54, 0.7, c)
      );
  }
  return '';
}

// 폭 24, 높이 60 기준 SVG 문서
export function motifSvg(motif: string, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 60" width="24" height="60">${draw(devMotifFor(motif), color)}</svg>`;
}
