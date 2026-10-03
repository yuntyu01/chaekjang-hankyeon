import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ko } from '@/i18n/ko';
import { BookmarkTabIcon, ReadTabIcon, ShelfIcon } from '@/ui/TabIcons';
import { ReferenceUI, type ReferenceMark } from '@/ui/ReferenceUI';
import { tabBarStyle } from '@/ui/tabBar';
import { colors, navigation } from '@/ui/theme';

function TabMark({ name, focused }: { name: ReferenceMark; focused: boolean }) {
  const shelf=name==='shelfLabel';
  const color=focused===shelf ? undefined : focused ? colors.tabActive : colors.tabInactive;
  return <View style={{marginTop:1,transform:[{translateY:4.3}]}}><ReferenceUI name={name} width={(shelf?49:43)*25/52} height={(shelf?28:26)*25/52} color={color}/></View>;
}

// 하단 탭: 책장 · 갈피 · 읽기. 아이콘은 책장 장면과 같은 종이 위에 뜬다.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: tabBarStyle(insets.bottom),
        sceneStyle: { backgroundColor: 'transparent' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: ko.tabs.shelf,
          tabBarLabel: ({ focused }) => <TabMark name="shelfLabel" focused={focused}/>,
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
          tabBarLabel: ({ focused }) => <TabMark name="bookmarkLabel" focused={focused}/>,
          tabBarAccessibilityLabel: ko.tabs.bookmarks,
          tabBarIcon: ({ color, focused }) => focused ? <BookmarkTabIcon color={String(color)} size={navigation.iconSize} filled={focused} /> : <ReferenceUI name="bookmarkIcon" width={navigation.iconSize} height={navigation.iconSize}/>,
        }}
      />
      <Tabs.Screen
        name="read"
        options={{
          // 책장 밖 화면은 탭 바에 종이 바탕을 깐다(내용이 비쳐 보이지 않게)
          tabBarStyle: { display: 'none' },
          title: ko.tabs.read,
          tabBarLabel: ({ focused }) => <TabMark name="readLabel" focused={focused}/>,
          tabBarAccessibilityLabel: ko.tabs.read,
          tabBarIcon: ({ color, focused }) => focused ? <ReadTabIcon color={String(color)} bg={colors.bg} size={navigation.iconSize} filled={focused} /> : <ReferenceUI name="readIcon" width={navigation.iconSize} height={navigation.iconSize}/>,
        }}
      />
    </Tabs>
  );
}
