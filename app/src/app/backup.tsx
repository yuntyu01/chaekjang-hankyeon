// 백업 및 복원(설정 → 내 기록): 저장 위치 안내, 백업 파일 저장·공유·복원, 서버 동기화 상태·카카오 연결.
// 2026-10-26 디자인 통일 때 설정 화면에서 그대로 옮겼다(기능·문구·확인창은 같다).
import { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text } from 'react-native';

import { exportShare, exportToFolder, readBackupFile, restoreBackup } from '@/store/backup';
import { PERF_ENABLED } from '@/ui/perf';
import { accountInfo, deleteCloudAccount, linkGoogle, linkKakao, loginProviders, resumeCloudSync, syncNow, syncStatus } from '@/services/sync';
import { Chip, H2, ListGroup, ListItem, Row, Screen, SectionBand } from '@/ui/kit';
import { colors, space, type } from '@/ui/theme';

export default function BackupScreen() {
  const [busy, setBusy] = useState<'export' | 'share' | 'restore' | null>(null);
  const [failTest, setFailTest] = useState<'library' | 'after-library' | undefined>(undefined);
  const saveToFolder = async () => {
    setBusy('export');
    try {
      const r = await exportToFolder();
      if (r.ok) Alert.alert('백업 파일을 저장했어요', `${r.name}\n책 ${r.counts.books}권 · 갈피 ${r.counts.bookmarks}개 · 독서 회차 ${r.counts.rounds}개 · 독서 기록 ${r.counts.sessions}개 · 장정 ${r.counts.bindings}개 · 사진 ${r.counts.images}장`);
      else if (r.reason === 'error') Alert.alert('저장하지 못했어요', `${r.message ?? ''}\n다음에는 저장할 폴더를 다시 고르게 해요.`);
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    setBusy('share');
    try {
      await exportShare();
    } catch (e) {
      Alert.alert('내보내지 못했어요', String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const restore = async () => {
    setBusy('restore');
    const r = await readBackupFile();
    setBusy(null);
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
            setBusy('restore');
            try {
              await restoreBackup(r.data, failTest);
              Alert.alert('복원했어요');
            } catch (e) {
              Alert.alert('복원하지 못했어요', String((e as Error)?.message ?? e));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };
  return (
    <Screen title="백업 및 복원" subtitle={syncStatus.available ? '기록은 이 기기와 서버에 함께 저장돼요' : '모든 기록은 이 기기에만 저장돼요'}>
      {/* 2026-11-01 토스식: 세로로 쌓인 버튼 대신 누르는 줄 목록, 설명은 한 줄. 동작·확인창은 그대로 */}
      <H2 first>백업 파일</H2>
      <Text style={[type.sub, { marginBottom: space.s }]}>책·독서 기록·갈피·장정·책장 배치·설정·사진이 들어가요. 진행 중인 타이머는 빠져요.</Text>
      <ListGroup>
        <ListItem label="폴더에 백업 파일 저장" chevron={busy !== 'export'} right={busy === 'export' ? <ActivityIndicator color={colors.accent} /> : undefined} onPress={busy ? undefined : () => void saveToFolder()} />
        <ListItem label="공유로 보내기" sub="메신저·드라이브로 보내요" chevron={busy !== 'share'} right={busy === 'share' ? <ActivityIndicator color={colors.accent} /> : undefined} onPress={busy ? undefined : () => void share()} />
        <ListItem label="백업에서 복원" sub="지금 기기의 기록이 백업 내용으로 바뀌어요" chevron={busy !== 'restore'} right={busy === 'restore' ? <ActivityIndicator color={colors.accent} /> : undefined} onPress={busy ? undefined : () => void restore()} />
      </ListGroup>

      {PERF_ENABLED ? (
        <Row style={{ marginTop: 10 }}>
          <Chip label="복원 실패 시험: 서재 쓰기 중(측정)" on={failTest === 'library'} onPress={() => setFailTest(failTest === 'library' ? undefined : 'library')} />
          <Chip label="복원 실패 시험: 서재 바꾼 뒤(측정)" on={failTest === 'after-library'} onPress={() => setFailTest(failTest === 'after-library' ? undefined : 'after-library')} />
        </Row>
      ) : null}

      <SectionBand />
      <SyncSection />
    </Screen>
  );
}

// 저장된 시각은 UTC ISO 문자열이라 기기 시간대로 보여 준다(그대로 자르면 한국에서 9시간 어긋남)
function localTime(iso: string) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${p(t.getHours())}:${p(t.getMinutes())}`;
}

// 서버 동기화 상태(서버 주소가 설정된 빌드에서만 켜진다. 없으면 이 기기에만 저장)
function SyncSection() {
  const st = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const acct = accountInfo.get();
  const providers = loginProviders.get();
  const [loggingIn, setLoggingIn] = useState(false);
  const label = !syncStatus.available ? '이 기기에만 저장돼요' : st.paused ? '서버 동기화를 중지했어요' : st.state === 'syncing' ? '동기화하는 중…' : st.state === 'error' ? '동기화하지 못했어요' : st.lastAt ? `마지막 동기화 ${localTime(st.lastAt)}` : '아직 동기화 전이에요';
  // 연결 전에 알린다: 이 기기의 기록이 계정 기록과 합쳐지고(같은 항목은 더 최근에 고친 쪽), 아무것도 자동 공개되지 않는다
  const login = (provider: 'google' | 'kakao') => Alert.alert('계정을 연결할까요?', '이 기기의 책·독서 기록·갈피가 계정에 저장된 기록과 합쳐져요. 같은 항목을 양쪽에서 고쳤다면 더 최근에 고친 쪽이 남아요. 연결해도 내 기록은 공개되지 않아요(커뮤니티에는 직접 고른 것만 올라가요).', [
    { text: '취소', style: 'cancel' },
    { text: '연결', onPress: () => void doLogin(provider) },
  ]);
  const doLogin = async (provider: 'google' | 'kakao') => {
    setLoggingIn(true);
    try {
      const r = await (provider === 'google' ? linkGoogle() : linkKakao());
      if (r.ok) Alert.alert('계정을 연결했어요', r.switched ? '연결된 계정으로 바꿨어요. 기기의 기록은 동기화가 끝나면 합쳐져요.' : '이 기기의 기록을 계정에 연결했어요.');
      else if (!r.cancelled) Alert.alert('로그인하지 못했어요', r.message);
    } finally { setLoggingIn(false); }
  };
  const removeAccount = () => Alert.alert('서버 계정을 삭제할까요?', '연결된 로그인과 서버의 독서 기록·사진 삭제를 요청해요. 이 기기의 책과 사진은 남고 동기화는 중지돼요. 다른 기기의 오래된 앱이 기록을 다시 올리지 않도록 먼저 최신 버전으로 업데이트해 주세요.', [
    { text: '취소', style: 'cancel' },
    { text: '서버 계정 삭제', style: 'destructive', onPress: () => {
      setLoggingIn(true);
      void deleteCloudAccount().then(() => Alert.alert('삭제 요청을 접수했어요', '서버 접근을 차단하고 기록과 사진 삭제를 처리해요. 이 기기의 기록은 남아요.'))
        .catch((e: unknown) => Alert.alert('삭제 완료를 확인하지 못했어요', `${String((e as Error)?.message ?? e)}\n동기화 상태를 확인하고 삭제를 다시 요청해 주세요.`))
        .finally(() => setLoggingIn(false));
    } },
  ]);
  const resume = () => Alert.alert('새 계정으로 동기화할까요?', '새 서버 계정을 만들고 이 기기에 남은 기록과 사진을 다시 올려요.', [
    { text: '취소', style: 'cancel' },
    { text: '동기화 시작', onPress: () => { setLoggingIn(true); void resumeCloudSync().catch((e: unknown) => Alert.alert('다시 시작하지 못했어요', String((e as Error)?.message ?? e))).finally(() => setLoggingIn(false)); } },
  ]);
  return (
    <>
      <H2 first>동기화</H2>
      {/* 계정마다 한 줄: 연결됨이면 안내, 연결할 수 있으면 그 줄이 곧 행동, 준비 전이면 짧은 안내. 설명은 한 줄 */}
      <ListGroup>
        <ListItem
          label={label}
          sub={syncStatus.available ? `${st.pending ? `올리지 못한 변경 ${st.pending}개` : st.lastAt && !st.paused && st.state !== 'error' ? '대기 중인 변경이 없어요' : '기기에 기록을 보관하고 있어요'}${st.error ? ` · ${st.error}` : ''}` : '기록은 이 기기에만 있어요. 백업 파일로 옮길 수 있어요.'}
          chevron={false}
          right={st.state === 'syncing' ? <ActivityIndicator color={colors.accent} /> : undefined}
        />
        {syncStatus.available && !st.paused ? <ListItem label="지금 동기화" chevron={false} onPress={st.state === 'syncing' || loggingIn ? undefined : () => void syncNow()} /> : null}
        {syncStatus.available ? (
          acct.kakao ? <ListItem label="카카오 계정 연결됨" sub={acct.nickname ? `${acct.nickname} · 다른 기기에서도 이어 봐요` : '다른 기기에서도 이어 봐요'} />
            : providers.kakao && !st.paused ? <ListItem label="카카오로 계속하기" sub="연결하면 기기를 바꿔도 기록을 이어 봐요" chevron onPress={loggingIn ? undefined : () => login('kakao')} />
            : <ListItem label="카카오 로그인 준비 중" sub="서버 설정이 끝나면 쓸 수 있어요" />
        ) : null}
        {syncStatus.available && acct.google ? <ListItem label="Google 계정 연결됨" sub="다른 기기에서도 이어 봐요" /> : null}
        {syncStatus.available && !acct.google && !providers.google ? <ListItem label="Google 로그인 준비 중" sub="서버 설정이 끝나면 쓸 수 있어요" /> : null}
        {syncStatus.available && st.paused && !st.deletionPending ? <ListItem label="새 계정으로 동기화" chevron onPress={loggingIn ? undefined : resume} /> : null}
        {syncStatus.available && (st.deletionPending || (providers.accountDeletion && !st.paused)) ? <ListItem label={st.deletionPending ? '계정 삭제 다시 요청' : '서버 계정 삭제'} danger chevron={false} onPress={loggingIn ? undefined : removeAccount} /> : null}
      </ListGroup>
      {/* Google 로그인은 Google 공식 버튼 모양을 지켜야 해서 그대로 둔다 */}
      {syncStatus.available && !st.paused && !acct.google && providers.google ? <Pressable accessibilityRole="button" accessibilityLabel="Google로 계속하기" disabled={loggingIn} onPress={() => login('google')} style={{ marginTop: space.m }}><Image source={require('../../assets/google-signin-light.png')} resizeMode="contain" style={{ width: 240, height: 44, alignSelf: 'center' }} /></Pressable> : null}
    </>
  );
}
