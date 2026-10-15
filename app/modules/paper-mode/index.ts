// 종이 모드(Android 전용) JS 쪽. 네이티브(android/)는 다른 앱 위에 옅은 종이 색과 결을 얹는 오버레이 창과 그 포그라운드 서비스.
// iOS·Expo Go(네이티브 모듈이 없는 곳)에서는 available이 false라 화면에서 진입점을 숨긴다.
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { useEffect, useState, type ComponentType } from 'react';
import { AppState, Platform, type ViewProps } from 'react-native';

export type PaperPalette = 'bright' | 'warm';
export type PaperSettings = { palette: PaperPalette; tint: number; grain: number };
export type PaperState = {
  running: boolean; // 서비스가 켜져 있다(사용자가 켰고 아직 끄지 않았다)
  starting: boolean; // 켜는 중(서비스 프로세스가 아직 창을 붙이지 않았다)
  shown: boolean; // 창이 지금 화면에 붙어 있다(화면이 꺼졌거나 잠겨 있으면 false)
  limited: boolean; // 시스템의 최대 가림 불투명도 때문에 효과를 줄였다
  windowAlpha: number;
  maxObscuringOpacity: number;
  canDrawOverlays: boolean;
  notificationsEnabled: boolean;
  lastError: string | null; // 'permission'(권한 회수·없음), 'start'(시스템이 시작을 막음)
};

type Native = {
  isSupported(): boolean;
  getState(): PaperState;
  getSettings(): PaperSettings;
  setSettings(palette: PaperPalette, tint: number, grain: number): PaperSettings;
  openOverlaySettings(): void;
  start(): boolean;
  stop(): void;
  addListener(event: 'onChange', cb: (s: PaperState) => void): { remove(): void };
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('PaperMode') : null;

export const paperModeAvailable = !!native && native.isSupported();
export const DEFAULT_PAPER: PaperSettings = { palette: 'bright', tint: 0.6, grain: 0.35 };

const OFF: PaperState = { running: false, starting: false, shown: false, limited: false, windowAlpha: 0, maxObscuringOpacity: 1, canDrawOverlays: false, notificationsEnabled: true, lastError: null };

export const paperMode = {
  state: (): PaperState => (native ? native.getState() : OFF),
  settings: (): PaperSettings => (native ? native.getSettings() : DEFAULT_PAPER),
  save: (s: PaperSettings): PaperSettings => (native ? native.setSettings(s.palette, s.tint, s.grain) : s),
  openOverlaySettings: () => native?.openOverlaySettings(),
  start: (): boolean => (native ? native.start() : false),
  stop: () => native?.stop(),
};

// 실제 상태: 서비스가 알릴 때(켜짐·꺼짐·창 붙음) + 앱으로 돌아올 때(설정 화면에서 권한을 바꾸고 온 경우) 다시 읽는다
export function usePaperState(): [PaperState, () => void] {
  const [state, setState] = useState<PaperState>(() => paperMode.state());
  useEffect(() => {
    if (!native) return;
    const sub = native.addListener('onChange', setState);
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') setState(native.getState());
    });
    setState(native.getState());
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);
  return [state, () => setState(paperMode.state())];
}

// 설정 미리보기: 오버레이 창과 같은 그림을 같은 불투명도로 그 아래(형제 뷰) 위에 합성한다. 미리보기 내용 위에 절대 위치로 겹쳐 쓴다
export type PaperPreviewProps = ViewProps & { palette: PaperPalette; tint: number; grain: number; active: boolean };
export const PaperPreview: ComponentType<PaperPreviewProps> | null = paperModeAvailable ? requireNativeView<PaperPreviewProps>('PaperMode') : null;
