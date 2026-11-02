// 커뮤니티 보여 주기: 서버가 열었다고 답할 때만 연다(답 전·닫힘·연결 실패는 닫힘)
import React from 'react';
import { act, create } from 'react-test-renderer';

import { useCommunityOpen } from '../useCommunityOpen';

const mockAvailability = jest.fn();
jest.mock('@/services/community', () => ({ communityAvailability: () => mockAvailability() }));

async function openWhen(answer: unknown) {
  mockAvailability.mockResolvedValue(answer);
  const seen: boolean[] = [];
  const Probe = () => {
    seen.push(useCommunityOpen());
    return null;
  };
  await act(async () => {
    create(<Probe />);
  });
  return seen;
}

it('답을 받기 전에는 닫혀 있고, 서버가 열면 열린다', async () => {
  const seen = await openWhen({ ok: true });
  expect(seen[0]).toBe(false);
  expect(seen[seen.length - 1]).toBe(true);
});

it.each(['old-server', 'offline', 'no-server'])('서버가 닫았거나 닿지 않으면(%s) 닫혀 있다', async (reason) => {
  const seen = await openWhen({ ok: false, reason, message: '' });
  expect(seen.every((v) => !v)).toBe(true);
});
