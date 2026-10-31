// 다른 독자의 공개 프로필: 닉네임·소개·팔로워·팔로잉·게시물 수, 팔로우, 공개 게시물·후기. 더보기: 신고·차단.
// 공개로 올린 것만 보인다(그 사람의 개인 서재·기록은 볼 수 없다).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { PostCard } from '@/features/community/PostCard';
import { ReportSheet, type ReportTarget } from '@/features/community/ReportSheet';
import { community, errorMessage, isNotFound, type UserPage } from '@/services/community';
import { MoreHorizontal } from '@/ui/icons';
import { Btn, Divider, Empty, IconButton, ListGroup, ListItem, Loading, Screen, Sheet, Stars } from '@/ui/kit';
import { colors, fonts, icon, space, tidyType } from '@/ui/screenTheme';

export default function UserScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const [page, setPage] = useState<UserPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);

  const load = useCallback(() => community.user(id).then(
    (pg) => { setPage(pg); setPhase('ready'); },
    (e: unknown) => { if (isNotFound(e)) setPhase('gone'); else { setError(errorMessage(e)); setPhase('error'); } },
  ), [id]);
  useEffect(() => { void load(); }, [load]);

  const follow = async () => {
    if (!page) return;
    setBusy(true);
    try {
      const r = await community.follow(id, !page.followed);
      setPage({ ...page, followed: r.followed, profile: { ...page.profile, followers: page.profile.followers + (r.followed === page.followed ? 0 : r.followed ? 1 : -1) } });
    } catch (e) { explainWriteError(e, '팔로우를 바꾸지 못했어요'); }
    finally { setBusy(false); }
  };
  const block = () => page && Alert.alert(`${page.profile.nickname}님을 차단할까요?`, '서로의 게시물·댓글·후기가 보이지 않고 팔로우도 끊겨요. 내 공개 프로필의 차단 목록에서 풀 수 있어요.', [
    { text: '취소', style: 'cancel' },
    { text: '차단', style: 'destructive', onPress: () => void community.block(id, true).then(() => router.back()).catch((e: unknown) => explainWriteError(e, '차단하지 못했어요')) },
  ]);

  if (phase === 'loading') return <Screen title="독자" tidy><Loading /></Screen>;
  if (phase === 'gone') return <Screen title="독자" tidy><Empty title="볼 수 없는 프로필이에요" body="공개 프로필이 없거나 볼 수 없는 사용자예요." /></Screen>;
  if (phase === 'error' || !page) return <Screen title="독자" tidy><Empty title="불러오지 못했어요" body={error} action="다시 시도" actionKind="secondary" onAction={() => { setPhase('loading'); void load(); }} /></Screen>;
  const p = page.profile;
  return (
    <Screen title={p.nickname} tidy right={page.me ? undefined : <IconButton label="더보기" onPress={() => setMenu(true)}><MoreHorizontal size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>}>
      {p.bio ? <Text style={[tidyType.body, { marginTop: space.tight }]}>{p.bio}</Text> : null}
      <View style={st.counts}>
        <Count n={p.posts} label="게시물" />
        <Count n={p.followers} label="팔로워" />
        <Count n={p.following} label="팔로잉" />
      </View>
      {page.me ? <Btn label="내 공개 프로필 고치기" kind="secondary" onPress={() => router.push('/community/profile')} /> : <Btn label={page.followed ? '팔로잉' : '팔로우'} kind={page.followed ? 'secondary' : 'primary'} busy={busy} onPress={() => void follow()} />}
      <Text style={[tidyType.section, { marginTop: space.section }]}>독서 기록</Text>
      {page.posts.length ? (
        <ListGroup>
          {page.posts.map((post) => <PostCard key={post.id} post={post} onOpen={() => router.push(`/community/post/${post.id}`)} />)}
        </ListGroup>
      ) : <Text style={[tidyType.sub, { paddingVertical: space.item }]}>아직 공유한 독서 기록이 없어요.</Text>}
      {page.reviews.length ? (
        <>
          <Divider style={{ marginTop: space.item }} />
          <Text style={[tidyType.section, { marginTop: space.group }]}>남긴 평가</Text>
          <ListGroup>
            {page.reviews.map((r) => (
              <View key={r.isbn13} style={{ paddingVertical: 14, gap: 4 }}>
                <Stars value={r.rating} size={16} />
                {r.body ? <Text style={tidyType.body}>{r.body}</Text> : null}
                <Text style={tidyType.caption}>{r.bookTitle ?? `ISBN ${r.isbn13}`}</Text>
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <ListGroup>
          <ListItem label="사용자 신고" onPress={() => { setMenu(false); setTimeout(() => setReport({ kind: 'user', id, label: '사용자' }), 350); }} />
          <ListItem label={`${p.nickname}님 차단`} danger onPress={() => { setMenu(false); block(); }} />
        </ListGroup>
      </Sheet>
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${label} ${n}`}>
      <Text style={st.n}>{n}</Text>
      <Text style={tidyType.caption}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  counts: { flexDirection: 'row', marginVertical: space.group },
  n: { fontFamily: fonts.uiMedium, fontSize: 20, lineHeight: 26, color: colors.ink, fontVariant: ['tabular-nums'] },
});
