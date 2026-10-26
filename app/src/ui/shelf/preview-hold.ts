// 끄는 동안 미리보기에서 다른 책의 넘어짐(바닥에 눕기·서랍으로 떨어짐)이 손가락을 조금 움직일 때마다 생겼다 없어졌다 하지 않게 붙잡는다.
// 놓을 자리가 0.5DU 바뀔 때마다 기대기를 다시 풀어, 받침 경계 근처에서는 넘어짐이 켜졌다 꺼졌다 했다
// (2026-10-26 측정: 같은 줄 끌기 73번 중 46번, 12DU 안에서 되돌아온 깜빡임 62번, 한 번 끌기에 최대 4번, 대개 1DU 안).
// 넘어짐이 바뀌는 미리보기는 손가락이 마지막으로 받아들인 자리에서 HOLD_DU 넘게 움직였거나, 손가락이 HOLD_MS 동안 멈춰 있을 때 받아들인다.
// 그동안은 앞 미리보기를 그대로 보여 주고, 그때 놓으면 보이는 대로 놓인다(미리보기 = 확정).
import type { ShelfLayout } from '@/domain/types';

export const HOLD_DU = 6;
export const HOLD_MS = 250;

// 미리보기에서 넘어지는 책(끄는 책 말고): 확정 배치와 자세가 달라진 책, 새로 서랍에 들어간 책
export function fallSig(base: ShelfLayout, next: ShelfLayout | null, dragId: string): string {
  if (!next) return '';
  const pose = new Map(base.placements.map((p) => [p.bookId, p.pose]));
  const was = new Set(base.drawer);
  const out: string[] = [];
  for (const p of next.placements) {
    if (p.bookId === dragId) continue;
    const q = pose.get(p.bookId);
    if (q !== undefined && q !== p.pose) out.push(`${p.bookId}:${p.pose}`);
  }
  for (const id of next.drawer) if (id !== dragId && !was.has(id)) out.push(`${id}:drawer`);
  return out.sort().join(',');
}

// sig: 지금 보이는 미리보기의 넘어짐, at: 그 미리보기를 받아들인 손가락 위치(DU)
export type Hold = { sig: string; at: number };

// 새 미리보기(넘어짐 sig, 손가락 위치 x)를 받아들일지. 넘어짐이 같으면 바로, 다르면 손가락이 HOLD_DU 넘게 갔거나 멈춰 있을 때(rest)
export function stepHold(h: Hold, sig: string, x: number, rest = false): { take: boolean; hold: Hold } {
  if (sig === h.sig || rest || Math.abs(x - h.at) >= HOLD_DU) return { take: true, hold: { sig, at: x } };
  return { take: false, hold: h };
}
