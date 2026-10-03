import { navigation } from '@/ui/theme';

// 꾸미기 모드에서는 홈 화면이 탭 바를 숨기고 그 자리에 조작부를 띄운다(HomeScreen이 같은 스타일로 되돌린다).
export function tabBarStyle(bottom: number) {
  return {
    position: 'absolute' as const, backgroundColor: 'transparent', borderTopWidth: 0,
    elevation: 0, shadowOpacity: 0, height: navigation.height + bottom,
    paddingBottom: bottom + navigation.bottomAir, paddingTop: 0, paddingHorizontal: 18,
  };
}
