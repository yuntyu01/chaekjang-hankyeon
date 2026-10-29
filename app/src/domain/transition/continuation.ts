// 진행 중인 경로 이어 붙이기: 시간·선반 좌표 변환과 보정값 검증.
import { type Track, bookAt, type Off, OFF_T } from '../transition-track';
import { type Book3, xRange, gap } from '../book3';
import { MARGIN } from './collision';

// 경로 전체를 세로로 dy만큼 옮긴 것(다른 줄 좌표로 볼 때: 줄 사이는 세로 거리만 다르다)
export function shiftTrack(tr: Track, dy: number): Track {
  const segs = tr.segs.map((s) => (s.kind === 1 ? { ...s, b0: s.b0 + dy, b1: s.b1 + dy } : { ...s, w0: { ...s.w0, y: s.w0.y + dy }, w1: { ...s.w1, y: s.w1.y + dy } }));
  return { ...tr, segs, rest: tr.rest ? { ...tr.rest, t: { ...tr.rest.t, y: tr.rest.t.y + dy } } : undefined };
}

export const AWAY_SKEW = 8; // 줄 간격을 줄 때 떠날 때 자세와 도착 줄 경로 출발 자세의 가로·깊이 허용(DU)

// 다른 줄로 떠난 책이 떠난 줄에 남기는 그림자 경로(떠난 줄 좌표): 도착 줄 경로 tr을 세로로 옮겨 출발 자세가 떠날 때 자세 src와 같게 한다.
// k: 실제 시간 비율 u(0~1, 진행은 ease(u))에서 그 줄에 그림자가 더는 없는(gone) 첫 u. 끝까지 남으면 1.
// dy: 도착 줄 좌표 → 떠난 줄 좌표(세로만 다르다). 도착 줄이 경로를 다시 짜면 같은 dy로 새 경로를 옮겨 이어 간다(awayShift).
// 출발 자세가 가로·깊이로 어긋나면(같은 책의 경로가 아니면) null.
// pitch(줄 간격)를 주면 줄 사이 거리를 줄 간격의 정수배로 맞추고, 가로·깊이 허용을 넓힌다: 도착 줄 경로의 출발 자세(화면 그릴 때 읽음)와
// 떠날 때 자세(경로를 짤 때 읽음)는 읽은 때가 몇 ms 달라, 움직이던 책이면 그만큼 어긋난다(그 차이는 UI가 이어 주기로 메운다).
export function awayTrack(tr: Track, src: Book3, ease: (u: number) => number, gone: (b: Book3) => boolean, pitch?: number): { track: Track; k: number; dy: number } | null {
  const start = bookAt(tr, 0);
  const tol = pitch ? AWAY_SKEW : 0.5;
  if (Math.abs(start.t.x - src.t.x) > tol || Math.abs(start.t.z - src.t.z) > tol) return null;
  const dy = pitch ? Math.round((src.t.y - start.t.y) / pitch) * pitch : src.t.y - start.t.y;
  const a = awayShift(tr, dy, ease, gone);
  return a ? { ...a, dy } : { track: shiftTrack(tr, dy), k: 0, dy };
}

// 이미 떠난 책의 새 경로(도착 줄이 경로를 다시 짰을 때, 또는 다른 줄로 다시 떠났을 때)를 떠난 줄 좌표로 옮긴 것.
// 경로 출발 자세가 이미 그 줄에 그림자가 없는 곳이면 null(그 줄에서 거둔다). k는 awayTrack과 같다.
export function awayShift(tr: Track, dy: number, ease: (u: number) => number, gone: (b: Book3) => boolean): { track: Track; k: number } | null {
  const track = shiftTrack(tr, dy);
  if (gone(bookAt(track, 0))) return null;
  for (let i = 1; i <= 48; i++) if (gone(bookAt(track, ease(i / 48)))) return { track, k: i / 48 };
  return { track, k: 1 };
}

// 기준 시간으로 짠 트랙을 경로 길이 [0, 1]로 줄인 것과 그 길이(1보다 짧으면 1)
export function normalized(tracks: Track[]): { tracks: Track[]; len: number } {
  let len = 1;
  for (const tr of tracks) if (tr.moving) for (const s of tr.segs) len = Math.max(len, s.t1);
  if (len <= 1 + 1e-9) return { tracks, len: 1 };
  return { tracks: tracks.map((tr) => (tr.moving ? { ...tr, segs: tr.segs.map((s) => ({ ...s, t0: s.t0 / len, t1: s.t1 / len })) } : tr)), len };
}

// 움직이던 경로를 지금(진행 tc)부터 이어 가는 트랙: 시각을 tc만큼 당기고 k배로 늘린다(k = 예전 경로 길이 / 새 기준 시간, 줄 시계가 둘 다 고를 때
// 자세와 빠르기가 그대로 이어진다). 이미 지나간 조각은 버린다(지나가는 조각은 출발이 0보다 앞).
export function retime(tr: Track, tc: number, k: number): Track {
  const segs = tr.segs.map((s) => ({ ...s, t0: (s.t0 - tc) * k, t1: (s.t1 - tc) * k }));
  let i = 0;
  while (i < segs.length - 1 && segs[i].t1 <= 0) i++;
  return { id: tr.id, dims: tr.dims, segs: segs.slice(i), moving: true };
}

// ---------- 이어 주기도 충돌 검사 안에 ----------
// 이어 주기(off)는 UI가 적용하는 순간에 더하므로 계획 때 한 충돌 검사 밖이다. 더한 앞부분(t < OFF_T)에서 두 책이 겹치면(원래 경로로는
// 안 겹치는데) 그 차이를 반씩 줄이고, 세 번 줄여도 겹치면 이어 주기를 버린다(한 프레임 조금 튀는 쪽이 책끼리 파고드는 것보다 낫다).
// base: 이어 주기를 더하기 전 트랙들(같은 열쇠).
const OFF_CHECKS = 8;

function scaledOff(o: Off, k: number): Off {
  'worklet';
  return { x: o.x * k, y: o.y * k, z: o.z * k, roll: o.roll * k, yaw: o.yaw * k, spin: o.spin * k, pitch: o.pitch * k };
}

export function safeOffsets(rec: Record<string, Track>, base: Record<string, Track>): Record<string, Track> {
  'worklet';
  const ids = Object.keys(rec);
  let has = false;
  for (const id of ids) if (rec[id].off) has = true;
  if (!has) return rec;
  let out = rec;
  for (let round = 0; round < 4; round++) {
    let bad: Record<string, boolean> | null = null;
    for (let k = 0; k < OFF_CHECKS; k++) {
      const t = (OFF_T * k) / OFF_CHECKS;
      const bs: Book3[] = [];
      const rs: { lo: number; hi: number }[] = [];
      for (const id of ids) {
        const b = bookAt(out[id], t);
        bs.push(b);
        rs.push(xRange(b));
      }
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const oi = out[ids[i]].off;
          const oj = out[ids[j]].off;
          if (!oi && !oj) continue;
          if (rs[i].hi < rs[j].lo - 1 || rs[j].hi < rs[i].lo - 1) continue;
          if (gap(bs[i], bs[j]) >= -MARGIN) continue;
          if (gap(bookAt(base[ids[i]] ?? out[ids[i]], t), bookAt(base[ids[j]] ?? out[ids[j]], t)) < -MARGIN) continue; // 원래 경로부터 맞닿게 짠 곳
          if (!bad) bad = {};
          if (oi) bad[ids[i]] = true;
          if (oj) bad[ids[j]] = true;
        }
    }
    if (!bad) return out;
    const next: Record<string, Track> = {};
    for (const id of ids) {
      const tr = out[id];
      if (!bad[id] || !tr.off) next[id] = tr;
      else if (round < 3) next[id] = { id: tr.id, dims: tr.dims, segs: tr.segs, moving: true, off: scaledOff(tr.off, 0.5) };
      else next[id] = base[id] ?? { id: tr.id, dims: tr.dims, segs: tr.segs, moving: tr.moving };
    }
    out = next;
  }
  return out;
}
