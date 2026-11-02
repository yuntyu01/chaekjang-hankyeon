// 갈피 보드 배치(순수, 2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 좌표는 보드 dp, 자리는 카드 중심.
// 새 갈피는 자동으로 놓이고(만든 순서로 두 줄에 번갈아) 손으로 옮긴 갈피만 저장된 자리(boardX·boardY·boardRot)를 쓴다.
// 자동 자리는 앞선 갈피들로만 정해지므로 뒤에 갈피가 늘어도 이미 놓인 갈피는 움직이지 않는다. 손으로 옮긴 갈피의 칸은 비워 둔다(옮겼다고 다른 갈피가 밀려 오지 않게).
import type { Bookmark } from './library';

export const BOARD_CARD_W = 216;
const COLUMN_GAP = 34;
const ROW_GAP = 30;
const JITTER_X = 14;
const JITTER_Y = 8;
const MAX_ROT = 3.2;
export const BOARD_MIN_SCALE = 0.3;
export const BOARD_MAX_SCALE = 2.6;
// 글자 칸 추정(높이를 재기 전 배치에 쓴다): 명조 18/29, 안쪽 여백 포함
const LINE_H = 29;
const CHARS_PER_LINE = 11.5;
export const BOARD_MAX_LINES = 7;

export type BoardRect = { x: number; y: number; w: number; h: number };
export type BoardSpot = BoardRect & { id: string; rot: number; placed: boolean };
export type BoardView = { x: number; y: number; s: number }; // 화면 = 보드 × s + (x, y)

function hash(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007; // 0 ~ 1
}
// 갈피마다 정해진 기울기(도): 다시 열어도 같다
export const boardRotOf = (id: string) => (hash(id, 1) * 2 - 1) * MAX_ROT;

// 카드 크기(추정): 사진은 인화지 모양, 글은 줄 수만큼. 실제 높이는 그려 본 뒤 재지만, 자동 자리는 이 값으로 정해 재는 순서에 흔들리지 않게 한다
export function boardCardSize(m: Pick<Bookmark, 'text' | 'photoUri' | 'photoRatio'>) {
  if (m.photoUri) {
    const r = Math.max(0.9, Math.min(1.5, m.photoRatio && m.photoRatio > 0 ? m.photoRatio : 1.3));
    return { w: BOARD_CARD_W, h: Math.round((BOARD_CARD_W - 20) / r) + 44 };
  }
  const chars = m.text.replace(/\s+/g, ' ').trim().length;
  const lines = Math.max(2, Math.min(BOARD_MAX_LINES, Math.ceil(chars / CHARS_PER_LINE)));
  return { w: BOARD_CARD_W, h: 68 + lines * LINE_H };
}

const overlaps = (a: BoardRect, b: BoardRect, gap = 6) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;

type BoardMark = Pick<Bookmark, 'id' | 'text' | 'photoUri' | 'photoRatio' | 'createdAt' | 'boardX' | 'boardY' | 'boardRot'>;
const hasSpot = (m: BoardMark) => typeof m.boardX === 'number' && typeof m.boardY === 'number';

export function boardSpots(marks: BoardMark[]): BoardSpot[] {
  const sorted = [...marks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const placed: BoardSpot[] = sorted.filter(hasSpot).map((m) => ({ id: m.id, ...boardCardSize(m), x: m.boardX!, y: m.boardY!, rot: m.boardRot ?? boardRotOf(m.id), placed: true }));
  const out: BoardSpot[] = [...placed];
  const colX = [BOARD_CARD_W / 2, BOARD_CARD_W * 1.5 + COLUMN_GAP];
  const colY = [0, 0];
  sorted.forEach((m) => {
    // 손으로 옮긴 갈피도 제 칸은 차지한다(옮겼다고 다른 갈피가 밀려 오지 않게)
    const size = boardCardSize(m);
    const c = colY[0] <= colY[1] ? 0 : 1;
    const slotY = colY[c] + size.h / 2;
    colY[c] += size.h + ROW_GAP;
    if (hasSpot(m)) return;
    const spot: BoardSpot = { id: m.id, ...size, x: colX[c] + (hash(m.id, 2) * 2 - 1) * JITTER_X, y: slotY + (hash(m.id, 3) * 2 - 1) * JITTER_Y, rot: boardRotOf(m.id), placed: false };
    // 손으로 옮겨 둔 갈피를 덮지 않게 그 아래로 내린다
    let pushed = false;
    for (let guard = 0; guard < placed.length + 1; guard++) {
      const hit = placed.find((p) => overlaps(spot, p));
      if (!hit) break;
      spot.y = hit.y + (hit.h + spot.h) / 2 + ROW_GAP;
      pushed = true;
    }
    if (pushed) colY[c] = Math.max(colY[c], spot.y + spot.h / 2 + ROW_GAP);
    out.push(spot);
  });
  return out;
}

export function boardBounds(spots: BoardRect[]) {
  if (!spots.length) return { x0: 0, y0: 0, x1: BOARD_CARD_W, y1: BOARD_CARD_W };
  return {
    x0: Math.min(...spots.map((s) => s.x - s.w / 2)),
    y0: Math.min(...spots.map((s) => s.y - s.h / 2)),
    x1: Math.max(...spots.map((s) => s.x + s.w / 2)),
    y1: Math.max(...spots.map((s) => s.y + s.h / 2)),
  };
}

// 전체 보기: 모든 갈피가 화면 안에 들어오는 배율·자리(원래 크기보다 키우지는 않는다)
export function boardFit(spots: BoardRect[], vw: number, vh: number, pad = 28): BoardView {
  const b = boardBounds(spots);
  const s = Math.max(BOARD_MIN_SCALE, Math.min(1, (vw - pad * 2) / Math.max(1, b.x1 - b.x0), (vh - pad * 2) / Math.max(1, b.y1 - b.y0)));
  return { s, x: (vw - s * (b.x0 + b.x1)) / 2, y: Math.max(pad, (vh - s * (b.y0 + b.y1)) / 2) };
}

// 보드가 화면 밖으로 사라지지 않게: 갈피가 있는 범위가 화면에 keep만큼은 걸쳐 있도록
export function boardClamp(v: BoardView, bounds: { x0: number; y0: number; x1: number; y1: number }, vw: number, vh: number, keep = 72): BoardView {
  'worklet';
  const s = Math.max(BOARD_MIN_SCALE, Math.min(BOARD_MAX_SCALE, v.s));
  const x = Math.max(keep - s * bounds.x1, Math.min(vw - keep - s * bounds.x0, v.x));
  const y = Math.max(keep - s * bounds.y1, Math.min(vh - keep - s * bounds.y0, v.y));
  return { x, y, s };
}

// 지금 보이는 곳의 빈 자리(+ 갈피): 화면 가운데에서 바깥으로 훑어 다른 갈피와 겹치지 않는 첫 자리, 없으면 가운데
export function boardFreeSpot(spots: BoardRect[], view: BoardView, vw: number, vh: number, size: { w: number; h: number }) {
  const cx = (vw / 2 - view.x) / view.s;
  const cy = (vh / 2 - view.y) / view.s;
  const halfW = Math.max(0, vw / view.s / 2 - size.w / 2);
  const halfH = Math.max(0, vh / view.s / 2 - size.h / 2);
  for (let ring = 0; ring <= 4; ring++) {
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = { x: cx + (Math.cos(a) * ring * halfW) / 4, y: cy + (Math.sin(a) * ring * halfH) / 4, ...size };
      if (!spots.some((o) => overlaps(p, o))) return { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

// 보드 저장 값(기기마다, 마지막 위치·배율): 키
export const boardViewKey = (bookId: string) => `bookmark-board-view:${bookId}`;
