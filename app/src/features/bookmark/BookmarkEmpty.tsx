// 갈피 탭 빈 화면(저장된 갈피가 하나도 없을 때만): 문학잡지 같은 예시 갈피 한 장 + 안내 + '갈피 남기기'.
// 예시 문장은 화면 표현용이다(사용자 데이터에 저장하지 않는다). 작은 화면·글자 확대에서도 버튼까지 스크롤된다.
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_TIMER_SPACE } from '@/store/mini-timer-store';
import { useReading } from '@/store/reading-store';
import { Btn, ui } from '@/ui/kit';
import { PaperSurface } from '@/ui/PaperSurface';
import { colors, fonts } from '@/ui/screenTheme';
import { navigation } from '@/ui/theme';

const SAMPLE = '어떤 문장은\n책을 덮은 뒤에도\n곁에 남아요.';

export function BookmarkEmpty() {
  const insets = useSafeAreaInsets();
  const { active } = useReading();
  return (
    <ScrollView
      style={{ marginHorizontal: -ui.pad }}
      contentContainerStyle={[st.body, { paddingBottom: navigation.height + insets.bottom + (active ? MINI_TIMER_SPACE : 24) }]}
      showsVerticalScrollIndicator={false}>
      {/* 예시 갈피 종이: 밝은 아이보리, 아주 옅은 결, 작은 둥근 모서리, 약한 그림자 */}
      <View style={st.paper} accessible accessibilityLabel={`예시 갈피. ${SAMPLE.replace(/\n/g, ' ')} 책장 한켠`}>
        <PaperSurface color="#FFFBF3" radius={8} grain={0.03} shaded={false} />
        <Text style={st.tag}>예시</Text>
        <Text style={st.quote}>{SAMPLE}</Text>
        <Text style={st.brand}>책장 한켠</Text>
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
  body: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: ui.pad + 8, paddingTop: 12 },
  paper: {
    width: '74%',
    maxWidth: 280,
    aspectRatio: 0.8,
    borderRadius: 8,
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 18,
    backgroundColor: '#FFFBF3',
    shadowColor: '#6F5843',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    overflow: 'visible',
  },
  tag: { alignSelf: 'flex-start', fontSize: 11.5, color: colors.inkSoft, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: '#DCCFBE', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  quote: { flex: 1, textAlignVertical: 'center', fontFamily: fonts.reading, fontSize: 19, lineHeight: 32, color: colors.ink, marginTop: 6 },
  brand: { fontSize: 11.5, color: colors.inkFaint, letterSpacing: 0.5 },
  title: { marginTop: 34, fontFamily: fonts.round, fontSize: 19, color: colors.ink, textAlign: 'center' },
  desc: { marginTop: 10, fontSize: 14.5, lineHeight: 22, color: colors.inkSoft, textAlign: 'center' },
  button: { marginTop: 22, alignSelf: 'stretch' },
});
