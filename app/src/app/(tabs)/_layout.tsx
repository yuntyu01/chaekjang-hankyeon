import { Tabs } from 'expo-router';
import { LibraryBig, NotebookText, UserRound } from 'lucide-react-native';

import { ko } from '@/i18n/ko';
import { colors } from '@/ui/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line, height: 64 },
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: ko.tabs.shelf, tabBarIcon: ({ color }) => <LibraryBig color={color} size={24} strokeWidth={1.7} /> }}
      />
      <Tabs.Screen
        name="record"
        options={{ title: ko.tabs.record, tabBarIcon: ({ color }) => <NotebookText color={color} size={24} strokeWidth={1.5} /> }}
      />
      <Tabs.Screen
        name="my"
        options={{ title: ko.tabs.my, tabBarIcon: ({ color }) => <UserRound color={color} size={24} strokeWidth={1.5} /> }}
      />
    </Tabs>
  );
}
