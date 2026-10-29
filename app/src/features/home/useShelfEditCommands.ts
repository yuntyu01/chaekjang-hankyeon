// Editing commands own temporary poses; the screen only supplies scene and persistence adapters.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import { boxOf, depthRange, frontRelease, frontSpin, frontStateOf, frontTilt, placementOf, setDepth, setPose, setSpin, setTilt, type BookMap, type Result } from '@/domain/layout-engine';
import { computeShelf, resolveLeans, withLeans } from '@/domain/shelf-scene';
import { tiltToward, type Pose, type ShelfLayout } from '@/domain/types';
import type { FrontState } from '@/domain/front-pose';
import type { SceneMotion } from '@/ui/shelf/scene';
import { displayedPoses, previewInto, settleInto, type Drops } from '@/ui/shelf/planner';
import { PERF_ENABLED } from '@/ui/perf';
import { ko } from '@/i18n/ko';

type Options = {
  layout: ShelfLayout;
  books: BookMap;
  editId: string | null;
  motions: SceneMotion[];
  scale: number;
  reduceMotion: boolean;
  settled: boolean;
  commit: (result: Result) => string | null;
  getCommittedLayout: () => ShelfLayout;
  getFallDirections: () => Readonly<Record<string, -1 | 1>>;
  setEditId: (id: string | null) => void;
  setEditMsg: (message: string | null) => void;
};

export function useShelfEditCommands({ layout, books, editId, motions, scale, reduceMotion, settled, commit, getCommittedLayout, getFallDirections, setEditId, setEditMsg }: Options) {
  // 자세·기울기 바꾸기: 제자리에서 돌 수 없으면(옆 책에 걸리면) 경로 계획이 선반 앞으로 빼서 돌려 넣는다(planner).
  const commitPath = commit;
  const leanRef = useRef<boolean | undefined>(undefined);
  const previewedShelf = useRef<string | null>(null);
  // 조작 중 미리보기(손잡이·앞뒤·돌리기): 그 선반 경로만 바로 바꾼다. restore = 확정 배치로.
  const motionOf = (shelfId: string) => motions.find((e) => e.shelfId === shelfId)?.m;
  // 한 선반의 프레임: 확정할 때와 같은 계산(기대기 결과 반영)이라 놓은 뒤 다시 움직이지 않는다
  const shelfFrames = (l: ShelfLayout, shelfId: string) => computeShelf(withLeans(l, books, shelfId), books, shelfId).frames;
  const previewShelf = (shelfId: string, l: ShelfLayout, follow = false) => {
    const mo = motionOf(shelfId);
    previewedShelf.current = shelfId;
    if (mo) previewInto(mo, shelfId, shelfFrames(l, shelfId), reduceMotion || !settled, follow);
  };
  // 조작을 마칠 때: 확정한 배치(실패면 조작 전 배치)로 맞춘다. 미리보기 자세가 남지 않게.
  // 그 조작으로 이 줄에서 서랍으로 간 책(받침을 잃거나 선반 앞 끝에서 떨어짐)은 보이던 자세에서 떨어지며 사라진다(줄 경로가 여기서 정해진다)
  const settleShelf = (shelfId: string, l: ShelfLayout) => {
    if (previewedShelf.current === shelfId) previewedShelf.current = null;
    const mo = motionOf(shelfId);
    if (!mo) return;
    const resolved = resolveLeans(l, books, shelfId);
    const lw = resolved.layout;
    const poses = displayedPoses(mo);
    const drops: Drops = {};
    for (const q of layout.placements) {
      const pose = poses[q.bookId];
      if (q.shelfId === shelfId && pose && lw.drawer.includes(q.bookId)) drops[q.bookId] = { from: pose, d: q.pose === 'front' ? 0 : (resolved.falls[q.bookId] ?? getFallDirections()[q.bookId] ?? (Math.sign(pose.roll) || Math.sign(q.tilt) || 1) as -1 | 1) };
    }
    settleInto(mo, shelfId, computeShelf(lw, books, shelfId).frames, reduceMotion || !settled, drops);
  };

  // 꾸미기 조작부: 자세와 기대기(방향만 고르고 각도는 옆 책과의 틈으로)
  const editPlacement = editId ? placementOf(layout, editId) ?? null : null;
  const editDisplayPose = editPlacement?.pose === 'front' && (editPlacement.pitch ?? 0) >= 89.95 ? 'horizontal' : editPlacement?.pose ?? null;
  const canLean = useMemo(() => {
    const out = { [-1]: false, 1: false } as { [-1]: boolean; 1: boolean };
    if (!editId || editPlacement?.pose !== 'spine') return out;
    for (const d of [-1, 1] as const) {
      if (Math.sign(editPlacement.tilt) === d) {
        out[d] = true;
        continue;
      }
      const r = setTilt(layout, books, editId, tiltToward(d));
      // 기울인 책이 실제로 기대야 한다. 기울인 탓에 이 책이나 다른 책이 넘어져 서랍으로 가는 기울기도 막는다
      // (예: 낮게 누운 책 모서리에 기대면 미는 힘에 미끄러져 옆 책까지 무너진다)
      const after = r.ok ? withLeans(r.layout, books) : null;
      out[d] = !!after && (placementOf(after, editId)?.tilt ?? 0) !== 0 && after.drawer.length === layout.drawer.length;
    }
    return out;
  }, [editId, editPlacement, layout, books]);
  const editPose = (pose: Pose) => {
    if (!editId || editDisplayPose === pose) return;
    setEditMsg(commitPath(setPose(layout, books, editId, pose)));
  };
  const editLean = (d: -1 | 0 | 1) => {
    if (!editId || !editPlacement || Math.sign(editPlacement.tilt) === d) return;
    setEditMsg(commitPath(setTilt(layout, books, editId, tiltToward(d))));
  };
  // ---------- 표지 책 머리 손잡이: 위아래 = 뒤로 젖히기, 좌우 = 돌리기 ----------
  // 각도 = 기준 각도 + 비율 × (손잡이를 잡은 지점에서 끈 거리의 축 방향 성분). 기준은 잡을 때의 지금 각도.
  // 4dp만 움직여도 주된 방향으로 축을 정하고 그 뒤로 고정한다(정하는 사이 움직인 만큼도 이어서 반영되어, 한꺼번에 따라잡지 않는다).
  // 옆 책·벽에 막혀 원하는 각도까지 못 가면 그 손가락 자리를 새 기준으로 삼는다: 더 끌어도 쌓이지 않고 되돌리면 바로 줄어든다.
  // 끄는 동안 각도는 경로를 다시 짜지 않고 바로 그 자세로(previewShelf follow), 손잡이는 실제로 된 각도만큼 축 방향으로 손가락을 따라간다.
  // 놓으면 한 번에 확정(되돌리기 한 번)하고 손잡이는 머리 위로 돌아간다.
  const headRef = useRef<{ id: string; shelfId: string; qx: number; start: FrontState; cur: FrontState; axis: 'tilt' | 'spin' | null; base: { d: number; a: number }; last: ShelfLayout | null; dx: number; dy: number; raf: number } | null>(null);
  const [headLive, setHeadLive] = useState<FrontState | null>(null);
  // 손잡이 표시를 머리 위 제자리에서 옮길 거리(dp, 끄는 동안만)
  const headOffX = useSharedValue(0);
  const headOffY = useSharedValue(0);
  const TILT_PER_DU = 0.35; // 머리를 1DU 밀면 0.35° 젖힘(20°에 약 57DU)
  const SPIN_PER_DU = 0.9; // 좌우 1DU에 0.9°(표지 책은 ±90°까지 돈다: 90°에 100DU)
  const AXIS_DP = 4;
  const headStep = () => {
    const h = headRef.current;
    if (!h) return;
    h.raf = 0;
    if (!h.axis) {
      if (Math.hypot(h.dx, h.dy) < AXIS_DP) return;
      h.axis = Math.abs(h.dx) > Math.abs(h.dy) ? 'spin' : 'tilt';
      h.base = { d: 0, a: h.axis === 'tilt' ? h.start.pitch : h.start.spin };
    }
    const tilt = h.axis === 'tilt';
    const gain = tilt ? TILT_PER_DU : SPIN_PER_DU;
    const d = (tilt ? -h.dy : h.dx) / scale; // 잡은 지점에서 축 방향으로 끈 거리(DU, 위·오른쪽이 +)
    const want = h.base.a + (d - h.base.d) * gain;
    const r = tilt ? frontTilt(layout, books, h.id, h.cur, h.qx, want) : frontSpin(layout, books, h.id, h.cur, h.qx, want);
    if (!r) return;
    const got = tilt ? r.state.pitch : r.state.spin;
    // 돌리기는 0 근처에서 살짝 붙는다(frontSpin): 그만큼은 막힌 것이 아니다
    const aim = !tilt && Math.abs(want) < 0.8 ? 0 : want;
    if (Math.abs(got - aim) > 0.05) h.base = { d, a: got };
    h.cur = r.state;
    h.last = r.layout;
    previewShelf(h.shelfId, r.layout, true);
    setHeadLive(r.state);
    const off = ((got - (tilt ? h.start.pitch : h.start.spin)) / gain) * scale;
    headOffX.value = tilt ? 0 : off;
    headOffY.value = tilt ? -off : 0;
    // 측정 번들: 손가락 → 각도 → 손잡이가 이어지는지(끈 거리 dp, 원한 각도, 실제 각도, 손잡이 이동 dp)
    if (PERF_ENABLED) console.log('[handle]', h.axis, (tilt ? -h.dy : h.dx).toFixed(1), want.toFixed(2), got.toFixed(2), off.toFixed(1));
  };
  const headStepRef = useRef(headStep);
  headStepRef.current = headStep;
  const onHandle = (phase: 'begin' | 'move' | 'end' | 'cancel', dx: number, dy: number) => {
    if (phase === 'begin') {
      const f = editId ? frontStateOf(layout, books, editId) : null;
      const shelfId = editId ? placementOf(layout, editId)?.shelfId : undefined;
      headRef.current = f && editId && shelfId ? { id: editId, shelfId, qx: f.qx, start: f.state, cur: f.state, axis: null, base: { d: 0, a: 0 }, last: null, dx: 0, dy: 0, raf: 0 } : null;
      headOffX.value = 0;
      headOffY.value = 0;
      setEditMsg(null);
      return;
    }
    if (phase === 'cancel') { cancelEditingPreview(true); return; }
    const h = headRef.current;
    if (!h) return;
    if (phase === 'move') {
      h.dx = dx;
      h.dy = dy;
      if (!h.raf) h.raf = requestAnimationFrame(() => headStepRef.current());
      return;
    }
    cancelAnimationFrame(h.raf);
    if (h.raf) headStep(); // Apply the final queued pointer position before committing.
    headRef.current = null;
    setHeadLive(null);
    const back = { duration: reduceMotion ? 0 : 180, easing: Easing.out(Easing.cubic) };
    headOffX.value = withTiming(0, back);
    headOffY.value = withTiming(0, back);
    if (!h.last) return;
    // 받침을 잃으면 무게중심에 따라 넘어져 벽·책·바닥에서 멈춘 자세를 저장한다. 끄는 동안 마지막 배치(돌리며 비킨 옆 책 자리)에서 시작한다
    const fin = frontRelease(h.last, books, h.id, h.cur, h.qx);
    const err = fin ? commitPath({ ok: true, layout: fin }) : ko.fail['no-space'];
    settleShelf(h.shelfId, fin && !err ? fin : layout);
    // 선반 앞 끝 밖으로 떨어진 책은 서랍으로 간다(받침을 잃은 세운 책과 같은 알림. 꾸미는 중이라 알림 대신 조작부에)
    const before = new Set(h.last.drawer);
    const fell = err ? 0 : getCommittedLayout().drawer.filter((id) => !before.has(id)).length;
    if (fell && !placementOf(getCommittedLayout(), h.id)) setEditId(null);
    setEditMsg(err ?? (fell ? ko.fellToDrawer(fell) : null));
  };
  const frontInfo = useMemo(() => (editId ? frontStateOf(layout, books, editId) : null), [editId, layout, books]);
  const anglesText = frontInfo ? ko.decoratePanel.angles((headLive ?? frontInfo.state).spin, (headLive ?? frontInfo.state).pitch) : null;

  // 앞뒤: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 옆 책·벽에 닿으면 가능한 데까지. 실제로 된 깊이를 돌려준다.
  const editDepth = (z: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = boxOf(layout, books, editId)?.z ?? 0;
    // 끄는 동안은 직전 미리보기의 벽 기대기 상태를 이어받는다(경계 여유가 한 번의 끌기 안에서도 작동하게)
    const r = setDepth(layout, books, editId, z, leanRef.current);
    const leaned = r.ok ? placementOf(r.layout, editId) : undefined;
    leanRef.current = done ? undefined : r.ok ? !!(leaned?.wallLean || (leaned?.pitch ?? 0) > 0) : leanRef.current;
    const got = r.ok ? boxOf(r.layout, books, editId)?.z ?? cur : cur;
    const limited = Math.abs(got - z) >= 1;
    if (!done) {
      if (shelfId) previewShelf(shelfId, r.ok ? r.layout : layout);
      setEditMsg(limited ? ko.decoratePanel.depthLimit : null);
      return got;
    }
    const err = r.ok ? commitPath(r) : null;
    if (shelfId) settleShelf(shelfId, r.ok && !err ? r.layout : layout);
    if (!r.ok) {
      setEditMsg(r.reason === 'no-change' ? null : ko.decoratePanel.depthLimit);
      return cur;
    }
    setEditMsg(err ?? (limited ? ko.decoratePanel.depthLimit : null));
    return err ? cur : got;
  };
  const depthInfo = useMemo(() => (editId && placementOf(layout, editId) ? depthRange(layout, books, editId) : null), [editId, layout, books]);
  // 돌리기: 끄는 동안은 그 선반 경로만 바로 바꾸고(미리보기) 놓으면 확정한다. 실제로 된 각도를 돌려준다.
  const editSpin = (deg: number, done: boolean): number => {
    if (!editId) return 0;
    const shelfId = placementOf(layout, editId)?.shelfId;
    const cur = placementOf(layout, editId)?.spin ?? 0;
    const fs = frontStateOf(layout, books, editId);
    const fr = fs ? frontSpin(layout, books, editId, fs.state, fs.qx, deg) : null;
    const r: Result = fs ? (fr && Math.abs(fr.state.spin - cur) > 0.01 ? { ok: true, layout: fr.layout } : { ok: false, reason: fr ? 'no-change' : 'no-space' }) : setSpin(layout, books, editId, deg);
    const got = r.ok ? placementOf(r.layout, editId)?.spin ?? 0 : cur;
    // 원한 만큼 못 돌면(옆 책·쌓인 책·선반 깊이에 막힘) 어디까지 되는지 알려 준다
    const limited = Math.abs(deg) >= 1 && Math.abs(got - deg) >= 1;
    const limitMsg = limited ? ko.decoratePanel.spinLimit(Math.round(got)) : null;
    if (!done) {
      if (!shelfId) return got;
      previewShelf(shelfId, r.ok ? r.layout : layout, true);
      setEditMsg(limitMsg);
      return got;
    }
    const err = r.ok ? commitPath(r) : null;
    if (shelfId) settleShelf(shelfId, r.ok && !err ? r.layout : layout);
    if (!r.ok) {
      setEditMsg(r.reason === 'no-change' ? limitMsg : ko.fail[r.reason] || null);
      return cur;
    }
    setEditMsg(err ?? limitMsg);
    return err ? cur : got;
  };
  const cancelEditingPreview = (render: boolean) => {
    if (headRef.current?.raf) cancelAnimationFrame(headRef.current.raf);
    headRef.current = null;
    leanRef.current = undefined;
    headOffX.value = 0;
    headOffY.value = 0;
    if (previewedShelf.current) settleShelf(previewedShelf.current, getCommittedLayout());
    if (render) setHeadLive(null);
  };
  const cancelRef = useRef(cancelEditingPreview);
  cancelRef.current = cancelEditingPreview;
  useLayoutEffect(() => {
    setHeadLive(null);
    return () => cancelRef.current(false);
  }, [editId]);
  useFocusEffect(useCallback(() => () => cancelRef.current(true), []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') cancelRef.current(true); });
    return () => sub.remove();
  }, []);
  return { editPlacement, editDisplayPose, canLean, editPose, editLean, onHandle, headOffX, headOffY, anglesText, editDepth, depthInfo, editSpin };
}
