// 내 공개 프로필: 공개 닉네임·소개(소셜 로그인 이름과 따로), 내 공개 페이지 보기, 차단 목록.
// 공개 활동은 Google·카카오 계정 연결이 먼저다(기기 계정만으로는 읽기만). 개인 서재 기록은 여기서 공개되지 않는다.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { Unavailable } from '@/features/community/Unavailable';
import { community, communityAvailability, errorMessage, type Availability, type MyProfile } from '@/services/community';
import { Btn, Empty, Field, ListGroup, ListItem, Loading, Notice, Screen } from '@/ui/kit';
import { space, tidyType } from '@/ui/screenTheme';

export default function MyPublicProfile() {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [me, setMe] = useState<MyProfile | null>(null);
  const [error, setError] = useState('');
  const [nick, setNick] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<{ userId: number; nickname: string }[] | null>(null);

  const load = useCallback((force = false) => communityAvailability(force).then(async (a) => {
    setAvail(a);
    if (!a.ok) return;
    try {
      const m = await community.myProfile();
      setMe(m);
      setNick(m.profile?.nickname ?? '');
      setBio(m.profile?.bio ?? '');
      setBlocked((await community.blocks()).items);
    } catch (e) { setError(errorMessage(e)); }
  }), []);
  useEffect(() => { void load(); }, [load]);

  const nickError = nick.trim() && (nick.trim().length < 2 || nick.trim().length > 20) ? '닉네임은 2~20자로 정해 주세요' : undefined;
  const changed = !!me && (nick.trim() !== (me.profile?.nickname ?? '') || bio.trim() !== (me.profile?.bio ?? ''));
  const save = async () => {
    setSaving(true);
    try {
      const m = await community.saveProfile(nick.trim(), bio.trim() || undefined);
      setMe(m);
      setNick(m.profile?.nickname ?? '');
      setBio(m.profile?.bio ?? '');
      Alert.alert('공개 프로필을 저장했어요');
    } catch (e) { explainWriteError(e, '저장하지 못했어요'); }
    finally { setSaving(false); }
  };
  const unblock = (b: { userId: number; nickname: string }) => Alert.alert(`${b.nickname || '이 사용자'}님 차단을 풀까요?`, '서로의 공개 게시물·댓글·후기가 다시 보여요. 팔로우는 다시 해야 해요.', [
    { text: '취소', style: 'cancel' },
    { text: '차단 풀기', onPress: () => void community.block(b.userId, false).then(() => setBlocked((l) => l?.filter((x) => x.userId !== b.userId) ?? null)).catch((e: unknown) => explainWriteError(e, '풀지 못했어요')) },
  ]);

  if (!avail) return <Screen title="공개 프로필" tidy><Loading /></Screen>;
  if (!avail.ok) return <Screen title="공개 프로필" tidy><Unavailable a={avail} onRetry={() => { setAvail(null); void load(true); }} /></Screen>;
  if (error) return <Screen title="공개 프로필" tidy><Empty title="불러오지 못했어요" body={error} action="다시 시도" actionKind="secondary" onAction={() => { setError(''); setMe(null); void load(); }} /></Screen>;
  if (!me) return <Screen title="공개 프로필" tidy><Loading /></Screen>;
  const blockList = (
    <>
      <Text style={[tidyType.section, { marginTop: space.section }]}>차단한 사용자</Text>
      {blocked === null ? <Loading /> : blocked.length ? (
        <ListGroup>
          {blocked.map((b) => <ListItem key={b.userId} label={b.nickname || '닉네임 없는 사용자'} value="차단 풀기" onPress={() => unblock(b)} />)}
        </ListGroup>
      ) : <Text style={[tidyType.sub, { paddingVertical: space.item }]}>차단한 사용자가 없어요.</Text>}
    </>
  );
  if (!me.socialLinked)
    return (
      <Screen title="공개 프로필" tidy>
        <Empty
          title="계정을 연결하면 공개 활동을 할 수 있어요"
          body="게시·평가·댓글·팔로우는 Google이나 카카오 계정을 연결한 뒤 할 수 있어요. 연결 전에도 다른 독자의 공개 기록은 볼 수 있어요. 내 서재 기록은 직접 고른 것만 공개돼요."
          action="계정 연결하러 가기"
          onAction={() => router.push('/backup')}
        />
        {blocked?.length ? blockList : null}
      </Screen>
    );
  return (
    <Screen
      title="공개 프로필"
      tidy
      footer={<Btn label={me.profile ? '저장' : '공개 프로필 만들기'} size="l" disabled={!changed || !nick.trim() || !!nickError} busy={saving} onPress={() => void save()} />}>
      <Notice style={{ marginTop: space.tight }}>공개 닉네임은 게시물·후기·댓글에 보여요. 로그인한 계정 이름이나 내 서재 기록은 공개되지 않아요.</Notice>
      <Field label="공개 닉네임" value={nick} onChangeText={setNick} maxLength={20} placeholder="2~20자" error={nickError} autoCorrect={false} />
      <Field label="소개 (선택)" value={bio} onChangeText={setBio} maxLength={200} multiline placeholder="어떤 책을 즐겨 읽는지 한두 줄로" />
      {me.profile ? (
        <>
          <Text style={[tidyType.section, { marginTop: space.section }]}>내 공개 활동</Text>
          <ListGroup>
            <ListItem label="내 공개 페이지 보기" sub={`게시물 ${me.profile.posts} · 팔로워 ${me.profile.followers} · 팔로잉 ${me.profile.following}`} chevron onPress={() => router.push(`/community/user/${me.profile!.userId}`)} />
          </ListGroup>
        </>
      ) : null}
      {blockList}
    </Screen>
  );
}
