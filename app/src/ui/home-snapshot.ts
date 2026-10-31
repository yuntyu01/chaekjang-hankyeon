// 지난 홈 화면 사진(휴대폰 문서 폴더). 첫 책장은 책 그림을 기록해 줄 캔버스에 올리기까지 몇 초가 걸려,
// 다음 실행 때는 시작 화면 그림 대신 이 사진을 JS가 뜨자마자 띄우고 실제 책장이 다 그려지면 바꿔치기한다(같은 그림이라 티 나지 않는다).
// 사진은 홈이 가만히 있을 때(다른 화면·상자·끌기 없음, 맨 위, 그림 대기열 빔) 찍는다. 실행마다 한 번, 그리고 책장·설정이 바뀔 때마다 다시.
// 바뀐 뒤 다시 찍기 전에 앱이 꺼지면 옛 사진이 뜨지 않게 바뀌는 순간 사진 정보를 지운다(그러면 다음 실행은 원래 시작 화면).
import * as FS from 'expo-file-system/legacy';
import { type DependencyList, type RefObject, useEffect } from 'react';
import { AppState, Dimensions, PixelRatio, type View } from 'react-native';

import { captureWindow, screenCaptureAvailable } from '../../modules/screen-capture';
import { artIdle } from './book3d/art';
import { PERF_ENABLED } from './perf';

// 창 사진 모듈이 없는 곳(iOS 등)에서는 쓰지 않는다(시작 화면 그림 그대로)
const DIR = screenCaptureAvailable && FS.documentDirectory ? `${FS.documentDirectory}home-snapshot/` : null;
const META = DIR ? `${DIR}meta.json` : null;
// 홈 그림이 크게 바뀌어 예전 사진을 버려야 할 때 올린다
const REV = 3; // 2: 책 제목 글꼴을 고운바탕 Bold로, 3: 함렛 SemiBold·종이·천 결 세기
type Meta = { rev: number; file: string; w: number; h: number; scale: number; fontScale: number };

const screenNow = () => {
  const { width, height } = Dimensions.get('window');
  return { w: width, h: height, scale: PixelRatio.get(), fontScale: PixelRatio.getFontScale() };
};

// 시작할 때: 지금 화면 크기·글자 크기에서 찍은 사진이 있으면 그 파일 주소(없거나 맞지 않으면 null)
export async function loadHomeSnapshot(): Promise<string | null> {
  if (!META || !DIR) return null;
  try {
    const meta = JSON.parse(await FS.readAsStringAsync(META)) as Meta;
    const now = screenNow();
    const same = meta.rev === REV && Math.abs(meta.w - now.w) < 1 && Math.abs(meta.h - now.h) < 1 && meta.scale === now.scale && meta.fontScale === now.fontScale;
    return same ? DIR + meta.file : null;
  } catch {
    return null;
  }
}

// 파일 쓰기·지우기는 차례로(사진 정보를 지운 뒤에 앞선 저장이 다시 쓰지 않게)
let disk: Promise<unknown> = Promise.resolve();
const onDisk = (op: () => Promise<unknown>) => {
  disk = disk.then(op).catch((e) => console.warn('home snapshot', String(e?.message ?? e)));
  return disk;
};

let root: RefObject<View | null> | null = null;
let shown = false; // 시작 화면이 걷혔다(그 뒤의 변화만 사진을 낡게 한다)
let dirty = true; // 실행마다 한 번은 찍는다(머리글 같은 날짜에 따른 글도 맞게)
let staleGen = 0;
let metaOnDisk = true;
let capturing = false;

// 앱 뿌리: 찍을 화면(뿌리 보기)과 시작 화면이 걷힌 때
export function setSnapshotRoot(ref: RefObject<View | null>) {
  root = ref;
}
export function setSnapshotShown() {
  shown = true;
}

function markStale() {
  dirty = true;
  staleGen++;
  if (shown && metaOnDisk && META) {
    metaOnDisk = false;
    void onDisk(() => FS.deleteAsync(META, { idempotent: true }));
  }
}

// 뿌리 보기의 창 안 영역(물리 픽셀)
const rootRect = () =>
  new Promise<{ x: number; y: number; w: number; h: number } | null>((resolve) => {
    if (!root?.current) return resolve(null);
    const px = PixelRatio.get();
    root.current.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x: x * px, y: y * px, w: w * px, h: h * px } : null));
  });

async function capture() {
  if (!DIR || !META || capturing) return;
  capturing = true;
  const gen = staleGen;
  const t0 = Date.now();
  try {
    const rect = await rootRect();
    if (!rect) return;
    const file = `home-${t0}.jpg`;
    await onDisk(async () => {
      await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
      await captureWindow(DIR + file, rect, 92);
      // 찍는 동안 바뀌었으면 버린다(다음 차례에 다시 찍는다)
      if (gen !== staleGen) return FS.deleteAsync(DIR + file, { idempotent: true });
      const meta: Meta = { rev: REV, file, ...screenNow() };
      await FS.writeAsStringAsync(META, JSON.stringify(meta));
      metaOnDisk = true;
      dirty = false;
      const names = await FS.readDirectoryAsync(DIR);
      await Promise.all(names.filter((n) => n !== file && n !== 'meta.json').map((n) => FS.deleteAsync(DIR + n, { idempotent: true })));
    });
    if (PERF_ENABLED) console.log(`[snapshot] total=${Date.now() - t0}ms rect=${rect.w}x${rect.h}`);
  } catch (e) {
    console.warn('home snapshot failed', String((e as Error)?.message ?? e));
  } finally {
    capturing = false;
  }
}

// 홈 화면: deps(책장·책·설정처럼 홈 그림을 바꾸는 값)가 바뀌면 사진이 낡은 것. rest(가만히 있음)인 동안 낡았으면 잠깐 뒤에 찍는다.
// ready: 찍기 직전 확인(맨 위로 스크롤돼 있는지 등). 아니면 조금 뒤 다시 본다
export function useHomeSnapshot(rest: boolean, deps: DependencyList, ready: () => boolean) {
  useEffect(() => {
    markStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!rest) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      t = setTimeout(async () => {
        if (!alive || !dirty) return;
        if (shown && AppState.currentState === 'active' && artIdle() && ready()) await capture();
        if (alive && dirty) later();
      }, 1500);
    };
    later();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest, ...deps]);
}
