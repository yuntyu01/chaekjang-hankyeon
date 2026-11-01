import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { BookmarkTabIcon, CommunityTabIcon, ReadTabIcon, ShelfIcon } from '@/ui/TabIcons';
import { tabBarStyle } from '@/ui/tabBar';
import { colors, navigation } from '@/ui/theme';
import { colors as ui, fonts } from '@/ui/screenTheme';

// 하단 탭: 책장 · 갈피 · 읽기 · 커뮤니티(2026-11). 아이콘은 늘 속이 찬 모양(고른 탭 진한색, 나머지 회색 — 2026-11-01 사용자 '아이콘 안을 회색으로 찬 걸로'). 시안처럼 아이콘 아래에 글자를 두고, 선택된 탭만 속이 차고 진하게 나머지는 연한 윤곽선. 아이콘은 책장 장면과 같은 종이 위에 뜬다.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // 책장 밖 화면의 탭 바: 종이 바탕 + 위 구분선, 아이콘 위로 8 더 띄워 구분선이 아이콘에 붙지 않게(2026-11-01 '하단바 테두리 좀 더 높게')
  const paperBar = { ...tabBarStyle(insets.bottom), height: navigation.height + insets.bottom + 8, paddingTop: 8, backgroundColor: ui.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ui.line };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontFamily: fonts.uiBold, fontSize: 12.5, marginTop: 2 },
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
          // 시안 그림 조각 대신 다른 탭과 같은 선 아이콘(선택되면 속을 채운다, 2026-10-31)
          tabBarIcon: ({ color }) => <ShelfIcon color={String(color)} size={navigation.iconSize} filled />,
        }}
      />
      <Tabs.Screen
        name="bookmarks"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: paperBar,
          title: ko.tabs.bookmarks,
          tabBarAccessibilityLabel: ko.tabs.bookmarks,
          tabBarIcon: ({ color }) => <BookmarkTabIcon color={String(color)} size={navigation.iconSize} filled />,
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: { display: 'none' },
          title: ko.tabs.read,
          tabBarAccessibilityLabel: ko.tabs.read,
          tabBarIcon: ({ color }) => <ReadTabIcon color={String(color)} bg={colors.bg} size={navigation.iconSize} filled />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          tabBarStyle: paperBar,
          title: ko.tabs.community,
          tabBarAccessibilityLabel: ko.tabs.community,
          tabBarIcon: ({ color }) => <CommunityTabIcon color={String(color)} bg={ui.bg} size={navigation.iconSize} filled />,
        }}
      />
    </Tabs>
  );
}
