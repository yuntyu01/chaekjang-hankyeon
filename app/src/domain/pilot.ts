// 상자 모델 파일럿: 선반 한 칸(높이·두께가 다른 3권: 눕힘 · 기대는 세운 책 · 표지 전시).
// 배치는 선반 공간 값(가로 위치·기대는 방향·저장된 기댄 각도와 상대)만 저장하고, 모양은 매번 상자에서 계산한다.
import { boxSize, collide, frontPoly, solveLean, type Placed } from './box';
import { PLANK_BOUNDS } from './shelf-scene';
import type { Book, Pose } from './types';

import { LYING_BACK_Z } from './geometry';

export { LYING_BACK_Z };

export type PilotItem = {
  bookId: string;
  pose: Pose;
  x: number; // 똑바로 섰을 때 왼쪽 면(선반 공간 DU)
  lean?: -1 | 1; // 기대는 방향(세운 책만)
  saved?: { angle: number; on: string }; // 마지막으로 푼 기댄 각도와 상대
};

export type PilotLayout = { version: 1; items: PilotItem[] };

export const PILOT_LAYOUT: PilotLayout = {
  version: 1,
  items: [
    { bookId: 'b12', pose: 'horizontal', x: 4 },
    { bookId: 'b06', pose: 'spine', x: 170, lean: -1 },
    { bookId: 'b16', pose: 'front', x: 210 },
  ],
};

function base(item: PilotItem, book: Book): Placed {
  return {
    bookId: item.bookId,
    pose: item.pose,
    size: boxSize(book, item.pose),
    x: item.x,
    y: 0,
    z: item.pose === 'horizontal' ? LYING_BACK_Z : 0,
    angle: 0,
  };
}

// 상자를 놓고 기대는 책의 각도를 푼다. 저장된 각도가 아직 맞으면(상대가 그대로 있고, 파고들지 않고, 여전히 닿으면) 그대로 쓴다.
export function placePilot(layout: PilotLayout, books: Record<string, Book>) {
  const placed = layout.items.map((it) => base(it, books[it.bookId]));
  const result: { placed: Placed[]; leans: Record<string, { angle: number; on?: string; supported: boolean }> } = { placed, leans: {} };
  layout.items.forEach((it, i) => {
    if (it.pose !== 'spine' || !it.lean) return;
    const p = placed[i];
    const others = placed.filter((o) => o !== p);
    const s = it.saved;
    const partner = s && others.find((o) => o.bookId === s.on);
    if (s && partner && Math.sign(s.angle) === it.lean) {
      const q = { ...p, angle: s.angle };
      const touching = collide({ ...p, angle: s.angle + it.lean * 0.6 }, partner);
      const clear = !others.some((o) => collide(q, o));
      const inside = frontPoly(q).every((v) => v.x >= PLANK_BOUNDS.min - 0.01 && v.x <= PLANK_BOUNDS.max + 0.01);
      if (touching && clear && inside) {
        placed[i] = q;
        result.leans[it.bookId] = { angle: s.angle, on: s.on, supported: true };
        return;
      }
    }
    const r = solveLean(p, it.lean, others, PLANK_BOUNDS);
    placed[i] = { ...p, angle: r.angle };
    result.leans[it.bookId] = { angle: r.angle, on: r.on, supported: r.supported };
  });
  return result;
}

// 저장할 배치: 기댄 결과를 기록하고, 기댈 곳이 없던 책은 바로 세운다.
export function withPilotLeans(layout: PilotLayout, books: Record<string, Book>): PilotLayout {
  const { leans } = placePilot(layout, books);
  return {
    ...layout,
    items: layout.items.map((it) => {
      const l = leans[it.bookId];
      if (!l) return it.saved ? { ...it, saved: undefined } : it;
      if (!l.supported) return { ...it, lean: undefined, saved: undefined };
      return { ...it, saved: l.on ? { angle: Math.round(l.angle * 1000) / 1000, on: l.on } : undefined };
    }),
  };
}

// 빈틈·파고듦 검사(검수용): 기댄 책은 상대와 맞닿아야 하고(0.6도 더 기울면 겹침), 어떤 상자와도 겹치면 안 된다.
export function contactReport(placed: Placed[]) {
  return placed.map((p) => {
    const others = placed.filter((o) => o !== p);
    const penetrates = others.filter((o) => collide(p, o)).map((o) => o.bookId);
    let touching: string | undefined;
    if (p.angle) {
      const more = { ...p, angle: p.angle + Math.sign(p.angle) * 0.6 };
      touching = others.find((o) => collide(more, o))?.bookId;
    }
    return { bookId: p.bookId, angle: p.angle, penetrates, touching, poly: frontPoly(p) };
  });
}

