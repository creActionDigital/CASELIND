import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/auth-context';
import { rememberPendingLink } from '../auth/pending-link';
import { I18nProvider } from '../i18n';
import { RealtimeProvider } from '../realtime/realtime-context';
import { useTheme } from '../theme/use-theme';
import { Wordmark } from '../ui';

function Gate() {
  const { status } = useAuth();
  const { colors, isDark } = useTheme();
  // Lien de consentement mini-app ouvert hors connexion : mémorisé, rejoué après la connexion ((app)/_layout).
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    const keep = (url: string | null | undefined) => {
      if (statusRef.current !== 'signedIn') rememberPendingLink(url);
    };
    void Linking.getInitialURL().then(keep).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => keep(e.url));
    return () => sub.remove();
  }, []);
  // Police de marque : on attend son chargement (ou son échec, alors police système) avant d'afficher l'app.
  const [fontsLoaded, fontError] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold });
  if (status === 'loading' || (!fontsLoaded && !fontError)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.background }}>
        <Wordmark size={28} vertical />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Garde de route : non connecté -> (auth), connecté -> (app). */}
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'restricted'}>
          <Stack.Screen name="restricted" options={{ headerShown: true, headerStyle: { backgroundColor: colors.surface }, headerTitleStyle: { color: colors.text } }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <AuthProvider>
            <RealtimeProvider>
              <Gate />
            </RealtimeProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
