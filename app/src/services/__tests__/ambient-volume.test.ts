// 환경음 실제 출력 음량: 플레이어에는 volume 하나만 넣는다(음소거 = 0). muted 속성을 함께 쓰면 expo-audio(Android)가
// 비동기로 반영되는 이전 음량으로 되돌린다(2026-11 에뮬에서 화면 60%·출력 100%로 확인한 문제)
const mockAssign: { key: string; value: unknown }[] = [];
const mockPlayers: { pause: jest.Mock; remove: jest.Mock; play: jest.Mock }[] = [];
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  createAudioPlayer: jest.fn(() => {
    const target: Record<string, unknown> = { play: jest.fn(), pause: jest.fn(), remove: jest.fn(), setActiveForLockScreen: jest.fn(), addListener: () => ({ remove: () => {} }) };
    mockPlayers.push(target as never);
    return new Proxy(target, { set(t, k, v) { mockAssign.push({ key: String(k), value: v }); t[k as string] = v; return true; } });
  }),
}));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: async () => null, setItem: async () => {} } }));

import { ambient, outputVolume } from '../ambient';
import { settingsStore } from '@/store/settings-store';

const volumes = () => mockAssign.filter((a) => a.key === 'volume').map((a) => a.value);

it('출력 음량: 음소거면 0, 아니면 설정 음량(0~1로 자름)', () => {
  expect(outputVolume({ volume: 0.6, muted: false })).toBe(0.6);
  expect(outputVolume({ volume: 0.6, muted: true })).toBe(0);
  expect(outputVolume({ volume: 1.4, muted: false })).toBe(1);
});

it('음소거·해제·슬라이더가 플레이어에 마지막으로 넣는 값이 화면 값과 같다(muted 속성은 쓰지 않는다)', async () => {
  settingsStore.set({ volume: 0.6, muted: false, scene: 'rain' });
  await ambient.play('rain');
  expect(volumes().at(-1)).toBe(0.6);
  settingsStore.set({ muted: true });
  expect(volumes().at(-1)).toBe(0);
  settingsStore.set({ muted: false });
  expect(volumes().at(-1)).toBe(0.6); // 음소거 전 음량으로 돌아온다
  ambient.preview(0.25);
  expect(volumes().at(-1)).toBe(0.25);
  settingsStore.set({ volume: 0, muted: false });
  expect(volumes().at(-1)).toBe(0);
  expect(mockAssign.some((a) => a.key === 'muted')).toBe(false);
});

it('장면을 바꾸면 이전 소리를 멈춘 뒤 새 소리를 튼다(두 소리가 겹치지 않게)', async () => {
  await ambient.play('rain');
  const before = mockPlayers.length;
  await ambient.play('fire');
  expect(mockPlayers.length).toBe(before + 1);
  const old = mockPlayers[before - 1];
  expect(old.pause).toHaveBeenCalled();
  expect(old.pause.mock.invocationCallOrder[0]).toBeLessThan(old.remove.mock.invocationCallOrder[0]);
  expect(mockPlayers[before].play).toHaveBeenCalled();
});
