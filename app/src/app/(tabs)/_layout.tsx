import { Tabs } from 'expo-router';

import { ko } from '@/i18n/ko';
import { MyIcon, RecordIcon, ShelfIcon } from '@/ui/TabIcons';
import { colors } from '@/ui/theme';


export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 시안: 탭 바 배경 없이 벽과 이어지고, 선택된 탭만 짙은 먹색·굵게
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: 62 },
        tabBarShowLabel: false, // 글자 없이 속이 찬 아이콘만
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: ko.tabs.shelf, tabBarIcon: ({ color }) => <ShelfIcon color={String(color)} filled size={28} />, tabBarAccessibilityLabel: ko.tabs.shelf }}
      />
      <Tabs.Screen
        name="record"
        options={{ title: ko.tabs.record, tabBarIcon: ({ color }) => <RecordIcon color={String(color)} bg={colors.bg} size={27} />, tabBarAccessibilityLabel: ko.tabs.record }}
      />
      <Tabs.Screen
        name="my"
        options={{ title: ko.tabs.my, tabBarIcon: ({ color }) => <MyIcon color={String(color)} size={27} />, tabBarAccessibilityLabel: ko.tabs.my }}
      />
    </Tabs>
  );
}
