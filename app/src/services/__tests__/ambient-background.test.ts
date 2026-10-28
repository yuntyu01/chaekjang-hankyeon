const mockPlayer = { loop: false, volume: 0, muted: false, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), setActiveForLockScreen: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
const mockMode = jest.fn(async () => {});
jest.mock('expo-audio', () => ({ createAudioPlayer: () => mockPlayer, setAudioModeAsync: mockMode }));
jest.mock('@/store/settings-store', () => ({ settingsStore: { get: () => ({ volume: 0.6, muted: false }), subscribe: jest.fn() } }));

it('Android에서 백그라운드 재생을 위한 미디어 제어를 등록하고 종료 시 해제한다', async () => {
  const { Platform } = require('react-native') as typeof import('react-native');
  const previous = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  try {
    const { ambient } = require('../ambient') as typeof import('../ambient');
    await ambient.play('rain');
    expect(mockMode).toHaveBeenCalledWith(expect.objectContaining({ shouldPlayInBackground: true, interruptionMode: 'doNotMix' }));
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledWith(true, expect.objectContaining({ title: '빗소리' }));
    ambient.stop();
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
  } finally {
    Object.defineProperty(Platform, 'OS', { value: previous, configurable: true });
  }
});
