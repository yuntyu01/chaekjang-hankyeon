// 성능 측정용 그리기 단계. EXPO_PUBLIC_PERF=1로 만든 번들에서만 선반 메뉴에 측정 항목이 보인다(보통 빌드에서는 늘 'full').
// 같은 배치·같은 시점 전환에서 단계를 하나씩 켜 프레임 간격 차이로 비용을 가른다.
//   shapes: 책 면을 단색 다각형으로만(그림·글자·질감·명암·그림자 없음)
//   art:    + 책등·표지 그림, 글자, 질감, 면 명암
//   cast:   + 벽·선반 윗면 그림자, 접촉·틈·기대기·쌓기 어둠, 선반 아래 그림자
//   full:   + 책 면이 받는 그림자(다른 책·윗 선반 판)
import { makeMutable } from 'react-native-reanimated';

import { SHOW } from '@/ui/shelf/shadow-debug';

export const PERF_ENABLED = process.env.EXPO_PUBLIC_PERF === '1';
// 세부 단계: art에서 옆면 질감만 뺀 것(art-grain), art에 그림자 한 종류씩 더한 것(art+이름)
type Shadow = 'wall' | 'shelfCast' | 'contact' | 'gap' | 'lean' | 'stack' | 'shelf' | 'cast';
export type PerfLevel = 'shapes' | 'art' | 'cast' | 'full' | 'art-grain' | `art+${Shadow}`;
export const PERF_LEVELS: PerfLevel[] = ['shapes', 'art', 'cast', 'full'];
export const PERF_DETAIL: PerfLevel[] = ['art-grain', 'art+wall', 'art+shelfCast', 'art+contact', 'art+gap', 'art+lean', 'art+stack', 'art+shelf', 'art+cast'];
const SHADOWS: Shadow[] = ['wall', 'shelfCast', 'contact', 'gap', 'lean', 'stack', 'shelf', 'cast'];

// 책 몸체 그리기 단계(BookNode·BookFaces가 마운트할 때 읽는다. 바꾸면 선반 줄을 다시 마운트해야 한다)
export const RENDER = { art: true, texture: true, grain: true, books: true };

// 선반 그림자 확인용 보기(측정 메뉴): 오른쪽 끝의 옆면 명암·벽 그림자·AO를 하나씩 끄고, 빈 선반만 본다
export const SHELF_VIEWS = ['전체', '옆면 명암 끔', '벽 그림자 끔', 'AO 끔', '빈 선반'] as const;
export type ShelfView = (typeof SHELF_VIEWS)[number];
// 선반 원인 분리(chaekjang:///?sh=모드). 카메라·광원·선반 형상은 그대로 두고 그리는 층만 고른다.
// 측정 번들: 자세 바꾸기·밀림 애니메이션을 이 배수만큼 느리게(중간 프레임 캡처용, 기본 1)
export const ANIM = { slow: 1 };
// 측정 번들: 이동 캔버스 진단(?transit=show 늘 보이게 + 자르는 윤곽 표시 + 드나들 때 기록)
export const TRANSIT_DEBUG = { on: false };
// 측정 번들: 끌어 놓을 때 쓰인 밀기 규칙(왼쪽 우선·오른쪽 대안·양쪽 나눔)을 안내 문구에 붙인다(?pushdbg=1, 영상 확인용)
export const PUSH_DEBUG = { on: false };
// 측정 번들: 메뉴 모달의 반투명 옵션을 다시 켜 ANR 재현 여부를 비교(?menutl=1). 기본은 끔
export const MENU_FLAGS = { translucent: false };

export const SHELF_MODES = ['all', 'plank', 'plankflat', 'side0', 'wall', 'wallmask', 'wallboard', 'ao', 'debug', 'nowall', 'norecv', 'noplank', 'faces'] as const;
export type ShelfMode = (typeof SHELF_MODES)[number];
export function setShelfMode(m: ShelfMode) {
  const board = !['wall', 'wallmask'].includes(m);
  SHOW.shelfBoard = board;
  SHOW.shelfShade = m !== 'plankflat';
  SHOW.shelfSide = m !== 'side0';
  SHOW.shelf = ['all', 'side0', 'wall', 'wallmask', 'wallboard', 'debug'].includes(m);
  SHOW.shelfAO = ['all', 'side0', 'ao', 'debug'].includes(m);
  SHOW.shelfBlur = m !== 'wallmask';
  SHOW.shelfDebug = m === 'wallmask' || m === 'debug';
  // 선반 그림자 연결 확인(책 있는 화면): nowall = 판 → 벽만 끔, norecv = 판 → 아래 책만 끔, noplank = 둘 다 끔
  if (m === 'nowall' || m === 'norecv' || m === 'noplank') {
    SHOW.shelfAO = true;
    SHOW.shelf = m === 'norecv';
  }
  SHOW.castPlank = m !== 'norecv' && m !== 'noplank';
  SHOW.faceDebug = m === 'faces';
  if (m === 'faces') {
    SHOW.shelf = true;
    SHOW.shelfAO = true;
  }
}

export function setShelfView(v: ShelfView) {
  setPerfLevel('full');
  SHOW.shelfSide = v !== '옆면 명암 끔';
  SHOW.shelf = v !== '벽 그림자 끔';
  SHOW.shelfAO = v !== 'AO 끔';
  RENDER.books = v !== '빈 선반';
}

export function setPerfLevel(level: PerfLevel) {
  const art = level !== 'shapes';
  RENDER.art = art;
  RENDER.texture = art;
  RENDER.grain = art && level !== 'art-grain';
  SHOW.body = art;
  const on = new Set<Shadow>(level === 'full' ? SHADOWS : level === 'cast' ? SHADOWS.filter((k) => k !== 'cast') : level.startsWith('art+') ? [level.slice(4) as Shadow] : []);
  for (const k of SHADOWS) SHOW[k] = on.has(k);
  SHOW.shelfSide = true;
  SHOW.shelfAO = true;
  RENDER.books = true;
}

export type FrameStats = { n: number; mean: number; p50: number; p90: number; max: number; over50: number };

export function frameStats(dts: number[]): FrameStats {
  const a = [...dts].sort((x, y) => x - y);
  const q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
  const mean = a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  return { n: a.length, mean: +mean.toFixed(1), p50: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), max: +(a.at(-1) ?? 0).toFixed(1), over50: a.filter((v) => v > 50).length };
}

// ---------- 측정 번들: 끌기 한 번의 시간표 ----------
// JS와 UI 스레드가 같은 시계(Date.now, ms)로 사건을 적고 끝나면 한 번에 logcat으로 낸다(손가락으로 끄는 동안 / 놓기 계산 / 놓은 뒤 자리 잡기).
// 켜져 있지 않으면 아무것도 하지 않는다(보통 빌드에서는 늘 꺼짐).
export const TL = { on: false, js: [] as string[] };
export function tl(name: string) {
  if (TL.on) TL.js.push(`${Date.now()} ${name}`);
}
export const tlOn = makeMutable(false);
export const tlEv = makeMutable<string[]>([]);
export function tlu(name: string) {
  'worklet';
  if (!tlOn.value) return;
  const at = Date.now();
  tlEv.modify((a) => {
    'worklet';
    a.push(`${at} ${name}`);
    return a;
  });
}
// logcat 한 줄 길이 제한(약 4KB)을 넘지 않게 나눠 낸다
export function logChunks(tag: string, lines: string[]) {
  let buf: string[] = [];
  let len = 0;
  let k = 0;
  const flush = () => {
    if (!buf.length) return;
    console.log(tag, `${k++}`, buf.join(';'));
    buf = [];
    len = 0;
  };
  for (const l of lines) {
    if (len + l.length > 3000) flush();
    buf.push(l);
    len += l.length + 1;
  }
  flush();
}

