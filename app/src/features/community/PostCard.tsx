// 커뮤니티 독서 게시물 한 장: 글쓴이 · 쓴 글 · 갈피 문장 · 책(고른 것만 시간·분량) · 좋아요·댓글 수.
// 공개본만 그린다(개인 서재 기록은 여기 오지 않는다).
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDurationPrecise } from '@/domain/library';
import type { Post } from '@/services/community';
import { Avatar } from '@/features/community/Avatar';
import { Heart, MessageCircle, MoreHorizontal } from '@/ui/icons';
import { RealCover } from '@/ui/kit';
import { colors, fonts, icon, press, space } from '@/ui/screenTheme';

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

// 표지가 없을 때의 색: 제목으로 고정한 차분한 책등 색(같은 책은 늘 같은 색)
const COVER_COLORS = ['#7F95A8', '#8E9A78', '#B98270', '#6E879E', '#A0906F', '#9A7F8F', '#6F8F86', '#A8826A'];
function coverColor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}

export function postFacts(p: Pick<Post, 'durationMs' | 'pagesRead'>) {
  return [p.durationMs ? `${formatDurationPrecise(p.durationMs)} 읽음` : null, p.pagesRead ? `${p.pagesRead}쪽` : null].filter(Boolean).join(' · ');
}

// 2026-11-01 사용자 '에타·토스증권·스레드처럼': 사람이 주인공인 글 한 줄 묶음.
// [프로필 동그라미] 닉네임 · 시간 / 쓴 글 / 갈피 문장(왼쪽 세로줄) / 책(테두리만 있는 첨부 줄: 제목 · 저자 · 읽은 시간·분량) / 좋아요·댓글.
// 상자로 감싸지 않고 글과 글 사이는 화면 끝까지 닿는 얇은 선(목록 쪽에서)으로 나눈다
export function PostCard({ post, onOpen, onAuthor, onLike, onMore, full }: { post: Post; onOpen?: () => void; onAuthor?: () => void; onLike?: () => void; onMore?: () => void; full?: boolean }) {
  const facts = postFacts(post);
  const bookMeta = [post.bookAuthor, facts].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} style={({ pressed }) => [st.item, pressed && { backgroundColor: colors.surface }]} accessibilityRole={onOpen ? 'button' : undefined} accessibilityLabel={`${post.nickname}님의 ${post.bookTitle} 독서 기록`}>
      <Pressable onPress={onAuthor} disabled={!onAuthor} hitSlop={4} accessibilityRole={onAuthor ? 'link' : undefined} accessibilityLabel={`${post.nickname} 프로필`} style={({ pressed }) => pressed && press}>
        <Avatar name={post.nickname} id={post.userId} size={full ? 44 : 40} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.head}>
          <Pressable onPress={onAuthor} disabled={!onAuthor} hitSlop={6} style={({ pressed }) => [{ flexShrink: 1 }, pressed && press]}>
            <Text style={st.nick} numberOfLines={1}>{post.nickname}</Text>
          </Pressable>
          <Text style={st.time}>{ago(post.createdAt)}</Text>
          <View style={{ flex: 1 }} />
          {onMore ? (
            <Pressable onPress={onMore} hitSlop={10} accessibilityRole="button" accessibilityLabel="더보기" style={({ pressed }) => pressed && press}>
              <MoreHorizontal size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} />
            </Pressable>
          ) : null}
        </View>
        {post.body ? <Text style={[st.body, full && st.bodyFull]} numberOfLines={full ? undefined : 6}>{post.body}</Text> : null}
        {post.quote ? (
          <View style={st.quote}>
            <Text style={st.quoteText} numberOfLines={full ? undefined : 4}>{post.quote}</Text>
            {post.quotePage ? <Text style={[st.meta, { marginTop: 4 }]}>{post.quotePage}쪽</Text> : null}
          </View>
        ) : null}
        <View style={st.book} accessible accessibilityLabel={`책 ${post.bookTitle}${bookMeta ? `, ${bookMeta}` : ''}`}>
          {/* 실제 책 표지 썸네일(제공처 공개 표지). 없으면 제목을 쓴 색 표지 */}
          <RealCover uri={post.coverUrl} title={post.bookTitle} color={coverColor(post.bookTitle)} width={36} ratio={0.7} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.bookTitle} numberOfLines={1}>{post.bookTitle}</Text>
            {bookMeta ? <Text style={st.meta} numberOfLines={1}>{bookMeta}</Text> : null}
          </View>
        </View>
        <View style={st.foot}>
          <Pressable onPress={onLike} disabled={!onLike} hitSlop={10} style={({ pressed }) => [st.stat, pressed && press]} accessibilityRole={onLike ? 'button' : undefined} accessibilityState={{ selected: post.liked }} accessibilityLabel={`좋아요 ${post.likes}${post.liked ? ', 누름' : ''}`}>
            <Heart size={20} color={post.liked ? colors.danger : colors.inkSoft} fill={post.liked ? colors.danger : 'none'} strokeWidth={icon.stroke} />
            {post.likes ? <Text style={[st.count, post.liked && { color: colors.danger }]}>{post.likes}</Text> : null}
          </Pressable>
          <View style={st.stat} accessible accessibilityLabel={`댓글 ${post.comments}`}>
            <MessageCircle size={20} color={colors.inkSoft} strokeWidth={icon.stroke} />
            {post.comments ? <Text style={st.count}>{post.comments}</Text> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', gap: 12, paddingVertical: 16, paddingHorizontal: space.page },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 },
  nick: { fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21, color: colors.ink },
  time: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  body: { fontFamily: fonts.ui, fontSize: 16, lineHeight: 24, color: colors.ink, marginTop: 4 },
  bodyFull: { fontFamily: fonts.ui, fontSize: 17, lineHeight: 26, marginTop: 6 },
  // 갈피 문장: 왼쪽 세로줄 인용(명조). 게시물 안에 상자를 겹치지 않는다
  quote: { marginTop: 10, paddingVertical: 2, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.track },
  quoteText: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 24, color: colors.ink },
  // 책 첨부: 회색으로 채우지 않고 얇은 테두리만(스레드의 링크 미리보기·토스증권의 종목 줄 자리)
  book: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  bookTitle: { fontFamily: fonts.uiBold, fontSize: 15, lineHeight: 21, color: colors.ink },
  meta: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  foot: { flexDirection: 'row', gap: 20, marginTop: 10 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, minWidth: 32 },
  count: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
});
