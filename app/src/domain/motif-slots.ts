// 재장정 모티프 자산 슬롯 30개. 실제 PNG가 없으면 개발용 SVG(devFallback)로 그린다.
// 파일 규격은 docs/assets.md 참고.
import type { MotifId } from './types';

export const MOTIF_SLOTS = [
  { id: 'leaf', name: '잎', devFallback: 'leaf' },
  { id: 'sprig', name: '가지', devFallback: 'sprig' },
  { id: 'cotton', name: '목화', devFallback: 'cotton' },
  { id: 'moon', name: '달', devFallback: 'moon' },
  { id: 'crescent', name: '초승달', devFallback: 'moon' },
  { id: 'star', name: '별', devFallback: 'star' },
  { id: 'constellation', name: '별자리', devFallback: 'star' },
  { id: 'wave', name: '파도', devFallback: 'wave' },
  { id: 'ripple', name: '물결', devFallback: 'wave' },
  { id: 'flower', name: '꽃', devFallback: 'flower' },
  { id: 'wildflower', name: '들꽃', devFallback: 'bud' },
  { id: 'tulip', name: '튤립', devFallback: 'bud' },
  { id: 'camellia', name: '동백', devFallback: 'flower' },
  { id: 'pine', name: '소나무', devFallback: 'pine' },
  { id: 'mountain', name: '산', devFallback: 'pine' },
  { id: 'cloud', name: '구름', devFallback: 'wave' },
  { id: 'sun', name: '해', devFallback: 'star' },
  { id: 'rain', name: '비', devFallback: 'wave' },
  { id: 'snow', name: '눈송이', devFallback: 'star' },
  { id: 'feather', name: '깃털', devFallback: 'leaf' },
  { id: 'bird', name: '새', devFallback: 'sprig' },
  { id: 'cat', name: '고양이', devFallback: 'moon' },
  { id: 'teacup', name: '찻잔', devFallback: 'bud' },
  { id: 'candle', name: '촛불', devFallback: 'bud' },
  { id: 'key', name: '열쇠', devFallback: 'star' },
  { id: 'letter', name: '편지', devFallback: 'leaf' },
  { id: 'window', name: '창문', devFallback: 'moon' },
  { id: 'lantern', name: '등불', devFallback: 'bud' },
  { id: 'shell', name: '조개', devFallback: 'wave' },
  { id: 'mushroom', name: '버섯', devFallback: 'bud' },
] as const satisfies readonly { id: string; name: string; devFallback: MotifId }[];

export type MotifSlotId = (typeof MOTIF_SLOTS)[number]['id'];

const byId = new Map<string, (typeof MOTIF_SLOTS)[number]>(MOTIF_SLOTS.map((m) => [m.id, m]));

export function isMotifSlot(id: string): id is MotifSlotId {
  return byId.has(id);
}

const DEV_MOTIFS: readonly string[] = ['sprig', 'leaf', 'cotton', 'moon', 'star', 'wave', 'flower', 'pine', 'bud'];

export function devMotifFor(id: string): MotifId {
  return byId.get(id)?.devFallback ?? (DEV_MOTIFS.includes(id) ? (id as MotifId) : 'sprig');
}

// ISBN으로 기본 모티프를 고르게 흩뿌린다(서버 default_motif_id가 없을 때).
export function defaultMotifFor(isbn13: string): MotifSlotId {
  let h = 0;
  for (const ch of isbn13) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MOTIF_SLOTS[h % MOTIF_SLOTS.length].id;
}
