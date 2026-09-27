import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { FileText, UserRound } from 'lucide-react-native';

import { ko } from '@/i18n/ko';
import { ShelfIcon } from '@/ui/TabIcons';
import { colors } from '@/ui/theme';

function TabLabel({ color, focused, text }: { color: ColorValue; focused: boolean; text: string }) {
  return <Text style={{ color, fontSize: 12.5, marginTop: 2, fontWeight: focused ? '700' : '400' }}>{text}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 시안: 탭 바 배경 없이 벽과 이어지고, 선택된 탭만 짙은 먹색·굵게
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: 62 },
        tabBarLabelStyle: { fontSize: 12.5, marginTop: 2 },
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: ko.tabs.shelf, tabBarIcon: ({ color, focused }) => <ShelfIcon color={String(color)} filled={focused} />, tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.shelf} /> }}
      />
      <Tabs.Screen
        name="record"
        options={{ title: ko.tabs.record, tabBarIcon: ({ color }) => <FileText color={color} size={24} strokeWidth={1.4} />, tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.record} /> }}
      />
      <Tabs.Screen
        name="my"
        options={{ title: ko.tabs.my, tabBarIcon: ({ color }) => <UserRound color={color} size={24} strokeWidth={1.4} />, tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.my} /> }}
      />
    </Tabs>
  );
}
