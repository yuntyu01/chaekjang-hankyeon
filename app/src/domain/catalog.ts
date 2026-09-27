// 서버 books(전 사용자 공유) + user_books(개인) → 홈 Book 매핑.
import { defaultMotifFor, isMotifSlot, type MotifSlotId } from './motif-slots';
import type { Book, HeightClass, ThicknessClass } from './types';

export type BookStatus = 'reading' | 'read' | 'want';

export type CatalogBook = {
  isbn13: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedAt?: string;
  pageCount?: number;
  format?: string; // 판형(예: "128*188mm")
  coverUrl?: string;
  coverThumbUrl?: string;
  description?: string;
  themeColor: string;
  heightClass: HeightClass;
  thicknessClass: ThicknessClass;
  defaultMotifId?: string;
};

export type UserBook = {
  isbn13: string;
  status: BookStatus;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
  songTitle?: string;
  songUrl?: string;
  customThemeColor?: string;
  customMotifId?: string;
  coverDisplay: boolean;
  createdAt: string;
  updatedAt: string;
};

// 두께 등급: 쪽수 기준. 모르면 medium.
export function thicknessFromPages(pages?: number): ThicknessClass {
  if (!pages || pages <= 0) return 'medium';
  if (pages < 220) return 'thin';
  if (pages < 420) return 'medium';
  return 'thick';
}

// 높이 등급: 판형 문자열의 세로(mm). "128*188mm", "152x225", "A5" 등.
export function heightFromFormat(format?: string): HeightClass {
  if (!format) return 'medium';
  const named: Record<string, number> = { A6: 148, B6: 182, A5: 210, B5: 257, A4: 297 };
  const key = format.toUpperCase().match(/\b(A[4-6]|B[5-6])\b/)?.[1];
  const nums = format.match(/(\d{2,3})\s*[*x×X]\s*(\d{2,3})/);
  const h = nums ? Math.max(Number(nums[1]), Number(nums[2])) : key ? named[key] : 0;
  if (!h) return 'medium';
  if (h < 195) return 'short';
  if (h < 230) return 'medium';
  return 'tall';
}

// 판형 문자열 → 가로·세로(mm). "128*188mm", "152x225", "A5" 등. 모르면 null.
export function formatMm(format?: string): { widthMm: number; heightMm: number } | null {
  if (!format) return null;
  const named: Record<string, [number, number]> = { A6: [105, 148], B6: [128, 182], A5: [148, 210], B5: [182, 257], A4: [210, 297] };
  const nums = format.match(/(\d{2,3})\s*[*x×X]\s*(\d{2,3})/);
  if (nums) {
    const a = Number(nums[1]);
    const b = Number(nums[2]);
    return { widthMm: Math.min(a, b), heightMm: Math.max(a, b) };
  }
  const key = format.toUpperCase().match(/\b(A[4-6]|B[5-6])\b/)?.[1];
  return key ? { widthMm: named[key][0], heightMm: named[key][1] } : null;
}

export function motifOf(c: CatalogBook, u?: UserBook): MotifSlotId {
  const pick = u?.customMotifId ?? c.defaultMotifId;
  return pick && isMotifSlot(pick) ? pick : defaultMotifFor(c.isbn13);
}

export function toShelfBook(c: CatalogBook, u?: UserBook): Book {
  const size = formatMm(c.format);
  return {
    id: c.isbn13,
    title: c.title,
    author: c.authors.join(', ') || undefined,
    originalCoverUri: c.coverUrl,
    themeColor: u?.customThemeColor ?? c.themeColor,
    heightClass: c.heightClass,
    thicknessClass: c.thicknessClass,
    coverAspectRatio: size ? size.widthMm / size.heightMm : 0.68,
    // 판형과 쪽수를 알면 실제 크기로(모르면 등급으로)
    physical: size && c.pageCount ? { ...size, pages: c.pageCount } : undefined,
    // coverArtUri/spineArtUri는 모티프 PNG가 생기면 슬롯에서 채운다.
    art: { motif: motifOf(c, u) },
    publisher: c.publisher,
    publishedAt: c.publishedAt,
    startedAt: u?.status === 'reading' || u?.status === 'read' ? u.startedAt : undefined,
    finishedAt: u?.status === 'read' ? u.finishedAt : undefined,
  };
}
