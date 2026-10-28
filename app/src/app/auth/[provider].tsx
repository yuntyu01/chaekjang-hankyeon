import { Redirect } from 'expo-router';

// The system auth session consumes the ticket. Avoid showing the callback query in an unmatched route.
export default function AuthReturn() {
  return <Redirect href="/settings" />;
}
