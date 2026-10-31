// 백업 및 복원(설정 → 내 기록): 저장 위치 안내, 백업 파일 저장·공유·복원, 서버 동기화 상태·카카오 연결.
// 2026-10-26 디자인 통일 때 설정 화면에서 그대로 옮겼다(기능·문구·확인창은 같다).
import { useState, useSyncExternalStore } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';

import { exportShare, exportToFolder, readBackupFile, restoreBackup } from '@/store/backup';
import { PERF_ENABLED } from '@/ui/perf';
import { accountInfo, deleteCloudAccount, linkGoogle, linkKakao, loginProviders, resumeCloudSync, syncNow, syncStatus } from '@/services/sync';
import { Btn, Chip, H2, ListGroup, ListItem, Muted, Row, Screen } from '@/ui/kit';
import { space, type } from '@/ui/screenTheme';

export default function BackupScreen() {
  const [busy, setBusy] = useState<'export' | 'share' | 'restore' | null>(null);
  const [failTest, setFailTest] = useState<'library' | 'after-library' | undefined>(undefined);
  return (
    <Screen title="백업 및 복원">
      <Text style={[type.body, { marginTop: space.item }]}>
        {syncStatus.available ? '기록은 이 기기에 저장되고, 기기 전용 계정이나 연결한 계정으로 서버에 동기화돼요.' : '모든 기록은 이 기기에만 저장돼요. 계정·클라우드 동기화는 아직 없어요.'}
      </Text>

      <H2>백업 파일</H2>
      <Muted>
        백업 파일에 들어가는 것: 내 책(도서 정보·상태·별점·감상), 독서 회차, 독서 시간 기록, 갈피, 장정, 책장 배치와 시점, 설정, 앱에 보관한 사진(표지 사진·갈피 페이지 사진·장정 그림). 진행 중인 독서 타이머는 들어가지 않아요.
      </Muted>
      <View style={{ gap: 10, marginTop: space.group }}>
        <Btn
          label="폴더에 백업 파일 저장"
          busy={busy === 'export'}
          onPress={async () => {
            setBusy('export');
            try {
              const r = await exportToFolder();
              if (r.ok) Alert.alert('백업 파일을 저장했어요', `${r.name}\n책 ${r.counts.books}권 · 갈피 ${r.counts.bookmarks}개 · 독서 회차 ${r.counts.rounds}개 · 독서 기록 ${r.counts.sessions}개 · 장정 ${r.counts.bindings}개 · 사진 ${r.counts.images}장`);
              else if (r.reason === 'error') Alert.alert('저장하지 못했어요', `${r.message ?? ''}\n다음에는 저장할 폴더를 다시 고르게 해요.`);
            } finally {
              setBusy(null);
            }
          }}
        />
        <Btn
          label="공유로 보내기"
          kind="secondary"
          busy={busy === 'share'}
          onPress={async () => {
            setBusy('share');
            try {
              await exportShare();
            } catch (e) {
              Alert.alert('내보내지 못했어요', String((e as Error)?.message ?? e));
            } finally {
              setBusy(null);
            }
          }}
        />
        <Btn
          label="백업에서 복원"
          kind="secondary"
          busy={busy === 'restore'}
          onPress={async () => {
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
          }}
        />
      </View>

      {PERF_ENABLED ? (
        <Row style={{ marginTop: 10 }}>
          <Chip label="복원 실패 시험: 서재 쓰기 중(측정)" on={failTest === 'library'} onPress={() => setFailTest(failTest === 'library' ? undefined : 'library')} />
          <Chip label="복원 실패 시험: 서재 바꾼 뒤(측정)" on={failTest === 'after-library'} onPress={() => setFailTest(failTest === 'after-library' ? undefined : 'after-library')} />
        </Row>
      ) : null}

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
      <H2>동기화</H2>
      <ListGroup>
        <ListItem
          label={label}
          sub={syncStatus.available ? `${st.pending ? `올리지 못한 변경 ${st.pending}개` : st.lastAt && !st.paused && st.state !== 'error' ? '대기 중인 변경이 없어요' : '기기에 기록을 보관하고 있어요'}${st.error ? `\n${st.error}` : ''}` : '서버 주소가 없는 빌드예요. 기록은 이 기기에만 있고, 백업 파일로 옮길 수 있어요.'}
        />
        {syncStatus.available ? (
          <ListItem
            label={acct.kakao ? `카카오 계정 연결됨${acct.nickname ? ` · ${acct.nickname}` : ''}` : '카카오 계정 연결'}
            sub={acct.kakao ? '다른 기기에서 같은 카카오 계정으로 로그인하면 이 기록을 이어 볼 수 있어요.' : '연결하면 기기를 바꾸거나 앱을 지웠다 깔아도 기록을 이어 볼 수 있어요. 연결하지 않아도 앱은 그대로 써요.'}
          />
        ) : null}
        {syncStatus.available && acct.google ? <ListItem label="Google 계정 연결됨" sub="같은 Google 계정으로 다른 기기에서 기록을 이어 볼 수 있어요." /> : null}
        {syncStatus.available && !acct.google && !providers.google ? <ListItem label="Google 로그인 준비 중" sub="서버 연결과 Google 로그인 설정이 완료되면 이용할 수 있어요." /> : null}
      </ListGroup>
      {syncStatus.available ? (
        <View style={{ gap: 10, marginTop: space.item }}>
          {!st.paused ? <Btn label="지금 동기화" kind="secondary" disabled={st.state === 'syncing' || loggingIn} onPress={() => void syncNow()} /> : null}
          {!st.paused && !acct.kakao && providers.kakao ? <Btn label="카카오로 계속하기" kind="secondary" disabled={loggingIn} onPress={() => void login('kakao')} /> : null}
          {!st.paused && !acct.google && providers.google ? <Pressable accessibilityRole="button" accessibilityLabel="Google로 계속하기" disabled={loggingIn} onPress={() => void login('google')}><Image source={require('../../assets/google-signin-light.png')} resizeMode="contain" style={{ width: 240, height: 44, alignSelf: 'center' }} /></Pressable> : null}
          {st.paused && !st.deletionPending ? <Btn label="새 계정으로 동기화" kind="secondary" disabled={loggingIn} onPress={resume} /> : null}
          {(st.deletionPending || (providers.accountDeletion && !st.paused)) ? <Btn label={st.deletionPending ? '계정 삭제 다시 요청' : '서버 계정 삭제'} kind="ghost" disabled={loggingIn} onPress={removeAccount} /> : null}
        </View>
      ) : null}
    </>
  );
}
