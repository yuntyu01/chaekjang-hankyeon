// 이 책의 독서 기록(책 정보에서 들어온다): 기록 탭과 같은 화면을 그 책만 골라 보여 주고, 뒤로 가면 책 정보로 돌아간다
import { useLocalSearchParams } from 'expo-router';

import { StatsScreen } from '@/features/stats/StatsScreen';

export default function BookStats() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StatsScreen initialBook={id} />;
}
