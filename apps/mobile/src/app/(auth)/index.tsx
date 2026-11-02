import { Redirect } from 'expo-router';

// `/` while signed out: the route guard lands on the (auth) group root, which has no screen of its own.
export default function AuthIndex() {
  return <Redirect href="/sign-in" />;
}
