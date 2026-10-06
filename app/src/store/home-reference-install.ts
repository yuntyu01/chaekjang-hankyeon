import { buildReferenceHome, type HomeReferenceProfile } from '@/domain/home-reference';
import type { Library } from '@/domain/library';
import type { ShelfLayout } from '@/domain/types';
import { VIEW_PITCH_MIN } from '@/domain/camera';
import { VIEW_SETTINGS_KEY } from './view-settings-key';

export const HOME_REFERENCE_KEY = 'home-reference:2026-10';
export const HOME_REFERENCE_BACKUP_KEY = 'home-reference:before-v1';
type Install = (ReturnType<typeof buildReferenceHome> & { complete: false })
  | { complete: true; profile: HomeReferenceProfile };
type Dependencies = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  saveLibrary(lib: Library): Promise<void>;
};

// 완료 표시가 마지막이다. 저장 중 중단돼도 같은 계획으로 재시도하며 책을 중복 생성하지 않는다.
export async function installReferenceHome(lib: Library, previous: ShelfLayout, deps: Dependencies): Promise<HomeReferenceProfile> {
  const raw = await deps.getItem(HOME_REFERENCE_KEY);
  const saved = raw ? JSON.parse(raw) as Install : null;
  if (saved?.complete) return saved.profile;
  let plan = saved;
  if (!plan) {
    const now = new Date().toISOString();
    if (!await deps.getItem(HOME_REFERENCE_BACKUP_KEY)) {
      const viewSettings = await deps.getItem(VIEW_SETTINGS_KEY);
      await deps.setItem(HOME_REFERENCE_BACKUP_KEY, JSON.stringify({ lib, layout: previous, viewSettings, createdAt: now }));
    }
    plan = { ...buildReferenceHome(lib, previous, now), complete: false };
    await deps.setItem(HOME_REFERENCE_KEY, JSON.stringify(plan));
  }
  // 중단 뒤 새로 생긴 기록도 유지한다. 계획에는 추가된 책/판본/장정만 합친다.
  const merged: Library = { ...lib,
    books: { ...plan.lib.books, ...lib.books },
    editions: { ...plan.lib.editions, ...lib.editions },
    bindings: { ...plan.lib.bindings, ...lib.bindings },
  };
  const assigned = new Set([...plan.layout.placements.map(p => p.bookId), ...plan.layout.drawer]);
  const layout = { ...plan.layout, drawer: [...plan.layout.drawer, ...Object.keys(merged.books).filter(id => !assigned.has(id))] };
  await deps.saveLibrary(merged);
  await deps.setItem('shelf-layout', JSON.stringify(layout));
  // 책·선반·그림자·터치에 동일한 시점: 시안 구도(기본 보기, 눈높이 ≈ 책 머리)
  await deps.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ pitch: VIEW_PITCH_MIN }));
  // 완료 후 전체 서재 사본은 백업 키 하나에만 보관한다.
  await deps.setItem(HOME_REFERENCE_KEY, JSON.stringify({ complete: true, profile: plan.profile }));
  return plan.profile;
}
