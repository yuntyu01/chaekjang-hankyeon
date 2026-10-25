// 설정(2026-10-26 설정 시안): 독서 환경(진동·효과음·움직임 줄이기) / 내 기록(백업 및 복원 → 따로 된 화면) / 앱 안내(문의·개인정보·앱 정보).
// 카드 없이 구역 이름과 얇은 구분선으로 나눈다. 백업·복원·동기화는 app/backup.tsx(기능은 그대로 옮겼다).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';

import { settingsStore, useSettings } from '@/store/settings-store';
import { syncStatus } from '@/services/sync';
import { Check } from '@/ui/icons';
import { BrandFooter, Btn, H2, ListGroup, ListItem, Screen, Sheet, Toggle } from '@/ui/kit';
import { colors, icon, space, type } from '@/ui/screenTheme';

const PRIVACY_URL = 'https://midi-broccoli-56c.notion.site/Covebook-3eb50284670881b0a0e2c6029cea29c7';
const MOTION = [
  { id: 'system', label: '기기 설정 따르기', short: '기기 설정' },
  { id: 'on', label: '켜기', short: '켬' },
  { id: 'off', label: '끄기', short: '끔' },
] as const;

export default function SettingsScreen() {
  const s = useSettings();
  const st = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [motion, setMotion] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const backupSub = !syncStatus.available ? '기록은 이 기기에 저장돼요' : st.state === 'error' ? '동기화하지 못했어요' : '기록은 이 기기와 서버에 저장돼요';
  return (
    <Screen title="설정">
      <H2 first>독서 환경</H2>
      <ListGroup>
        <ListItem label="진동" sub="책을 집거나 놓을 때 짧은 진동" right={<Toggle label="진동" value={s.haptics} onValueChange={(v) => settingsStore.set({ haptics: v })} />} />
        <ListItem label="효과음" sub="책장 효과음은 준비 중이에요. 켜 두면 준비되는 대로 들려요. 독서 환경음은 읽기 화면에서 따로 조절해요." right={<Toggle label="효과음" value={s.sound} onValueChange={(v) => settingsStore.set({ sound: v })} />} />
        <ListItem label="움직임 줄이기" value={MOTION.find((m) => m.id === s.reduceMotion)?.short} onPress={() => setMotion(true)} />
      </ListGroup>

      <H2>내 기록</H2>
      <ListGroup>
        <ListItem label="백업 및 복원" sub={backupSub} onPress={() => router.push('/backup')} />
      </ListGroup>

      <H2>앱 안내</H2>
      <ListGroup>
        <ListItem label="문의하기" sub="yuntyu01@gmail.com" onPress={() => Linking.openURL('mailto:yuntyu01@gmail.com')} />
        <ListItem label="개인정보 처리방침" onPress={() => setPrivacy(true)} />
        <ListItem label="앱 정보" value={Constants.expoConfig?.version ?? ''} />
      </ListGroup>

      <BrandFooter />

      <Sheet visible={motion} onClose={() => setMotion(false)} title="움직임 줄이기">
        <Text style={[type.sub, { marginBottom: space.tight }]}>켜면 책이 움직이는 연출과 독서 장면의 움직임을 줄여요.</Text>
        <ListGroup>
          {MOTION.map((m) => (
            <ListItem
              key={m.id}
              label={m.label}
              selected={s.reduceMotion === m.id}
              right={s.reduceMotion === m.id ? <Check size={icon.size} color={colors.accent} strokeWidth={2} /> : null}
              chevron={false}
              onPress={() => {
                settingsStore.set({ reduceMotion: m.id });
                setMotion(false);
              }}
            />
          ))}
        </ListGroup>
      </Sheet>

      <Sheet visible={privacy} onClose={() => setPrivacy(false)} title="개인정보 처리 안내" scroll maxHeight="80%">
        <PrivacyNote />
        <View style={{ gap: 8, marginTop: space.group }}>
          <Btn label="처리방침 전문 보기(웹)" kind="secondary" onPress={() => Linking.openURL(PRIVACY_URL)} />
          <Btn label="닫기" kind="ghost" onPress={() => setPrivacy(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function PrivacyNote() {
  const p = { ...type.body, color: colors.ink, marginBottom: space.item };
  return (
    <View>
      <Text style={p}>
        {syncStatus.available
          ? '책장 한켠은 로그인 없이 쓸 수 있으며, 책·독서 기록·갈피·사진은 이 기기에 저장되고 이 기기 전용 계정으로 책장 한켠 서버에도 동기화돼요. 카카오로 로그인하면 카카오 회원번호와 닉네임이 서버에 저장되고, 다른 기기에서 같은 기록을 이어 볼 수 있어요.'
          : '책장 한켠은 로그인 없이 쓰며, 책·독서 기록·갈피·사진은 이 기기 안에만 저장돼요.'}
      </Text>
      <Text style={p}>책을 검색하면 입력한 검색어가 도서 검색 서비스(Google Books, Open Library)로 전송돼요. 검색 요청과 표지 이미지 요청에는 IP 주소 등 통신 정보가 함께 전달돼요.</Text>
      <Text style={p}>
        사진은 책을 찾고 장정을 만들 때 참고하거나 갈피 원문을 보관하는 데만 쓰고, 읽었다는 인증에는 쓰지 않아요.{' '}
        {syncStatus.available ? '사진 인식·AI 장정은 아직 연결되지 않았고, 사진은 동기화를 위해 책장 한켠 서버에만 올라가요.' : '사진 인식·AI 장정은 아직 연결되지 않아 사진이 밖으로 전송되지 않아요.'}
      </Text>
      <Text style={[p, { marginBottom: 0 }]}>내보낸 백업 파일은 직접 고른 곳에 저장되며, 그 파일에는 위 기록과 사진이 들어 있어요.</Text>
    </View>
  );
}
