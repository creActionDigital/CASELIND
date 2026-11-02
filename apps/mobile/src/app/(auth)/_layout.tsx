import { Stack } from 'expo-router';

// Le garde de route redirige vers la première route du groupe : sign-in doit passer en premier.
export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
