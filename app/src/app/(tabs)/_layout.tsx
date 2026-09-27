import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { ko } from '@/i18n/ko';
import { MyIcon, RecordIcon, ShelfIcon } from '@/ui/TabIcons';
import { colors } from '@/ui/theme';

// 시안: 탭 바 배경 없이 벽과 이어진다. 선택 탭은 속이 찬 아이콘 + 굵은 라벨, 나머지는 윤곽 아이콘.
function TabLabel({ color, focused, text }: { color: ColorValue; focused: boolean; text: string }) {
  return <Text style={{ color, fontSize: 12.5, marginTop: 2, fontWeight: focused ? '700' : '400' }}>{text}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: 66 },
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: ko.tabs.shelf,
          tabBarIcon: ({ color, focused }) => <ShelfIcon color={String(color)} filled={focused} />,
          tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.shelf} />,
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: ko.tabs.record,
          tabBarIcon: ({ color, focused }) => <RecordIcon color={String(color)} bg={colors.bg} filled={focused} />,
          tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.record} />,
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: ko.tabs.my,
          tabBarIcon: ({ color, focused }) => <MyIcon color={String(color)} filled={focused} />,
          tabBarLabel: ({ color, focused }) => <TabLabel color={color} focused={focused} text={ko.tabs.my} />,
        }}
      />
    </Tabs>
  );
}
