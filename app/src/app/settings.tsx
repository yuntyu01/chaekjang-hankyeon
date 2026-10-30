// 설정: 소리와 동작(진동·효과음·동작 줄이기), 데이터(백업 및 복원·파일로 내보내기), 계정과 동기화, 앱 정보.
// 로그인은 선택이다. 서버 주소가 있는 빌드(릴리스)는 기기 전용 계정으로 동기화하고, 카카오로 로그인하면 그 계정을 다른 기기와 이을 수 있다.
// 서버 주소가 없는 빌드는 모든 기록이 이 기기에만 있고 계정 항목도 없다(작동하지 않는 버튼을 두지 않는다).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { shareBackup, syncLine } from '@/features/settings/backup-actions';
import { settingsStore, useSettings, type Settings } from '@/store/settings-store';
import { accountInfo, syncNow, syncStatus } from '@/services/sync';
import { Share } from '@/ui/icons';
import { Card, LineRow, Muted, Screen, Section, Toggle } from '@/ui/kit';
import { colors, screenTheme } from '@/ui/screenTheme';

const MOTION_LABEL: Record<Settings['reduceMotion'], string> = { system: '기기 설정 따르기', on: '켜기', off: '끄기' };

export default function SettingsScreen() {
  const s = useSettings();
  const [privacy, setPrivacy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const pickMotion = () =>
    Alert.alert('동작 줄이기', '켜면 책이 움직이는 연출과 독서 장면의 움직임을 줄여요.', [
      { text: '기기 설정 따르기', onPress: () => settingsStore.set({ reduceMotion: 'system' }) },
      { text: '끄기', onPress: () => settingsStore.set({ reduceMotion: 'off' }) },
      { text: '켜기', onPress: () => settingsStore.set({ reduceMotion: 'on' }) },
    ], { cancelable: true });
  return (
    <Screen title="설정">
      <Section style={{ marginTop: 14 }}>소리와 동작</Section>
      <LineRow label="진동" right={<Toggle label="진동" value={s.haptics} onChange={(v) => settingsStore.set({ haptics: v })} />} />
      <LineRow
        label={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 16.5, color: colors.ink }}>효과음</Text>
            <View style={{ backgroundColor: colors.rule, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 12.5, color: colors.inkSoft }}>준비 중</Text>
            </View>
          </View>
        }
        a11y="효과음, 준비 중. 켜 두면 준비되는 대로 들려요"
        right={<Toggle label="효과음" value={s.sound} onChange={(v) => settingsStore.set({ sound: v })} />}
      />
      <LineRow label="동작 줄이기" value={MOTION_LABEL[s.reduceMotion]} chevron last onPress={pickMotion} />

      <Section>데이터</Section>
      <LineRow label="백업 및 복원" chevron onPress={() => router.push('/backup')} />
      <LineRow
        label="파일로 내보내기"
        last
        a11y="파일로 내보내기, 공유 창으로 백업 파일 보내기"
        onPress={sharing ? undefined : async () => { setSharing(true); await shareBackup(); setSharing(false); }}
        right={<Share size={24} color={colors.ink} strokeWidth={1.5} />}
      />

      <SyncSection />

      <Section>앱 정보</Section>
      <LineRow label="문의하기" chevron onPress={() => Linking.openURL('mailto:yuntyu01@gmail.com')} a11y="문의하기, yuntyu01@gmail.com" />
      <LineRow label="개인정보처리방침" chevron onPress={() => Linking.openURL('https://midi-broccoli-56c.notion.site/Covebook-3eb50284670881b0a0e2c6029cea29c7')} />
      <LineRow label="개인정보 처리 안내" value={privacy ? '접기' : '보기'} last onPress={() => setPrivacy((v) => !v)} />
      {privacy ? (
        <Card style={{ marginTop: 6 }}>
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
      <Muted style={{ marginTop: 18 }}>버전 {Constants.expoConfig?.version ?? ''}</Muted>
    </Screen>
  );
}

function SyncSection() {
  const st = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const acct = accountInfo.get();
  if (!syncStatus.available)
    return (
      <>
        <Section>계정과 동기화</Section>
        <LineRow label="이 기기에만 저장돼요" sub="서버 주소가 없는 빌드예요. 기록은 백업 파일로 옮길 수 있어요." last />
      </>
    );
  return (
    <>
      <Section>계정과 동기화</Section>
      <LineRow label={acct.kakao ? '카카오 계정 연결됨' : '카카오 계정 연결'} value={acct.kakao ? acct.nickname || undefined : undefined} chevron onPress={() => router.push('/account')} />
      <LineRow
        label="동기화"
        sub={`${syncLine(st)}${st.pending ? ` · 올리지 못한 변경 ${st.pending}개` : ''}`}
        last
        right={
          <Pressable onPress={() => void syncNow()} disabled={st.state === 'syncing'} hitSlop={10} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', opacity: st.state === 'syncing' ? 0.4 : 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: screenTheme.primary }}>지금 동기화</Text>
          </Pressable>
        }
      />
    </>
  );
}
