import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { MyIcon, RecordIcon, ShelfIcon } from '@/ui/TabIcons';
import { colors, navigation } from '@/ui/theme';

// Icons float over the same paper and shadows as the shelf scene.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarShowLabel: false,
      tabBarActiveTintColor: colors.tabActive,
      tabBarInactiveTintColor: colors.tabInactive,
      tabBarStyle: {
        position: 'absolute', backgroundColor: 'transparent', borderTopWidth: 0,
        elevation: 0, shadowOpacity: 0, height: navigation.height + insets.bottom,
        paddingBottom: insets.bottom, paddingTop: 0,
      },
      sceneStyle: { backgroundColor: 'transparent' },
    }}>
      <Tabs.Screen name="index" options={{
        title: ko.tabs.shelf, tabBarAccessibilityLabel: ko.tabs.shelf,
        tabBarIcon: ({ color }) => <ShelfIcon color={String(color)} size={navigation.iconSize} filled />,
      }} />
      <Tabs.Screen name="record" options={{
        title: ko.tabs.record, tabBarAccessibilityLabel: ko.tabs.record,
        tabBarIcon: ({ color }) => <RecordIcon color={String(color)} bg={colors.bg} size={navigation.iconSize} filled />,
      }} />
      <Tabs.Screen name="my" options={{
        title: ko.tabs.my, tabBarAccessibilityLabel: ko.tabs.my,
        tabBarIcon: ({ color }) => <MyIcon color={String(color)} size={navigation.iconSize} filled />,
      }} />
    </Tabs>
  );
}
