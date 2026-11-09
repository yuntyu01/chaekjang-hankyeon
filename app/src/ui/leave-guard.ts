// 쓰던 내용이 있을 때 화면을 나가기 전에 묻는다(2026-11-09 UX 점검: 긴 문장이나 사진에서 읽은 글자를 넣은 뒤 뒤로·쓸어 넘기기 한 번이면 다 사라졌다).
// 뒤로 버튼·안드로이드 뒤로·쓸어 넘기기·router.back 모두 같은 길(beforeRemove)로 막힌다.
// 저장한 뒤 스스로 닫을 때는 닫기 전에 release()를 부른다(같은 순간에 닫아도 묻지 않는다).
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useRef } from 'react';

import { appAlert } from '@/ui/alert';

export function useLeaveGuard(dirty: boolean, what = '쓰던 내용') {
  const navigation = useNavigation();
  const released = useRef(false);
  usePreventRemove(dirty, ({ data }) => {
    if (released.current) {
      navigation.dispatch(data.action);
      return;
    }
    appAlert(`${what}을 버릴까요?`, '지금 나가면 저장되지 않아요.', [
      { text: '계속 쓰기', style: 'cancel' },
      {
        text: '버리기',
        style: 'destructive',
        onPress: () => {
          released.current = true;
          navigation.dispatch(data.action);
        },
      },
    ]);
  });
  return useCallback(() => {
    released.current = true;
  }, []);
}
