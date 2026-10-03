import { useLocalSearchParams } from 'expo-router';
import { ReadingScreen } from '@/features/reading/ReadingScreen';

// Kept for active-reading shortcuts, recovery and existing deep links.
export default function Session() {
  const { sound, book } = useLocalSearchParams<{ sound?: string; book?: string }>();
  return <ReadingScreen soundOnly={sound === '1'} initialBookId={book} />;
}
