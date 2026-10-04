import { useLocalSearchParams } from 'expo-router';
import { ReadingScreen } from '@/features/reading/ReadingScreen';

export default function ReadTab() {
  const { book } = useLocalSearchParams<{ book?: string }>();
  return <ReadingScreen inTab initialBookId={book} />;
}
