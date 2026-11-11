import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCommunityOpen } from '@/features/community/useCommunityOpen';
import { ko } from '@/i18n/ko';
import { BookmarkTabIcon, CommunityTabIcon, ProfileTabIcon, ReadTabIcon, RecordTabIcon, ShelfIcon } from '@/ui/TabIcons';
import { TAB_ICON, tabBarStyle, tabItemStyle, tabTint } from '@/ui/tabBar';
import { colors } from '@/ui/theme';
import { colors as ui } from '@/ui/theme';

// 하단 탭: 책장 · 갈피 · 읽기 · 기록(2026-11-03 사용자 '기록은 따로 탭') · 내 정보, 서버가 열면 커뮤니티까지(2026-11). 둥근 선 아이콘(2026-11-01 사용자 '인스타처럼 둥글게'): 고르지 않은 탭은 속이 빈 회색,
// 고른 탭은 진한 색으로 속이 찬 모양(사용자 '눌린 바탕 말고 아이콘 속이 차게'). 글자 없이 아이콘만(조금 키운 27). 아이콘은 책장 장면과 같은 종이 위에 뜬다.
const ICON = TAB_ICON; // 모양·크기는 ui/tabBar

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const communityOpen = useCommunityOpen(); // 닫혀 있으면 탭을 숨긴다(서버 스위치)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 글자 없이 아이콘만(2026-11-01 사용자 '하단바 글씨 없애고 아이콘만'). 읽어 주기는 탭마다 tabBarAccessibilityLabel
        tabBarShowLabel: false,
        tabBarActiveTintColor: tabTint.active,
        tabBarInactiveTintColor: tabTint.inactive,
        tabBarIconStyle: { width: 44, height: ICON },
        tabBarItemStyle: tabItemStyle,
        tabBarStyle: tabBarStyle(insets.bottom),
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: ko.tabs.shelf,
          tabBarAccessibilityLabel: ko.tabs.shelf,
          tabBarIcon: ({ color, focused }) => <ShelfIcon color={String(color)} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="bookmarks"
        options={{
          title: ko.tabs.bookmarks,
          tabBarAccessibilityLabel: ko.tabs.bookmarks,
          tabBarIcon: ({ color, focused }) => <BookmarkTabIcon color={String(color)} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          title: ko.tabs.read,
          tabBarAccessibilityLabel: ko.tabs.read,
          tabBarIcon: ({ color, focused }) => <ReadTabIcon color={String(color)} bg={colors.bg} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: ko.tabs.stats,
          tabBarAccessibilityLabel: ko.tabs.stats,
          tabBarIcon: ({ color, focused }) => <RecordTabIcon color={String(color)} bg={ui.bg} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          ...(communityOpen ? {} : { href: null }),
          title: ko.tabs.community,
          tabBarAccessibilityLabel: ko.tabs.community,
          tabBarIcon: ({ color, focused }) => <CommunityTabIcon color={String(color)} bg={ui.bg} size={ICON} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: ko.tabs.me,
          tabBarAccessibilityLabel: ko.tabs.me,
          tabBarIcon: ({ color, focused }) => <ProfileTabIcon color={String(color)} size={ICON} filled={focused} />,
        }}
      />
    </Tabs>
  );
}
