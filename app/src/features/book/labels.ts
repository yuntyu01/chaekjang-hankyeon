import type { ReadStatus } from '@/domain/library';

export const STATUS_LABEL: Record<ReadStatus, string> = { want: '읽기 전', reading: '읽는 중', read: '완독', paused: '보류' };

export const ymd = (d?: string) => (d ? d.slice(0, 10).replace(/-/g, '.') : '');
export const hm = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
