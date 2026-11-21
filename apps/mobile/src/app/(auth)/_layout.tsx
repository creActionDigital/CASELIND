import { Stack } from 'expo-router';

// Le garde de route redirige vers la première route du groupe : welcome passe en premier ; il renvoie vers sign-in
// dès que la présentation a été vue (une seule fois par appareil).
export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
