// 커뮤니티 글쓰기: 내 독서 기록 가운데 공유할 것을 고른다 → 공유 초안(고른 것만 공개). 게시물은 실제 독서 기록에서만 만든다.
// 책과 연결된 기록만(게시물은 책 기준). 최근 순 50개. 같은 기록은 이미 올렸어도 다시 눌러도 게시물 하나다(서버가 기록 id로 합친다)
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDurationPrecise } from '@/domain/library';
import { sessionPages } from '@/domain/community-draft';
import { useLibrary } from '@/store/library-store';
import { ChevronRight } from '@/ui/icons';
import { Divider, Empty, Screen } from '@/ui/kit';
import { colors, fonts, icon, tidySpace as space, tidyType as type } from '@/ui/screenTheme';

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export default function Compose() {
  const { lib } = useLibrary();
  const rows = useMemo(
    () =>
      Object.values(lib.sessions)
        .filter((s) => s.myBookId && lib.books[s.myBookId])
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 50),
    [lib],
  );
  return (
    <Screen tidy title="기록 공유하기" subtitle="공유할 독서 기록을 골라 주세요. 다음 화면에서 공개할 것만 고를 수 있어요." scroll>
      {rows.length ? (
        <View style={{ marginHorizontal: -space.page }}>
          {rows.map((s, i) => {
            const book = lib.books[s.myBookId!];
            const ed = lib.editions[book.editionId];
            const pages = sessionPages(s);
            const meta = [day(s.startedAt), formatDurationPrecise(s.durationMs), pages ? `${pages}쪽` : null].filter(Boolean).join(' · ');
            return (
              <View key={s.id}>
                {i ? <Divider style={{ marginHorizontal: space.page }} /> : null}
                <Pressable onPress={() => router.push({ pathname: '/community/share', params: { session: s.id } })} style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.surface }]} accessibilityRole="button" accessibilityLabel={`${ed?.title ?? '책'}, ${meta}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.title} numberOfLines={1}>{ed?.title ?? '제목 없음'}</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>{meta}</Text>
                  </View>
                  <ChevronRight size={icon.small} color={colors.inkSoft} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <Empty title="공유할 독서 기록이 없어요" body="책을 골라 읽고 기록을 저장하면 여기서 공유할 수 있어요." action="읽으러 가기" onAction={() => router.navigate('/read')} />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: space.page, minHeight: 64 },
  title: { fontFamily: fonts.uiBold, fontSize: 17, lineHeight: 24, color: colors.ink },
});
