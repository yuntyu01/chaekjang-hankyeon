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
  hasSavedLayout?: boolean;
};

const hasRecords = (lib: Library) => Object.values(lib).some((records) => Object.keys(records).length > 0);
const hasPlacedBooks = (layout: ShelfLayout) => layout.placements.length > 0 || layout.drawer.length > 0;

// 완료 표시가 마지막이다. 저장 중 중단돼도 같은 계획으로 재시도하며 책을 중복 생성하지 않는다.
export async function installReferenceHome(lib: Library, previous: ShelfLayout, deps: Dependencies): Promise<HomeReferenceProfile> {
  const raw = await deps.getItem(HOME_REFERENCE_KEY);
  const saved = raw ? JSON.parse(raw) as Install : null;
  if (saved?.complete) return saved.profile;
  if (saved) {
    // 이전 버전의 미완료 계획은 사용자의 서재를 재배치할 수 있다.
    // 백업을 확인할 수 없거나 기존 기록이 있었다면 자동으로 이어 가지 않는다.
    const backupRaw = await deps.getItem(HOME_REFERENCE_BACKUP_KEY);
    if (!backupRaw) return {};
    const backup = JSON.parse(backupRaw) as { lib: Library; layout: ShelfLayout };
    if (hasRecords(backup.lib) || hasPlacedBooks(backup.layout)) return {};
    // 설치 후 완료 표시를 쓰기 전에 앱이 꺼졌다면, 그 사이 사용자가 바꾼 배치는 건드리지 않는다.
    if (deps.hasSavedLayout && JSON.stringify(previous) !== JSON.stringify(saved.layout)) return {};
  }
  let plan = saved;
  if (!plan) {
    // 시안은 새 서재에만 설치한다. 기존 서재나 저장된 배치는 사용자의 기록이다.
    if (hasRecords(lib) || hasPlacedBooks(previous) || deps.hasSavedLayout) return {};
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
  // 예시는 서재에 저장하지 않는다(2026-11). 이전 버전이 남긴 미완료 계획에 책이 들어 있을 때만 합쳐 저장한다
  if (Object.keys(merged.books).length !== Object.keys(lib.books).length) await deps.saveLibrary(merged);
  await deps.setItem('shelf-layout', JSON.stringify(layout));
  // 책·선반·그림자·터치에 동일한 시점: 시안 구도(기본 보기, 눈높이 ≈ 책 머리)
  await deps.setItem(VIEW_SETTINGS_KEY, JSON.stringify({ pitch: VIEW_PITCH_MIN }));
  // 완료 후 전체 서재 사본은 백업 키 하나에만 보관한다.
  await deps.setItem(HOME_REFERENCE_KEY, JSON.stringify({ complete: true, profile: plan.profile }));
  return plan.profile;
}
