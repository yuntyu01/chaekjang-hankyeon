// 독서 기록 수정 화면의 입력 → 바꿀 필드만 담은 수정(updateSessionIn에 넘긴다).
// 화면은 날짜·시작 시각을 분 단위, 독서 시간을 분으로 보여 주지만, 사용자가 그 칸을 고치지 않았으면 저장된 값(초·일시정지 구간)을 그대로 둔다.
// - 날짜·시각을 고치면 시작·끝을 같은 만큼 옮긴다(시작~끝 사이 일시정지 구간 길이 보존, 초 단위 그대로).
// - 독서 시간을 고치면 실제 독서 시간만 바꾸고, 끝 시각은 시작 + 새 시간이 기존 끝보다 늦을 때만 늦춘다.
// - 책: 고르지 않았으면 키를 넣지 않고(그대로), 연결을 끊었으면 myBookId: undefined(명시적 해제).
import type { Session } from './library';
import type { SessionPatch } from './library';

export type SessionForm = { bookId?: string; day: string; time: string; minutes: string; pages: string; memo: string };

const pad = (n: number) => String(n).padStart(2, '0');
function localParts(iso: string) {
  const d = new Date(iso);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function sessionFormOf(s: Session): SessionForm {
  const { day, time } = localParts(s.startedAt);
  return { bookId: s.myBookId, day, time, minutes: String(Math.max(1, Math.round(s.durationMs / 60000))), pages: s.pagesRead ? String(s.pagesRead) : '', memo: s.memo ?? '' };
}

export const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const validTime = (v: string) => /^\d{1,2}:\d{2}$/.test(v);

function localMs(day: string, time: string) {
  const [yy, mo, dd] = day.split('-').map(Number);
  const [hh, mi] = time.split(':').map(Number);
  return new Date(yy, mo - 1, dd, hh, mi).getTime();
}

// 고친 칸만 수정에 넣는다. 고친 칸이 형식에 맞지 않으면 null(저장 막기)
export function sessionEditPatch(s: Session, initial: SessionForm, form: SessionForm): SessionPatch | null {
  const patch: SessionPatch = {};
  if (form.bookId !== initial.bookId) patch.myBookId = form.bookId;
  let start = Date.parse(s.startedAt);
  let end = Date.parse(s.endedAt);
  if (form.day !== initial.day || form.time !== initial.time) {
    if (!validDay(form.day) || !validTime(form.time)) return null;
    const delta = localMs(form.day, form.time) - localMs(initial.day, initial.time);
    if (!Number.isFinite(delta)) return null;
    if (delta) {
      start += delta;
      end += delta;
      patch.startedAt = new Date(start).toISOString();
      patch.endedAt = new Date(end).toISOString();
    }
  }
  if (form.minutes.trim() !== initial.minutes.trim()) {
    const m = Number(form.minutes);
    if (!Number.isFinite(m) || m <= 0) return null;
    const durationMs = Math.round(m * 60000);
    if (durationMs !== s.durationMs) {
      patch.durationMs = durationMs;
      if (start + durationMs > end) patch.endedAt = new Date(start + durationMs).toISOString();
    }
  }
  if (form.pages.trim() !== initial.pages.trim()) {
    const n = Number(form.pages);
    patch.pagesRead = form.pages.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  }
  if (form.memo.trim() !== initial.memo.trim()) patch.memo = form.memo.trim() || undefined;
  return patch;
}
