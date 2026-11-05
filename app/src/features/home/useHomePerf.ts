// 책장 화면의 성능 측정·비교 캡처 도구(EXPO_PUBLIC_PERF=1 번들에서만 쓰인다): 딥링크로 화면 상태 바꾸기, 시점 전환 측정(?perfrun=), 끌기·되돌리기 시간표.
// 같은 배치에서 그리기 단계를 바꿔 가며: ① 가만히 있을 때 ② 시점 4°→8°→4° 두 번(UI 스레드만, React 없음)의 실제 프레임 간격,
// ③ 투영 계산만(그리기 없이 같은 함수), ④ 시점 확정 후 React 갱신(렌더·커밋) 시간과 그 뒤 프레임.
import { useLocalSearchParams } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Easing, useAnimatedReaction, useFrameCallback, useSharedValue, withRepeat, withSequence, withTiming, type DerivedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { VIEW_PITCH_MAX, VIEW_PITCH_MIN, type Cam } from '@/domain/camera';
import { PERF_LIGHT_KEY } from '@/scene-config/lighting';
import { PERF_UI_BG_KEY, PERF_WALL_KEY } from '@/scene-config/palette';
import { PERF_LOOK_KEY, PERF_SKIN_KEY } from '@/scene-config/skin';
import { realLibrarySeed } from '@/domain/real-sample';
import { DEMO_BOOT_KEY } from '@/store/boot';
import { libraryStore } from '@/store/library-store';
import { demoKindOf, placementStore } from '@/store/placement-store';
import { viewStore } from '@/store/view-store';
import { ANIM, frameStats, logChunks, PERF_ENABLED, PUSH_DEBUG, setLightOff, setPerfLevel, setShelfMode, setShelfView, SHELF_MODES, SHELF_VIEWS, TL, tl, tlEv, tlOn, TRANSIT_DEBUG, type PerfLevel, type ShelfMode } from '@/ui/perf';
import { rowAffine, useShelfMetrics, type RowGeom } from '@/ui/shelf/metrics';
import { lastPlan } from '@/ui/shelf/planner';
import { benchProjection, type BenchRow } from '@/ui/shelf/ShelfMotion';
import type { useSceneMotions } from './useShelfSceneState';
import type { useScreenTasks } from './useScreenTasks';

type Ctx = {
  view: { pitch: number; loaded: boolean };
  pitchSV: SharedValue<number>;
  viewGoal: SharedValue<number>;
  savePitch: (deg: number) => void;
  camSV: DerivedValue<Cam>;
  storeLoaded: boolean;
  tasks: ReturnType<typeof useScreenTasks>;
  dragJs: RefObject<{ preview: number[]; commit: number[]; js: number[]; commitStart: number; raf: number; last: number }>;
  dragRef: RefObject<{ bookId: string; shelfId: string } | null>;
  rows: (RowGeom & { shelfId: string; space: BenchRow['space'] })[];
  motions: ReturnType<typeof useSceneMotions>;
  m: ReturnType<typeof useShelfMetrics>;
  setToast: (t: { text: string }) => void;
  setDebugGeom: (on: boolean) => void;
};

export function useHomePerf({ view, pitchSV, viewGoal, savePitch, camSV, storeLoaded, tasks, dragJs, dragRef, rows, motions, m, setToast, setDebugGeom }: Ctx) {
  // 같은 배치에서 그리기 단계를 바꿔 가며: ① 가만히 있을 때 ② 시점 4°→8°→4° 두 번(UI 스레드만, React 없음)의 실제 프레임 간격,
  // ③ 투영 계산만(그리기 없이 같은 함수), ④ 시점 확정 후 React 갱신(렌더·커밋) 시간과 그 뒤 프레임.
  const [perfKey, setPerfKey] = useState(0);
  const [shelfView, setShelfViewState] = useState<(typeof SHELF_VIEWS)[number]>('전체');
  // 측정 번들에서만: chaekjang:///?sv=0~4 로 선반 보기를 바로 고른다(비교 캡처용)
  // lv=<그리기 단계>(예: full, cast)로 단계만 바꿔 같은 화면을 비교한다
  const { sv, lv, sh, lt, cam: camDebug, pitch: pitchParam, slow, transit, geom, pushdbg, mark, mat, light: lightParam, skin: skinParam, look: lookParam, uibg: uiBgParam, wallbg: wallBgParam } = useLocalSearchParams<{ sv?: string; lv?: string; sh?: string; lt?: string; cam?: string; pitch?: string; slow?: string; transit?: string; geom?: string; pushdbg?: string; mark?: string; mat?: string; light?: string; skin?: string; look?: string; uibg?: string; wallbg?: string }>();
  // 측정 번들: ?mark=b11,b12 처럼 고른 책을 한 가지 색(자홍, 둘째는 청록)으로만 그린다. 화면 녹화에서 그 책이 프레임마다 몇 군데에
  // 얼마나 보이는지 세어 빈 프레임·두 권 보임을 찾는다(장면에 넘기는 그림용 사본만 바꾼다. 배치 계산·저장은 그대로).
  // 측정 번들: ?geom=1 로 형상 보기(3D 상자 모서리·받침·계산상 선반)를 켜고 끈다(캡처 스크립트용)
  useEffect(() => {
    if (PERF_ENABLED && geom !== undefined) setDebugGeom(geom === '1');
  }, [geom]);
  if (PERF_ENABLED && slow !== undefined) ANIM.slow = Math.max(1, Number(slow) || 1);
  if (PERF_ENABLED && transit !== undefined) TRANSIT_DEBUG.on = transit === 'show';
  if (PERF_ENABLED && pushdbg !== undefined) PUSH_DEBUG.on = pushdbg === '1';
  // 측정 번들: ?pitch=3 처럼 저장된 보기 각을 바로 정한다(비교 캡처를 같은 각에서 시작)
  useEffect(() => {
    if (!PERF_ENABLED || pitchParam === undefined || !view.loaded) return;
    const deg = Math.max(VIEW_PITCH_MIN, Math.min(VIEW_PITCH_MAX, Number(pitchParam)));
    pitchSV.value = deg;
    viewGoal.value = deg;
    savePitch(deg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchParam, view.loaded]);
  // 측정 번들: ?cam=1 이면 지금 프레임에 실제로 쓰는 시점 값(UI 스레드 카메라)을 화면 위에 적는다
  const [camNow, setCamNow] = useState('');
  useAnimatedReaction(
    () => Math.round(pitchSV.value * 100) / 100,
    (deg, prev) => {
      if (camDebug !== '1' || deg === prev) return;
      scheduleOnRN(setCamNow, `적용 ${deg.toFixed(2)}° · ky ${camSV.value.ky.toFixed(4)} · kx ${camSV.value.kx}`);
    },
    [camDebug],
  );
  const { demoboot, perfrun, seedlib } = useLocalSearchParams<{ demoboot?: string; perfrun?: string; seedlib?: string }>();
  // 측정 번들: ?seedlib=1 로 화면 사진용 서재를 넣는다(실제 저장 경로, domain/real-sample)
  useEffect(() => {
    if (PERF_ENABLED && seedlib === '1') realLibrarySeed(libraryStore, new Date());
  }, [seedlib]);
  // 측정 번들: ?perfrun=full 처럼 메뉴를 거치지 않고 그 단계의 시점 전환 측정을 한 번 돌린다(전후 비교 스크립트용, 같은 단계를 다시 돌리려면 full.2처럼)
  const perfRan = useRef('');
  useEffect(() => {
    if (!PERF_ENABLED || !perfrun || !storeLoaded || perfRan.current === perfrun) return;
    perfRan.current = perfrun;
    const id = setTimeout(() => void runPerfRef.current(perfrun.split('.')[0] as PerfLevel), 1500);
    return () => clearTimeout(id);
  }, [perfrun, storeLoaded]);
  // 측정 번들: ?light=17,10,14,.55,.25,-.12,.35,.3 빛 값을 저장한다(다음 실행부터, scene-config/lighting). off면 지운다
  useEffect(() => {
    if (!PERF_ENABLED || lightParam === undefined) return;
    if (lightParam === 'off') void Storage.removeItem(PERF_LIGHT_KEY);
    else void Storage.setItem(PERF_LIGHT_KEY, lightParam);
  }, [lightParam]);
  // 측정 번들: ?skin=선반,틀,벽지 스킨을 저장한다(다음 실행부터, scene-config/skin). off면 지운다
  useEffect(() => {
    if (!PERF_ENABLED || uiBgParam === undefined) return;
    if (uiBgParam === 'off') void Storage.removeItem(PERF_UI_BG_KEY);
    else void Storage.setItem(PERF_UI_BG_KEY, `#${uiBgParam}`);
  }, [uiBgParam]);
  // 측정 번들: ?wallbg=FFFFFF 책장 벽지 색을 저장한다(다음 실행부터, scene-config/palette). off면 지운다
  useEffect(() => {
    if (!PERF_ENABLED || wallBgParam === undefined) return;
    if (wallBgParam === 'off') void Storage.removeItem(PERF_WALL_KEY);
    else void Storage.setItem(PERF_WALL_KEY, `#${wallBgParam}`);
  }, [wallBgParam]);
  useEffect(() => {
    if (!PERF_ENABLED || skinParam === undefined) return;
    if (skinParam === 'off') void Storage.removeItem(PERF_SKIN_KEY);
    else void Storage.setItem(PERF_SKIN_KEY, skinParam);
  }, [skinParam]);
  // 측정 번들: ?look=거리,눈높이,판 두께,그늘 높이,그늘 세기,테 반지름,곡면 반지름,꼭지점 둥글기,옆면 범위,옆면 세기,판 윤기,꼭지점 그늘,번짐 폭,구멍 모서리 움푹 파인 책장의 구도와 모서리를 저장한다(다음 실행부터, scene-config/skin). off면 지운다
  useEffect(() => {
    if (!PERF_ENABLED || lookParam === undefined) return;
    if (lookParam === 'off') void Storage.removeItem(PERF_LOOK_KEY);
    else void Storage.setItem(PERF_LOOK_KEY, lookParam);
  }, [lookParam]);
  useEffect(() => {
    if (!PERF_ENABLED || demoboot === undefined) return;
    const kind = demoKindOf(demoboot);
    void Storage.setItem(DEMO_BOOT_KEY, kind ? demoboot : '0');
    placementStore.setDemo(!!kind, kind ?? 'sample');
  }, [demoboot]);
  useEffect(() => {
    if (!PERF_ENABLED || lt === undefined) return;
    setLightOff(lt);
    setPerfKey((k) => k + 1);
  }, [lt]);
  useEffect(() => {
    if (!PERF_ENABLED || !sh || !SHELF_MODES.includes(sh as ShelfMode)) return;
    setShelfMode(sh as ShelfMode);
    setPerfKey((k) => k + 1);
  }, [sh]);
  useEffect(() => {
    if (!PERF_ENABLED || sv === undefined) return;
    const v = SHELF_VIEWS[Number(sv)];
    if (!v) return;
    setShelfView(v);
    setShelfViewState(v);
    setPerfKey((k) => k + 1);
  }, [sv]);
  useEffect(() => {
    if (!PERF_ENABLED || !lv) return;
    setPerfLevel(lv as PerfLevel);
    setPerfKey((k) => k + 1);
  }, [lv]);
  const perfOn = useSharedValue(false);
  const perfDts = useSharedValue<number[]>([]);
  // 시간표용 프레임 시각(Date.now, JS 사건과 같은 시계). 놓은 뒤 자리 잡는 동안까지 이어서 적는다
  const perfStamps = useSharedValue<number[]>([]);
  const perfFrames = useFrameCallback((fi) => {
    if (fi.timeSincePreviousFrame === null) return;
    if (perfOn.value) {
      const dt = fi.timeSincePreviousFrame;
      perfDts.modify((a) => {
        'worklet';
        a.push(dt);
        return a;
      });
    }
    if (tlOn.value) {
      const now = Date.now();
      perfStamps.modify((a) => {
        'worklet';
        a.push(now);
        return a;
      });
    }
  }, false);
  const perfCommit = useRef<{ t0: number; done: (ms: number) => void } | null>(null);
  useEffect(() => {
    const c = perfCommit.current;
    if (!c) return;
    perfCommit.current = null;
    c.done(performance.now() - c.t0);
  }, [view.pitch]);
  // 책 끌기 한 번(집기 ~ 놓고 자리 잡기)의 프레임 간격
  // 측정 번들: 시간표 세션(끌기·되돌리기). 끝내면 3.5초 뒤(놓은 뒤 자리 잡는 동안까지) 한 번에 낸다. 그 사이 새 세션이 시작되면
  // (앞 세션 자료는 새 세션이 비웠다) 앞 세션의 타이머는 아무것도 하지 않는다: 새 세션 도중에 시간표를 끄지 않게.
  const tlSession = useRef(0);
  const tlFlushLater = () => {
    const s = tlSession.current;
    tasks.later('trace-end', () => {
      if (tlSession.current !== s) return;
      tl('tl-end');
      tlOn.value = false;
      tasks.later('trace-flush', () => {
        if (tlSession.current !== s) return;
        perfFrames.setActive(false);
        TL.on = false;
        logChunks('[mv-js]', TL.js);
        logChunks('[mv-ui]', tlEv.value);
        logChunks('[mv-fr]', perfStamps.value.map(String));
        TL.js = [];
      }, 150);
    }, 3500);
  };
  useLayoutEffect(() => () => {
    cancelAnimationFrame(dragJs.current.raf);
    dragJs.current.raf = 0;
    tlOn.value = false;
    TL.on = false;
    perfFrames.setActive(false);
  }, [perfFrames, tlOn]);
  const dragPerfStart = () => {
    tlSession.current += 1;
    perfDts.value = [];
    perfStamps.value = [];
    tlEv.value = [];
    TL.js = [];
    TL.on = true;
    tlOn.value = true;
    tl(`drag-start ${dragRef.current?.bookId ?? ''}@${dragRef.current?.shelfId ?? ''}`);
    perfFrames.setActive(true);
    perfOn.value = true;
    const j = dragJs.current;
    j.preview = [];
    j.commit = [];
    j.js = [];
    j.last = performance.now();
    lastPlan.log = [];
    const tick = () => {
      const now = performance.now();
      j.js.push(now - j.last);
      j.last = now;
      j.raf = requestAnimationFrame(tick);
    };
    j.raf = requestAnimationFrame(tick);
  };
  const dragPerfStop = () => {
    perfOn.value = false;
    const j = dragJs.current;
    cancelAnimationFrame(j.raf);
    const ms = (a: number[]) => ({ n: a.length, mean: a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0, max: a.length ? +Math.max(...a).toFixed(1) : 0 });
    console.log('[perf-drag]', JSON.stringify({ ...frameStats(perfDts.value), js: frameStats(j.js), preview: ms(j.preview), commit: ms(j.commit), plan: ms(lastPlan.log ?? []) }));
    lastPlan.log = null;
    // 시간표: 놓은 뒤 자리 잡는 동안(3.5초)까지 적고 한 번에 낸다
    tl('drag-stop');
    tlFlushLater();
  };
  // 측정 번들: 되돌리기 한 번의 시간표(끌기 시간표가 아직 켜져 있으면 거기에 이어 적는다). 되돌리기는 손가락 없이 저절로 가는 경로라
  // '자동 이동 경로'를 따로 잰다.
  const undoPerfStart = (ids: string) => {
    if (TL.on) {
      tl(`undo ${ids}`);
      return;
    }
    tlSession.current += 1;
    perfStamps.value = [];
    tlEv.value = [];
    TL.js = [];
    TL.on = true;
    tlOn.value = true;
    tl(`undo ${ids}`);
    perfFrames.setActive(true);
    tlFlushLater();
  };
  const runPerf = async (level: PerfLevel) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const record = async (ms: number) => {
      perfDts.value = [];
      perfFrames.setActive(true);
      perfOn.value = true;
      await wait(ms);
      perfOn.value = false;
      perfFrames.setActive(false);
      return frameStats(perfDts.value);
    };
    setPerfLevel(level);
    setPerfKey((k) => k + 1);
    viewStore.setPitch(VIEW_PITCH_MIN);
    pitchSV.value = VIEW_PITCH_MIN;
    viewGoal.value = VIEW_PITCH_MIN;
    await wait(3000);
    const idle = await record(1000);
    const ease = { duration: 900, easing: Easing.inOut(Easing.cubic) };
    pitchSV.value = withRepeat(withSequence(withTiming(VIEW_PITCH_MAX, ease), withTiming(VIEW_PITCH_MIN, ease)), 2, false);
    const sweep = await record(3700);
    const benchRows: BenchRow[] = rows.flatMap((r) => {
      const mo = motions.find((entry) => entry.shelfId === r.shelfId)?.m;
      return mo ? [{ m: mo, px: rowAffine(m, r, 0), space: r.space }] : [];
    });
    const s = m.scale;
    const calc = await new Promise<ReturnType<typeof benchProjection>>((resolve) => {
      scheduleOnUI(() => {
        'worklet';
        const r = benchProjection(benchRows, s, 30);
        scheduleOnRN(resolve, r);
      });
    });
    // 시점을 8°로 확정: 터치 영역·줄 높이 다시 계산(React) + 그 뒤 UI 스레드
    pitchSV.value = VIEW_PITCH_MAX;
    const react = new Promise<number>((resolve) => {
      perfCommit.current = { t0: performance.now(), done: resolve };
    });
    const afterP = record(1200);
    viewStore.setPitch(VIEW_PITCH_MAX);
    const reactMs = await react;
    const after = await afterP;
    const out = { level, idle, sweep, calc, reactMs: Math.round(reactMs), after };
    console.log('[perf]', JSON.stringify(out));
    setToast({ text: `${level} 전환 ${sweep.mean}ms(p90 ${sweep.p90}) 계산 ${(calc.faces + calc.cast).toFixed(1)}ms React ${Math.round(reactMs)}ms` });
    viewStore.setPitch(VIEW_PITCH_MIN);
    pitchSV.value = VIEW_PITCH_MIN;
    viewGoal.value = VIEW_PITCH_MIN;
  };
  const runPerfRef = useRef(runPerf);
  runPerfRef.current = runPerf;

  return { perfKey, setPerfKey, shelfView, setShelfViewState, camDebug, camNow, mark, mat, dragPerfStart, dragPerfStop, undoPerfStart, runPerf };
}
