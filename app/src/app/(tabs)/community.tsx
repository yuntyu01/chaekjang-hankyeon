// 커뮤니티 탭: 발견(모든 공개 게시물)·팔로잉(팔로우한 사람) 피드. 서버의 공개 데이터 API만 쓴다(개인 서재 동기화와 따로).
// 상태: 확인 중 → 쓸 수 없음(이유) / 불러오는 중 / 오류(다시 시도) / 비어 있음 / 목록(아래로 내리면 더 불러오기, 당겨서 새로 고침).
// 처음에 게시물이 없으면 비어 있다고 그대로 보여 준다(가짜 사용자·게시물로 채우지 않는다).
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';

import { explainWriteError } from '@/features/community/actions';
import { mergePosts, PostCard } from '@/features/community/PostCard';
import { Unavailable } from '@/features/community/Unavailable';
import { community, communityAvailability, errorMessage, type Availability, type Post } from '@/services/community';
import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { PenLine, UserRound } from '@/ui/icons';
import { Divider, Empty, IconButton, Loading, Screen, Tabs, TextLink, ui } from '@/ui/kit';
import { colors, icon, space, type } from '@/ui/theme';
import { navigation } from '@/ui/theme';

type Scope = 'discover' | 'following';
const SCOPES = [{ id: 'discover', label: '발견' }, { id: 'following', label: '팔로잉' }] as const;

export default function CommunityTab() {
  const { active } = useReading();
  const [avail, setAvail] = useState<Availability | null>(null);
  const [scope, setScope] = useState<Scope>('discover');
  const [items, setItems] = useState<Post[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const req = useRef(0); // 범위를 바꾸거나 새로 고치면 늦게 온 이전 응답은 버린다

  useEffect(() => { void communityAvailability().then(setAvail); }, []);
  const recheck = () => {
    setAvail(null);
    void communityAvailability(true).then(setAvail);
  };

  // 결과는 콜백에서만 반영한다. 불러오는 중 표시는 부르는 쪽이 켠다(효과 안에서 바로 상태를 바꾸지 않게)
  // first·refresh(당겨서 새로 고침)는 첫 쪽으로 바꾸고, focus(다른 화면에서 돌아옴)는 첫 쪽만 새것으로 바꾸고
  // 이미 내려 받은 더 오래된 글·다음 쪽 위치는 지킨다(탭을 오가도 스크롤이 줄지 않게, 2026-11)
  const itemsRef = useRef<Post[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const load = useCallback((s: Scope, mode: 'first' | 'refresh' | 'focus') => {
    const id = ++req.current;
    return community.feed(s).then(
      (f) => {
        if (id !== req.current) return;
        const fresh = new Set(f.items.map((p) => p.id));
        const oldest = f.items.length ? f.items[f.items.length - 1].id : 0;
        const older = mode === 'focus' && f.nextBefore ? itemsRef.current.filter((p) => !fresh.has(p.id) && p.id < oldest) : [];
        setItems([...f.items, ...older]);
        if (!older.length) setNext(f.nextBefore);
        setMoreState('idle');
        setPhase('ready');
        setRefreshing(false);
      },
      (e: unknown) => {
        if (id !== req.current) return;
        setRefreshing(false);
        if (mode === 'first') {
          setError(errorMessage(e));
          setPhase('error');
        } else explainWriteError(e, '새로 고치지 못했어요');
      },
    );
  }, []);
  const refresh = () => {
    setRefreshing(true);
    void load(scope, 'refresh');
  };

  useEffect(() => {
    if (avail?.ok) void load(scope, 'first');
  }, [avail, scope, load]);
  // 다른 화면(글쓰기·상세)에서 돌아오면 첫 쪽을 조용히 다시 받는다
  const shown = useRef(false);
  useFocusEffect(useCallback(() => {
    if (shown.current && avail?.ok) void load(scope, 'focus');
    shown.current = true;
  }, [avail, scope, load]));

  const loadMore = async () => {
    if (!next || moreState === 'loading' || phase !== 'ready') return;
    const id = req.current;
    setMoreState('loading');
    try {
      const f = await community.feed(scope, next);
      if (id !== req.current) return;
      setItems((prev) => mergePosts(prev, f.items));
      setNext(f.nextBefore);
      setMoreState('idle');
    } catch {
      if (id === req.current) setMoreState('error');
    }
  };

  const toggleLike = async (p: Post) => {
    const flip = (x: Post): Post => (x.id === p.id ? { ...x, liked: !p.liked, likes: x.likes + (p.liked ? -1 : 1) } : x);
    setItems((prev) => prev.map(flip));
    try {
      const fresh = await community.like(p.id, !p.liked);
      setItems((prev) => prev.map((x) => (x.id === p.id ? fresh : x)));
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      explainWriteError(e, '좋아요를 반영하지 못했어요');
    }
  };

  // 머리줄 오른쪽: 기록 공유하기(글쓰기) · 내 공개 프로필
  const right = (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <IconButton label="독서 기록 공유하기" onPress={() => router.push('/community/compose')}><PenLine size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
      <IconButton label="내 공개 프로필" onPress={() => router.push('/community/profile')}><UserRound size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
    </View>
  );
  const pad = (node: ReactNode) => <View style={{ paddingHorizontal: ui.pad }}>{node}</View>;
  if (!avail) return <Screen title="커뮤니티" back={false} scroll={false}><Loading /></Screen>;
  if (!avail.ok) return <Screen title="커뮤니티" back={false} scroll={false}><Unavailable a={avail} onRetry={recheck} /></Screen>;
  return (
    <Screen title="커뮤니티" back={false} scroll={false} right={right}>
      {/* 스레드·토스증권처럼 화면 끝까지 반반 나눈 탭, 글은 상자 없이 화면 폭 그대로 + 사이 얇은 선 */}
      <Tabs fill items={SCOPES} value={scope} onChange={(s) => { if (s !== scope) { setItems([]); setNext(null); setPhase('loading'); setScope(s); } }} style={{ marginHorizontal: -ui.pad }} />
      {phase === 'loading' ? <Loading /> : phase === 'error' ? (
        <Empty title="피드를 불러오지 못했어요" body={error} action="다시 시도" actionKind="secondary" onAction={() => { setPhase('loading'); void load(scope, 'first'); }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => String(p.id)}
          style={{ marginHorizontal: -ui.pad }}
          contentContainerStyle={{ paddingBottom: navigation.height + 40 + (active ? MINI_TIMER_SPACE : 0), flexGrow: 1 }}
          ItemSeparatorComponent={Divider}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.accent]} tintColor={colors.accent} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            scope === 'following'
              ? pad(<Empty title="팔로우한 사람의 기록이 없어요" body="발견에서 마음에 드는 독자를 찾아 팔로우해 보세요." action="발견 보기" actionKind="secondary" onAction={() => { setItems([]); setPhase('loading'); setScope('discover'); }} />)
              : pad(<Empty title="아직 올라온 독서 기록이 없어요" body="내 독서 기록 가운데 하나를 골라 첫 글을 남겨 보세요." action="기록 공유하기" actionKind="secondary" onAction={() => router.push('/community/compose')} />)
          }
          ListFooterComponent={
            moreState === 'loading' ? <ActivityIndicator color={colors.accent} style={{ marginVertical: space.group }} />
              : moreState === 'error' ? (
                <View style={{ alignItems: 'center', paddingVertical: space.item }}>
                  <Text style={type.sub}>더 불러오지 못했어요</Text>
                  <TextLink label="다시 시도" onPress={() => void loadMore()} />
                </View>
              ) : null
          }
          renderItem={({ item }) => (
            <PostCard post={item} onOpen={() => router.push(`/community/post/${item.id}`)} onAuthor={() => router.push(`/community/user/${item.userId}`)} onLike={() => void toggleLike(item)} />
          )}
        />
      )}
    </Screen>
  );
}
