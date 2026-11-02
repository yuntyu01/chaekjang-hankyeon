// 커뮤니티를 보여 줄지. 서버 스위치(COMMUNITY_ENABLED → /healthz community)로 정한다: 처음 출시는 닫아 두고 사람이 모이면 앱 업데이트 없이 연다(2026-11-02 사용자).
// 답을 받기 전이나 연결이 안 되면 닫힌 것으로 본다(인터넷 없이는 쓸 수 없는 기능이다). 내 별점·감상은 커뮤니티와 따로라 그대로 있다.
import { useEffect, useState } from 'react';

import { communityAvailability } from '@/services/community';

export function useCommunityOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void communityAvailability().then((a) => {
      if (live) setOpen(a.ok);
    });
    return () => {
      live = false;
    };
  }, []);
  return open;
}
