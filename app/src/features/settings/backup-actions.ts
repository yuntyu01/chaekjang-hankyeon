// 설정·백업 화면이 함께 쓰는 백업 동작(결과를 알림으로 알려 준다).
import { Alert } from 'react-native';

import { syncStatus } from '@/services/sync';
import { exportShare, exportToFolder, readBackupFile, restoreBackup } from '@/store/backup';

export async function saveToFolder(): Promise<boolean> {
  const r = await exportToFolder();
  if (r.ok) Alert.alert('백업 파일을 저장했어요', `${r.name}\n책 ${r.counts.books}권 · 갈피 ${r.counts.bookmarks}개 · 독서 회차 ${r.counts.rounds}개 · 독서 기록 ${r.counts.sessions}개 · 장정 ${r.counts.bindings}개 · 사진 ${r.counts.images}장`);
  else if (r.reason === 'error') Alert.alert('저장하지 못했어요', `${r.message ?? ''}\n다음에는 저장할 폴더를 다시 고르게 해요.`);
  return r.ok;
}

export async function shareBackup() {
  try {
    await exportShare();
  } catch (e) {
    Alert.alert('내보내지 못했어요', String((e as Error)?.message ?? e));
  }
}

// 파일을 고르고 → 내용(개수)을 보여 준 뒤 → 확인하면 바꾼다
export async function pickAndRestore(setBusy: (v: boolean) => void, failTest?: 'library' | 'after-library') {
  const r = await readBackupFile();
  if (!r.ok) {
    if (r.reason === 'invalid') Alert.alert('복원할 수 없어요', r.message);
    return;
  }
  Alert.alert(
    '백업으로 바꿀까요?',
    `백업(${r.data.exportedAt.slice(0, 10)}): 책 ${r.counts.books}권 · 갈피 ${r.counts.bookmarks}개 · 독서 기록 ${r.counts.sessions}개 · 사진 ${r.counts.images}장\n지금 기기의 기록은 이 백업 내용으로 바뀌어요.`,
    [
      { text: '취소', style: 'cancel' },
      {
        text: '복원',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await restoreBackup(r.data, failTest);
            Alert.alert('복원했어요');
          } catch (e) {
            Alert.alert('복원하지 못했어요', String((e as Error)?.message ?? e));
          } finally {
            setBusy(false);
          }
        },
      },
    ],
  );
}

// 저장된 시각(UTC ISO)을 기기 시간대로: 오늘 09:20 / 어제 09:20 / 10월 3일 09:20
export function whenLabel(iso?: string | null) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(t.getHours())}:${p(t.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(t)) / 86400000);
  if (diff === 0) return `오늘 ${hm}`;
  if (diff === 1) return `어제 ${hm}`;
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm}`;
}

// 동기화 상태 한 줄(서버 주소가 설정된 빌드에서만 동기화한다)
export function syncLine(st: ReturnType<typeof syncStatus.get>) {
  if (!syncStatus.available) return '이 기기에만 저장돼요';
  if (st.state === 'syncing') return '동기화하는 중…';
  if (st.state === 'error') return '동기화하지 못했어요';
  return st.lastAt ? `마지막 동기화 · ${whenLabel(st.lastAt)}` : '아직 동기화 전이에요';
}
