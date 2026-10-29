import { useLayoutEffect, useMemo, useRef } from 'react';

import { fromPlaced } from '@/domain/book3';
import { computeShelf, type BookFrame } from '@/domain/shelf-scene';
import type { ShelfLayout } from '@/domain/types';
import { makeMotion, type Motion, type SceneMotion } from '@/ui/shelf/scene';
import { retainSceneMotions } from './scene-motion-cache';

// 선반별 프레임(3D 상자)을 캐시해서 바뀐 선반만 다시 그린다. 보기 각과 상관없다.
export function useShelfScenes(layout: ShelfLayout, books: Parameters<typeof computeShelf>[1]) {
  const cache = useRef(new Map<string, { sig: string; books: typeof books; frames: BookFrame[] }>());
  const next = useMemo(() => {
    const out = new Map<string, BookFrame[]>();
    const entries = new Map<string, { sig: string; books: typeof books; frames: BookFrame[] }>();
    for (const s of layout.shelves) {
      const sig = JSON.stringify(layout.placements.filter((p) => p.shelfId === s.id));
      const hit = cache.current.get(s.id);
      if (hit && hit.sig === sig && hit.books === books) {
        out.set(s.id, hit.frames);
        entries.set(s.id, hit);
        continue;
      }
      const frames = computeShelf(layout, books, s.id).frames;
      entries.set(s.id, { sig, books, frames });
      out.set(s.id, frames);
    }
    return { out, entries };
  }, [layout, books]);
  // 중단되거나 재시도된 렌더가 확정된 선반 캐시를 바꾸지 않게 한다.
  useLayoutEffect(() => { cache.current = next.entries; }, [next]);
  return next.out;
}

// 선반마다 움직임 하나(UI 스레드 SharedValue). 선반이 그대로면 같은 객체라 제스처·그림이 다시 만들어지지 않는다.
export function useSceneMotions(ids: string[], frames: Map<string, BookFrame[]>): SceneMotion[] {
  const cache = useRef(new Map<string, Motion>());
  const key = JSON.stringify(ids);
  const next = useMemo(() => {
    return retainSceneMotions(ids, cache.current, (id) => makeMotion((frames.get(id) ?? []).map((f) => fromPlaced(f.box))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useLayoutEffect(() => { cache.current = next.map; }, [next]);
  return next.motions;
}
