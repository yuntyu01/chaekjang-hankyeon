// 계정과 동기화: 카카오로 다른 기기와 잇기(선택) + 이 기기의 기록 개수·마지막 동기화·지금 동기화·백업 및 복원.
// 서버 주소가 없는 빌드는 계정·동기화가 없으므로 이 기기에만 저장된다고만 알린다.
import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { syncLine, whenLabel } from '@/features/settings/backup-actions';
import { accountInfo, linkKakao, syncNow, syncStatus } from '@/services/sync';
import { useLibrary } from '@/store/library-store';
import { RefreshCw, UserRound } from '@/ui/icons';
import { LineRow, Screen } from '@/ui/kit';
import { colors, fonts } from '@/ui/screenTheme';

// 카카오 말풍선(카카오 로그인 버튼 안내의 심볼)
function KakaoBubble({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.2C6.6 3.2 2.3 6.6 2.3 10.8c0 2.7 1.8 5.1 4.5 6.4l-1 3.7c-.1.3.3.6.6.4l4.3-2.9c.4 0 .9.1 1.3.1 5.4 0 9.7-3.4 9.7-7.6S17.4 3.2 12 3.2Z" fill="#191919" />
    </Svg>
  );
}

export default function AccountScreen() {
  const { lib } = useLibrary();
  const st = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [acct, setAcct] = useState(accountInfo.get());
  const [loggingIn, setLoggingIn] = useState(false);
  const login = async () => {
    setLoggingIn(true);
    const r = await linkKakao();
    setLoggingIn(false);
    setAcct(accountInfo.get());
    if (r.ok) Alert.alert('카카오 계정을 연결했어요', r.switched ? '이미 연결된 계정의 기록과 이 기기의 기록을 합쳤어요.' : '이 기기의 기록이 카카오 계정에 이어졌어요.');
    else if (!r.cancelled) Alert.alert('로그인하지 못했어요', r.message);
  };
  const on = syncStatus.available;
  return (
    <Screen title="계정과 동기화">
      <View style={st2.hero}>
        <View style={st2.avatar}>
          <UserRound size={44} color={colors.ink} strokeWidth={1.4} />
        </View>
        <Text style={st2.title}>{acct.kakao ? '카카오 계정과 이어져 있어요' : '다른 기기에서도 이어서'}</Text>
        <Text style={st2.body}>
          {!on
            ? '이 빌드는 서버 주소가 없어 기록이 이 기기에만 있어요.\n백업 파일로 다른 기기에 옮길 수 있어요.'
            : acct.kakao
              ? `${acct.nickname ? `${acct.nickname} · ` : ''}다른 기기에서 같은 카카오 계정으로\n로그인하면 이 기록을 이어 볼 수 있어요.`
              : '계정을 연결하면 책장과 기록을\n다른 기기에서도 이어 볼 수 있어요.'}
        </Text>
      </View>
      {on && !acct.kakao ? (
        <>
          <Pressable onPress={() => void login()} disabled={loggingIn} accessibilityRole="button" accessibilityLabel="카카오로 계속하기" style={({ pressed }) => [st2.kakao, (pressed || loggingIn) && { opacity: 0.75 }]}>
            <KakaoBubble />
            <Text style={st2.kakaoText}>{loggingIn ? '카카오 로그인 중…' : '카카오로 계속하기'}</Text>
          </Pressable>
          <Text style={st2.note}>연결하지 않아도 이 기기에서 사용할 수 있어요.</Text>
        </>
      ) : null}

      <Text style={st2.h}>이 기기의 기록</Text>
      <LineRow label="책" value={`${Object.keys(lib.books).length}권`} />
      <LineRow label="남긴 갈피" value={`${Object.keys(lib.bookmarks).length}개`} />
      {on ? (
        <>
          <LineRow label="마지막 동기화" value={st.lastAt ? whenLabel(st.lastAt) : syncLine(st)} sub={st.state === 'error' ? st.error : st.pending ? `올리지 못한 변경 ${st.pending}개` : undefined} />
          <LineRow
            icon={<RefreshCw size={26} color={colors.ink} strokeWidth={1.6} />}
            label={<Text style={st2.action}>{st.state === 'syncing' ? '동기화하는 중…' : '지금 동기화'}</Text>}
            onPress={st.state === 'syncing' ? undefined : () => void syncNow()}
            a11y="지금 동기화"
          />
        </>
      ) : null}
      <LineRow label="백업 및 복원" chevron last onPress={() => router.push('/backup')} />
    </Screen>
  );
}

const st2 = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 36 },
  avatar: { width: 92, height: 92, borderRadius: 46, backgroundColor: '#F1EAE2', alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', fontSize: 23, color: colors.title, marginTop: 24, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 24, color: colors.inkSoft, marginTop: 14, textAlign: 'center' },
  kakao: { marginTop: 30, minHeight: 54, borderRadius: 10, backgroundColor: '#FEE500', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  kakaoText: { fontSize: 17, fontWeight: '700', color: 'rgba(0,0,0,0.85)' },
  note: { fontSize: 14, color: colors.inkSoft, textAlign: 'center', marginTop: 16 },
  h: { fontWeight: '700', fontSize: 18, color: colors.title, marginTop: 40, marginBottom: 2 },
  action: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
