// 홈. 스토어에서 스킨(색·재질)을 바꾸면 홈 그림을 다시 만든다(ui/skin-live): 스토어가 위에 떠 있는 동안은 그대로 두고(고를 때마다 홈을 굽지 않게)
// 홈이 다시 보일 때 그때 스킨으로 새로 마운트한다
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { HomeScreen } from '@/features/home/HomeScreen';
import { useSkinKey } from '@/ui/skin-live';
import { ShelfCover } from '@/ui/start-cover';

export default function HomeRoute() {
  const live = useSkinKey();
  const [shown, setShown] = useState(live);
  // 보이는 동안(포커스) 스킨이 바뀌거나, 다시 보이게 되면 그때 스킨으로
  useFocusEffect(useCallback(() => setShown(live), [live]));
  // 책장이 다 될 때까지 이 탭만 덮는다(ui/start-cover: 하단바와 다른 탭은 쓸 수 있다)
  return (
    <>
      <HomeScreen key={shown} />
      <ShelfCover />
    </>
  );
}
