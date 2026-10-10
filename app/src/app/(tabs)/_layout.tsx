import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { BookmarkTabIcon, ReadTabIcon, ShelfIcon } from '@/ui/TabIcons';
import { ReferenceUI } from '@/ui/ReferenceUI';
import { tabBarStyle } from '@/ui/tabBar';
import { colors, navigation } from '@/ui/theme';

// 하단 탭: 책장 · 갈피 · 읽기. 시안처럼 아이콘 아래에 글자를 두고, 선택된 탭만 속이 차고 진하게 나머지는 연한 윤곽선. 아이콘은 책장 장면과 같은 종이 위에 뜬다.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
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
          tabBarIcon: ({ color, focused }) => focused ? <ReferenceUI name="shelfIcon" width={navigation.iconSize} height={navigation.iconSize}/> : <ShelfIcon color={String(color)} size={navigation.iconSize} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="bookmarks"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: { ...tabBarStyle(insets.bottom), backgroundColor: colors.tabBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
          title: ko.tabs.bookmarks,
          tabBarAccessibilityLabel: ko.tabs.bookmarks,
          tabBarIcon: ({ color, focused }) => <BookmarkTabIcon color={String(color)} size={navigation.iconSize} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: { display: 'none' },
          title: ko.tabs.read,
          tabBarAccessibilityLabel: ko.tabs.read,
          tabBarIcon: ({ color, focused }) => <ReadTabIcon color={String(color)} bg={colors.bg} size={navigation.iconSize} filled={focused} />,
        }}
      />
    </Tabs>
  );
}
