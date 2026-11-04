// 갈피 탭 빈 화면(저장된 갈피가 하나도 없을 때만): 예시 갈피 한 장 + 안내 + '갈피 남기기'.
// 예시 카드는 갈피 탭 목록과 같은 카드 부품(BookmarkCard)이다: 첫 갈피를 남기면 이 모양으로 쌓인다(2026-11-04 사용자 '예시 그림 우리 저거 아니잖아').
// 예시 문장은 화면 표현용이다(사용자 데이터에 저장하지 않는다). 작은 화면·글자 확대에서도 버튼까지 스크롤된다.
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookmarkCard } from '@/features/bookmark/BookmarkCard';
import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { Btn, ui } from '@/ui/kit';
import { colors, fonts, type } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

const SAMPLE = '어떤 문장은\n책을 덮은 뒤에도\n곁에 남아요.';
// 예시 책: 실제 책 표지(2026-11-04 사용자 '예쁜 파란색 책'). 문장은 이 책의 문장이 아니라서 저자는 적지 않고 '예시'로 밝힌다
const SAMPLE_BOOK = { title: '채식주의자', coverUri: 'https://image.yes24.com/goods/108422348/L', color: '#5276B3' };

export function BookmarkEmpty() {
  const insets = useSafeAreaInsets();
  const { active } = useReading();
  const { width } = useWindowDimensions();
  const now = new Date();
  return (
    <ScrollView
      style={{ marginHorizontal: -ui.pad }}
      contentContainerStyle={[st.body, { paddingBottom: navigation.height + insets.bottom + (active ? MINI_TIMER_SPACE : 24) }]}
      showsVerticalScrollIndicator={false}>
      <Text style={st.tag}>예시</Text>
      <View accessible accessibilityLabel={`예시 갈피. ${SAMPLE.replace(/\n/g, ' ')}`} pointerEvents="none">
        <BookmarkCard compact showMemo={false} width={width - ui.pad * 2} seed="sample" data={{ text: SAMPLE, title: SAMPLE_BOOK.title, page: 12, date: `${now.getMonth() + 1}월 ${now.getDate()}일`, color: SAMPLE_BOOK.color, coverUri: SAMPLE_BOOK.coverUri }} />
      </View>
      <Text style={st.title} accessibilityRole="header">
        첫 갈피를 남겨보세요
      </Text>
      <Text style={st.desc}>{'문장이나 사진으로\n간직하고 싶은 순간을 모아요.'}</Text>
      <Btn label="갈피 남기기" onPress={() => router.push('/bookmark/new')} style={st.button} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  // 가운데보다 조금 위: 아래 여백을 위보다 크게
  body: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: ui.pad, paddingTop: 12 },
  tag: { fontFamily: fonts.ui, fontSize: 12, color: colors.inkSoft, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, overflow: 'hidden' },
  title: { ...type.heading, marginTop: 4, textAlign: 'center' },
  desc: { ...type.sub, fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  button: { marginTop: 28, alignSelf: 'stretch' },
});
