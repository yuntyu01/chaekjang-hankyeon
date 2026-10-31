// 커뮤니티 독서 게시물 한 장: 글쓴이 · 책 · (고른 것만) 시간·분량 · 갈피 문장 · 한 줄 · 좋아요·댓글 수.
// 공개본만 그린다(개인 서재 기록은 여기 오지 않는다).
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDurationPrecise } from '@/domain/library';
import type { Post } from '@/services/community';
import { Heart, MessageCircle } from '@/ui/icons';
import { colors, fonts, icon, press, space, tidyType } from '@/ui/screenTheme';

export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}일 전`;
  const t = new Date(iso);
  return `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()}`;
}

// 다음 쪽을 이어 붙일 때 같은 게시물이 두 번 오지 않게(새 글이 앞에 끼면 경계가 밀릴 수 있다)
export function mergePosts(prev: Post[], page: Post[]) {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...page.filter((p) => !seen.has(p.id))];
}

export function postFacts(p: Pick<Post, 'durationMs' | 'pagesRead'>) {
  return [p.durationMs ? `${formatDurationPrecise(p.durationMs)} 읽음` : null, p.pagesRead ? `${p.pagesRead}쪽` : null].filter(Boolean).join(' · ');
}

export function PostCard({ post, onOpen, onAuthor, onLike, full }: { post: Post; onOpen?: () => void; onAuthor?: () => void; onLike?: () => void; full?: boolean }) {
  const facts = postFacts(post);
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [st.card, pressed && { backgroundColor: colors.surface }]} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={`${post.nickname}님의 ${post.bookTitle} 독서 기록`}>
      <View style={st.head}>
        <Pressable onPress={onAuthor} disabled={!onAuthor} hitSlop={8} accessibilityRole={onAuthor ? 'link' : undefined} style={({ pressed }) => pressed && press}>
          <Text style={st.nick} numberOfLines={1}>{post.nickname}</Text>
        </Pressable>
        <Text style={tidyType.caption}>{ago(post.createdAt)}</Text>
      </View>
      <Text style={st.title} numberOfLines={full ? undefined : 2}>{post.bookTitle}</Text>
      {post.bookAuthor ? <Text style={[tidyType.caption, { marginTop: 2 }]} numberOfLines={1}>{post.bookAuthor}</Text> : null}
      {facts ? <Text style={[tidyType.sub, { marginTop: space.tight }]}>{facts}</Text> : null}
      {post.quote ? (
        <View style={st.quote}>
          <Text style={st.quoteText} numberOfLines={full ? undefined : 4}>{post.quote}</Text>
          {post.quotePage ? <Text style={[tidyType.caption, { marginTop: 6 }]}>{post.quotePage}쪽</Text> : null}
        </View>
      ) : null}
      {post.body ? <Text style={[tidyType.body, { marginTop: space.tight }]} numberOfLines={full ? undefined : 3}>{post.body}</Text> : null}
      <View style={st.foot}>
        <Pressable onPress={onLike} disabled={!onLike} hitSlop={10} style={({ pressed }) => [st.stat, pressed && press]} accessibilityRole={onLike ? 'button' : undefined} accessibilityState={{ selected: post.liked }} accessibilityLabel={`좋아요 ${post.likes}${post.liked ? ', 누름' : ''}`}>
          <Heart size={icon.small} color={post.liked ? colors.danger : colors.inkSoft} fill={post.liked ? colors.danger : 'none'} strokeWidth={icon.stroke} />
          <Text style={tidyType.caption}>{post.likes}</Text>
        </Pressable>
        <View style={st.stat} accessible accessibilityLabel={`댓글 ${post.comments}`}>
          <MessageCircle size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} />
          <Text style={tidyType.caption}>{post.comments}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { paddingVertical: 18 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 },
  nick: { fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink },
  title: { fontFamily: fonts.serif, fontSize: 18, lineHeight: 25, color: colors.title },
  quote: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface },
  quoteText: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 24, color: colors.ink },
  foot: { flexDirection: 'row', gap: 18, marginTop: 12 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
});
