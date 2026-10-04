import { SAMPLE_BOOKS as books, SAMPLE_LAYOUT } from '../onboarding-sample';
import { mm } from '../geometry';

// These regression scenarios name precise drop coordinates. Freeze their original
// physical fixtures so jacket art-direction changes do not change what is hit.
// Current production dimensions and capacity are verified separately in units.test.
export const SAMPLE_BOOKS = books.map((b) => ({
  ...b,
  dims: {
    height: mm(b.physical!.heightMm),
    coverWidth: mm(b.physical!.widthMm),
    thickness: 22 + Math.max(0, b.physical!.pages * 0.06 + 1.5 - 10) * (366 / 480),
  },
}));
export { SAMPLE_LAYOUT };
