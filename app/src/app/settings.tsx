// 설정: 효과음·진동, 동작 줄이기, 데이터 내보내기·복원(백업 범위 안내), 앱 정보·문의, 개인정보 안내.
// 로그인은 선택이다. 서버 주소가 있는 빌드(릴리스)는 기기 전용 계정으로 동기화하고, 카카오로 로그인하면 그 계정을 다른 기기와 이을 수 있다.
// 서버 주소가 없는 빌드는 모든 기록이 이 기기에만 있고 로그인 버튼도 없다(작동하지 않는 버튼을 두지 않는다).
import Constants from 'expo-constants';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Switch, Text, View } from 'react-native';

import { exportShare, exportToFolder, readBackupFile, restoreBackup } from '@/store/backup';
import { PERF_ENABLED } from '@/ui/perf';
import { settingsStore, useSettings } from '@/store/settings-store';
import { accountInfo, linkKakao, syncNow, syncStatus } from '@/services/sync';
import { Btn, Card, Chip, H2, ListItem, Muted, Row, Screen } from '@/ui/kit';
import { colors } from '@/ui/screenTheme';

export default function SettingsScreen() {
  const s = useSettings();
  const [busy, setBusy] = useState<'export' | 'share' | 'restore' | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [failTest, setFailTest] = useState<'library' | 'after-library' | undefined>(undefined);
  return (
    <Screen title="설정">
      <H2>소리와 진동</H2>
      <Card>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: colors.ink }}>진동</Text>
            <Muted>책을 집거나 놓을 때 짧은 진동</Muted>
          </View>
          <Switch value={s.haptics} onValueChange={(v) => settingsStore.set({ haptics: v })} />
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 14, flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: colors.ink }}>효과음</Text>
            <Muted>책장 효과음은 아직 준비 중이에요. 켜 두면 준비되는 대로 들려요. (독서 환경음은 읽기 화면에서 따로 조절해요)</Muted>
          </View>
          <Switch value={s.sound} onValueChange={(v) => settingsStore.set({ sound: v })} />
        </Row>
      </Card>

      <H2>동작 줄이기</H2>
      <Row>
        <Chip label="기기 설정 따르기" on={s.reduceMotion === 'system'} onPress={() => settingsStore.set({ reduceMotion: 'system' })} />
        <Chip label="켜기" on={s.reduceMotion === 'on'} onPress={() => settingsStore.set({ reduceMotion: 'on' })} />
        <Chip label="끄기" on={s.reduceMotion === 'off'} onPress={() => settingsStore.set({ reduceMotion: 'off' })} />
      </Row>
      <Muted style={{ marginTop: 6 }}>켜면 책이 움직이는 연출과 독서 장면의 움직임을 줄여요.</Muted>

      <H2>데이터</H2>
      <Card>
        <Text style={{ fontSize: 14, lineHeight: 21, color: colors.ink }}>
          {syncStatus.available ? '기록은 이 기기에 저장되고, 이 기기 전용 계정(또는 연결한 카카오 계정)으로 서버에 동기화돼요.' : '모든 기록은 이 기기에만 저장돼요. 계정·클라우드 동기화는 아직 없어요.'}
        </Text>
        <Muted style={{ marginTop: 8, lineHeight: 19 }}>
          백업 파일에 들어가는 것: 내 책(도서 정보·상태·별점·감상), 독서 회차, 독서 시간 기록, 갈피, 장정, 책장 배치와 시점, 설정, 앱에 보관한 사진(표지 사진·갈피 페이지 사진·장정 그림). 진행 중인 독서 타이머는 들어가지 않아요.
        </Muted>
      </Card>
      <View style={{ gap: 10, marginTop: 12 }}>
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

      <H2>앱 정보</H2>
      <ListItem label="버전" value={Constants.expoConfig?.version ?? ''} />
      <ListItem label="문의" value="yuntyu01@gmail.com" onPress={() => Linking.openURL('mailto:yuntyu01@gmail.com')} />
      <ListItem label="개인정보처리방침 전문" value="웹에서 보기" onPress={() => Linking.openURL('https://midi-broccoli-56c.notion.site/Covebook-3eb50284670881b0a0e2c6029cea29c7')} />
      <ListItem label="개인정보 처리 안내" value={privacy ? '접기' : '보기'} onPress={() => setPrivacy((v) => !v)} />
      {privacy ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 13.5, lineHeight: 21, color: colors.ink }}>
            {syncStatus.available
              ? '책장 한켠은 로그인 없이 쓸 수 있으며, 책·독서 기록·갈피·사진은 이 기기에 저장되고 이 기기 전용 계정으로 책장 한켠 서버에도 동기화돼요. 카카오로 로그인하면 카카오 회원번호와 닉네임이 서버에 저장되고, 다른 기기에서 같은 기록을 이어 볼 수 있어요.'
              : '책장 한켠은 로그인 없이 쓰며, 책·독서 기록·갈피·사진은 이 기기 안에만 저장돼요.'}
            {'\n'}
            책을 검색하면 입력한 검색어가 도서 검색 서비스(Google Books, Open Library)로 전송돼요. 검색 요청과 표지 이미지 요청에는 IP 주소 등 통신 정보가 함께 전달돼요.{'\n'}
            사진은 책을 찾고 장정을 만들 때 참고하거나 갈피 원문을 보관하는 데만 쓰고, 읽었다는 인증에는 쓰지 않아요.{' '}
            {syncStatus.available ? '사진 인식·AI 장정은 아직 연결되지 않았고, 사진은 동기화를 위해 책장 한켠 서버에만 올라가요.' : '사진 인식·AI 장정은 아직 연결되지 않아 사진이 밖으로 전송되지 않아요.'}
            {'\n'}
            내보낸 백업 파일은 직접 고른 곳에 저장되며, 그 파일에는 위 기록과 사진이 들어 있어요.
          </Text>
        </Card>
      ) : null}
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
  const [loggingIn, setLoggingIn] = useState(false);
  const label = !syncStatus.available ? '이 기기에만 저장돼요' : st.state === 'syncing' ? '동기화하는 중…' : st.state === 'error' ? '동기화하지 못했어요' : st.lastAt ? `마지막 동기화 ${localTime(st.lastAt)}` : '아직 동기화 전이에요';
  const login = async () => {
    setLoggingIn(true);
    const r = await linkKakao();
    setLoggingIn(false);
    if (r.ok) Alert.alert('카카오 계정을 연결했어요', r.switched ? '이미 연결된 계정의 기록과 이 기기의 기록을 합쳤어요.' : '이 기기의 기록이 카카오 계정에 이어졌어요.');
    else if (!r.cancelled) Alert.alert('로그인하지 못했어요', r.message);
  };
  return (
    <View style={{ marginTop: 18 }}>
      <H2>동기화</H2>
      <Card>
        <Text style={{ fontSize: 15, color: '#34302C' }}>{label}</Text>
        {syncStatus.available ? <Muted style={{ marginTop: 4 }}>{st.pending ? `올리지 못한 변경 ${st.pending}개` : '모든 변경이 서버에 있어요'}{st.error ? `\n${st.error}` : ''}</Muted> : <Muted style={{ marginTop: 4 }}>서버 주소가 없는 빌드예요. 기록은 이 기기에만 있고, 백업 파일로 옮길 수 있어요.</Muted>}
        {syncStatus.available ? <Btn label="지금 동기화" kind="secondary" style={{ marginTop: 10 }} disabled={st.state === 'syncing'} onPress={() => void syncNow()} /> : null}
      </Card>
      {syncStatus.available ? (
        <Card style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 15, color: '#34302C' }}>{acct.kakao ? `카카오 계정 연결됨${acct.nickname ? ` · ${acct.nickname}` : ''}` : '카카오 계정 연결'}</Text>
          <Muted style={{ marginTop: 4 }}>{acct.kakao ? '다른 기기에서 같은 카카오 계정으로 로그인하면 이 기록을 이어 볼 수 있어요.' : '연결하면 기기를 바꾸거나 앱을 지웠다 깔아도 기록을 이어 볼 수 있어요. 연결하지 않아도 앱은 그대로 써요.'}</Muted>
          {acct.kakao ? null : <Btn label={loggingIn ? '카카오 로그인 중…' : '카카오로 계속하기'} kind="secondary" style={{ marginTop: 10 }} disabled={loggingIn} onPress={() => void login()} />}
        </Card>
      ) : null}
    </View>
  );
}
