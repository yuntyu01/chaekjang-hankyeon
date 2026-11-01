// 다른 독자의 공개 프로필: 닉네임·소개·팔로워·팔로잉·게시물 수, 팔로우, 공개 게시물·후기. 더보기: 신고·차단.
// 공개로 올린 것만 보인다(그 사람의 개인 서재·기록은 볼 수 없다).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { Avatar } from '@/features/community/Avatar';
import { PostCard } from '@/features/community/PostCard';
import { ReportSheet, type ReportTarget } from '@/features/community/ReportSheet';
import { community, errorMessage, isNotFound, type UserPage } from '@/services/community';
import { MoreHorizontal } from '@/ui/icons';
import { Btn, Divider, Empty, IconButton, ListGroup, ListItem, Loading, Screen, Sheet, Stars, Tabs } from '@/ui/kit';
import { colors, icon, tidySpace as space, tidyType } from '@/ui/screenTheme';

export default function UserScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const [page, setPage] = useState<UserPage | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [tab, setTab] = useState<'posts' | 'reviews'>('posts');

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
  // 스레드처럼: 이름 크게 + 오른쪽 프로필 동그라미, 소개, '팔로워 N · 팔로잉 N' 한 줄, 팔로우 버튼, '독서 기록 | 평가' 탭
  return (
    <Screen title="" tidy compact right={page.me ? undefined : <IconButton label="더보기" onPress={() => setMenu(true)}><MoreHorizontal size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>}>
      <View style={st.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={tidyType.title} accessibilityRole="header" numberOfLines={2}>{p.nickname}</Text>
          {p.bio ? <Text style={[tidyType.body, { marginTop: space.tight }]}>{p.bio}</Text> : null}
          <Text style={[tidyType.sub, { marginTop: space.s }]}>{`팔로워 ${p.followers} · 팔로잉 ${p.following} · 기록 ${p.posts}`}</Text>
        </View>
        <Avatar name={p.nickname} id={p.userId} size={64} />
      </View>
      {page.me ? <Btn label="내 공개 프로필 고치기" kind="secondary" onPress={() => router.push('/community/profile')} style={{ marginTop: space.group }} /> : <Btn label={page.followed ? '팔로잉' : '팔로우'} kind={page.followed ? 'secondary' : 'primary'} busy={busy} onPress={() => void follow()} style={{ marginTop: space.group }} />}
      <Tabs fill items={USER_TABS} value={tab} onChange={setTab} style={{ marginHorizontal: -space.page, marginTop: space.group }} />
      {tab === 'posts' ? (
        page.posts.length ? (
          <View style={{ marginHorizontal: -space.page }}>
            {page.posts.map((post, i) => (
              <View key={post.id}>
                {i ? <Divider /> : null}
                <PostCard post={post} onOpen={() => router.push(`/community/post/${post.id}`)} />
              </View>
            ))}
          </View>
        ) : <Text style={[tidyType.sub, { paddingVertical: space.group }]}>아직 공유한 독서 기록이 없어요.</Text>
      ) : page.reviews.length ? (
        <ListGroup>
          {page.reviews.map((r) => (
            <View key={r.isbn13} style={{ paddingVertical: 16, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[tidyType.rowStrong, { flexShrink: 1 }]} numberOfLines={1}>{r.bookTitle ?? `ISBN ${r.isbn13}`}</Text>
                <Stars value={r.rating} size={14} />
              </View>
              {r.body ? <Text style={tidyType.body}>{r.body}</Text> : null}
            </View>
          ))}
        </ListGroup>
      ) : <Text style={[tidyType.sub, { paddingVertical: space.group }]}>아직 남긴 공개 평가가 없어요.</Text>}
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

const USER_TABS = [{ id: 'posts', label: '독서 기록' }, { id: 'reviews', label: '평가' }] as const;

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginTop: space.s },
});
