import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { BookmarkTabIcon, CommunityTabIcon, ReadTabIcon, ShelfIcon } from '@/ui/TabIcons';
import { tabBarStyle } from '@/ui/tabBar';
import { colors, navigation } from '@/ui/theme';
import { colors as ui } from '@/ui/screenTheme';

// 하단 탭: 책장 · 갈피 · 읽기 · 커뮤니티(2026-11). 둥근 선 아이콘(2026-11-01 사용자 '인스타처럼 둥글게'): 고르지 않은 탭은 속이 빈 회색,
// 고른 탭은 진한 색으로 속이 찬 모양(사용자 '눌린 바탕 말고 아이콘 속이 차게'). 글자 없이 아이콘만(조금 키운 27). 아이콘은 책장 장면과 같은 종이 위에 뜬다.
const ICON = navigation.iconSize + 2; // 글자가 없어 아이콘만으로 알아보게 조금 크게

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // 책장 밖 화면의 탭 바: 종이 바탕 + 위 구분선, 아이콘 위로 8 더 띄워 구분선이 아이콘에 붙지 않게(2026-11-01 '하단바 테두리 좀 더 높게')
  const paperBar = { ...tabBarStyle(insets.bottom), height: navigation.height + insets.bottom + 8, paddingTop: 8, backgroundColor: ui.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ui.line };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 글자 없이 아이콘만(2026-11-01 사용자 '하단바 글씨 없애고 아이콘만'). 읽어 주기는 탭마다 tabBarAccessibilityLabel
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: tabBarStyle(insets.bottom),
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: ko.tabs.shelf,
          tabBarAccessibilityLabel: ko.tabs.shelf,
          tabBarIcon: ({ color, focused }) => <ShelfIcon color={String(color)} bg={ui.bg} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="bookmarks"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: paperBar,
          title: ko.tabs.bookmarks,
          tabBarAccessibilityLabel: ko.tabs.bookmarks,
          tabBarIcon: ({ color, focused }) => <BookmarkTabIcon color={String(color)} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: { display: 'none' },
          title: ko.tabs.read,
          tabBarAccessibilityLabel: ko.tabs.read,
          tabBarIcon: ({ color, focused }) => <ReadTabIcon color={String(color)} bg={colors.bg} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          tabBarStyle: paperBar,
          title: ko.tabs.community,
          tabBarAccessibilityLabel: ko.tabs.community,
          tabBarIcon: ({ color, focused }) => <CommunityTabIcon color={String(color)} bg={ui.bg} size={ICON} filled={focused} />,
        }}
      />
    </Tabs>
  );
}
