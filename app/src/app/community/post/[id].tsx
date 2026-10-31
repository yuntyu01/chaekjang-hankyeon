// 게시물 상세: 게시물(공개본) · 좋아요 · 댓글 목록 · 댓글 쓰기 · 더보기(내 글: 삭제 / 남의 글: 신고·글쓴이 차단).
// 게시물을 지워도 개인 서재의 독서 기록은 그대로다(공개본만 지운다).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { newId } from '@/domain/library';
import { explainWriteError } from '@/features/community/actions';
import { ReportSheet, type ReportTarget } from '@/features/community/ReportSheet';
import { ago, PostCard } from '@/features/community/PostCard';
import { community, errorMessage, isNotFound, type Comment, type Post } from '@/services/community';
import { MoreHorizontal } from '@/ui/icons';
import { Btn, Divider, Empty, IconButton, ListGroup, ListItem, Loading, Screen, Sheet, TextLink } from '@/ui/kit';
import { colors, fonts, icon, press, space, tidyType } from '@/ui/screenTheme';

export default function PostScreen() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const clientId = useRef(newId('cm')); // 같은 댓글을 두 번 보내도(재시도) 하나만

  // 결과는 콜백에서만 반영한다(효과 안에서 바로 상태를 바꾸지 않게)
  const load = useCallback(() => Promise.all([community.post(id), community.comments(id)]).then(
    ([p, c]) => { setPost(p); setComments(c.items); setPhase('ready'); },
    (e: unknown) => { if (isNotFound(e)) setPhase('gone'); else { setError(errorMessage(e)); setPhase('error'); } },
  ), [id]);
  useEffect(() => { void load(); }, [load]);

  const like = async () => {
    if (!post) return;
    const before = post;
    setPost({ ...post, liked: !post.liked, likes: post.likes + (post.liked ? -1 : 1) });
    try { setPost(await community.like(before.id, !before.liked)); }
    catch (e) { setPost(before); explainWriteError(e, '좋아요를 반영하지 못했어요'); }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await community.addComment(id, body, clientId.current);
      setComments(r.items);
      setText('');
      clientId.current = newId('cm');
      setPost((p) => (p ? { ...p, comments: r.items.length } : p));
    } catch (e) { explainWriteError(e, '댓글을 남기지 못했어요'); }
    finally { setSending(false); }
  };
  const removeComment = (c: Comment) => Alert.alert('댓글을 지울까요?', undefined, [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: () => void community.deleteComment(c.id).then(() => { setComments((l) => l.filter((x) => x.id !== c.id)); setPost((p) => (p ? { ...p, comments: Math.max(0, p.comments - 1) } : p)); }).catch((e: unknown) => explainWriteError(e, '지우지 못했어요')) },
  ]);
  const commentMenu = (c: Comment) => {
    if (c.mine) removeComment(c);
    else Alert.alert(`${c.nickname}님의 댓글`, undefined, [{ text: '취소', style: 'cancel' }, { text: '신고', onPress: () => setReport({ kind: 'comment', id: c.id, label: '댓글' }) }]);
  };
  const removePost = () => Alert.alert('게시물을 지울까요?', '커뮤니티에서만 지워져요. 내 서재의 독서 기록은 그대로예요.', [
    { text: '취소', style: 'cancel' },
    { text: '지우기', style: 'destructive', onPress: () => void community.deletePost(id).then(() => router.back()).catch((e: unknown) => explainWriteError(e, '지우지 못했어요')) },
  ]);
  const blockAuthor = () => post && Alert.alert(`${post.nickname}님을 차단할까요?`, '서로의 게시물·댓글·후기가 보이지 않고 팔로우도 끊겨요. 내 공개 프로필의 차단 목록에서 풀 수 있어요.', [
    { text: '취소', style: 'cancel' },
    { text: '차단', style: 'destructive', onPress: () => void community.block(post.userId, true).then(() => router.back()).catch((e: unknown) => explainWriteError(e, '차단하지 못했어요')) },
  ]);

  const right = post ? <IconButton label="더보기" onPress={() => setMenu(true)}><MoreHorizontal size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton> : undefined;
  if (phase === 'loading') return <Screen title="독서 기록" tidy><Loading /></Screen>;
  if (phase === 'gone') return <Screen title="독서 기록" tidy><Empty title="볼 수 없는 게시물이에요" body="지워졌거나 숨겨진 게시물이에요." /></Screen>;
  if (phase === 'error' || !post) return <Screen title="독서 기록" tidy><Empty title="불러오지 못했어요" body={error} action="다시 시도" actionKind="secondary" onAction={() => { setPhase('loading'); void load(); }} /></Screen>;
  return (
    <Screen
      title="독서 기록"
      tidy
      right={right}
      footer={
        <View style={st.compose}>
          <TextInput value={text} onChangeText={setText} placeholder="댓글 남기기" placeholderTextColor={colors.inkFaint} style={st.input} multiline maxLength={500} accessibilityLabel="댓글" />
          <Btn label="올리기" size="s" onPress={() => void send()} disabled={!text.trim()} busy={sending} />
        </View>
      }>
      <PostCard post={post} full onAuthor={() => router.push(`/community/user/${post.userId}`)} onLike={() => void like()} />
      {/* 다른 사람의 책을 내 서재에: 기존 새 책 추가(검색·같은 ISBN 확인)를 그대로 쓴다. ISBN이 있으면 ISBN으로 찾는다 */}
      {!post.mine ? <TextLink label="이 책 내 서재에 추가" tone="soft" onPress={() => router.push({ pathname: '/book/add', params: { q: post.isbn13 ?? post.bookTitle } })} style={{ alignSelf: 'flex-start', marginBottom: space.tight }} /> : null}
      <Divider />
      <Text style={[tidyType.section, { marginTop: space.group, marginBottom: space.tight }]}>댓글 {comments.length}</Text>
      {comments.length ? (
        <ListGroup>
          {comments.map((c) => (
            <Pressable key={c.id} onLongPress={() => commentMenu(c)} style={({ pressed }) => [st.comment, pressed && press]} accessibilityHint="길게 누르면 지우기·신고">
              <View style={st.commentHead}>
                <Pressable onPress={() => router.push(`/community/user/${c.userId}`)} hitSlop={6}><Text style={st.nick}>{c.nickname}</Text></Pressable>
                <Text style={tidyType.caption}>{ago(c.createdAt)}</Text>
              </View>
              <Text style={tidyType.body}>{c.body}</Text>
            </Pressable>
          ))}
        </ListGroup>
      ) : <Text style={[tidyType.sub, { paddingVertical: space.item }]}>첫 댓글을 남겨 보세요.</Text>}
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <ListGroup>
          {post.mine ? <ListItem label="게시물 지우기" danger onPress={() => { setMenu(false); removePost(); }} /> : null}
          {!post.mine ? <ListItem label="게시물 신고" onPress={() => { setMenu(false); setTimeout(() => setReport({ kind: 'post', id: post.id, label: '게시물' }), 350); }} /> : null}
          {!post.mine ? <ListItem label={`${post.nickname}님 차단`} danger onPress={() => { setMenu(false); blockAuthor(); }} /> : null}
        </ListGroup>
      </Sheet>
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}

const st = StyleSheet.create({
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 10, backgroundColor: colors.input, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.ui, fontSize: 16, color: colors.ink },
  comment: { paddingVertical: 14 },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  nick: { fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink },
});
