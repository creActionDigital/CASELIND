import {
  challengeResponseSchema,
  meSchema,
  tokenPairSchema,
  type ChallengeResponse,
  type Me,
  type TokenPair,
} from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { z } from 'zod';
import { isLocale, useI18n } from '../i18n';
import { ApiRequestError, createApiClient } from '../lib/api';
import { API_URL } from '../lib/config';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from '../lib/token-store';
import { classifyLogin } from '../security/login-response';

export type SignInResult = { twoFactorRequired: true; challengeId: string } | null;

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  /** Renvoie le défi de double authentification quand le compte en a une, sinon se connecte. */
  signIn(identifier: string, password: string): Promise<SignInResult>;
  verifyTwoFactor(challengeId: string, factor: { code: string } | { backupCode: string }): Promise<void>;
  register(input: { identifier: string; password: string; displayName: string }): Promise<ChallengeResponse>;
  verifyOtp(challengeId: string, code: string): Promise<void>;
  resendOtp(challengeId: string): Promise<ChallengeResponse>;
  forgotPassword(identifier: string): Promise<ChallengeResponse>;
  resetPassword(input: { challengeId: string; code: string; newPassword: string }): Promise<void>;
  signOut(): Promise<void>;
  setMe(me: Me): void;
}

const AuthContext = createContext<AuthValue | null>(null);

const device = {
  platform: (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'other') as
    | 'ios'
    | 'android'
    | 'web'
    | 'other',
};

/** Client API unique de l'application ; ses hooks sont branchés par AuthProvider. */
let signedOutListener: (() => void) | null = null;
export const api = createApiClient({
  baseUrl: API_URL,
  hooks: {
    getRefreshToken,
    onTokens: (pair) => setRefreshToken(pair.refreshToken),
    onSignedOut: async () => {
      await clearRefreshToken();
      signedOutListener?.();
    },
  },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMeState] = useState<Me | null>(null);
  const queryClient = useQueryClient();
  const { setLocale } = useI18n();
  const applyLocale = useRef(setLocale);
  applyLocale.current = setLocale;

  const localSignOut = useCallback(() => {
    api.setAccessToken(null);
    setMeState(null);
    setStatus('signedOut');
    queryClient.clear();
    void import('../media/auth-media').then((m) => m.clearAuthMediaCache());
  }, [queryClient]);

  useEffect(() => {
    signedOutListener = localSignOut;
    return () => {
      signedOutListener = null;
    };
  }, [localSignOut]);

  const loadMe = useCallback(async () => {
    const profile = await api.request('/me', { schema: meSchema });
    setMeState(profile);
    if (isLocale(profile.locale)) applyLocale.current(profile.locale);
    setStatus('signedIn');
  }, []);

  // Restauration de session au démarrage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getRefreshToken();
      if (!stored) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        await api.restore();
        if (!cancelled) await loadMe();
      } catch (err) {
        // Réseau coupé au démarrage : on ne détruit pas la session, on retourne à l'écran de connexion.
        if (!cancelled && !(err instanceof ApiRequestError && err.status !== 0 && err.status < 500)) {
          setStatus('signedOut');
        }
        // Toute autre erreur (réponse non conforme au contrat, 4xx déjà traité ailleurs) ne doit jamais
        // laisser l'application bloquée sur l'écran de chargement.
        if (!cancelled) setStatus((s) => (s === 'loading' ? 'signedOut' : s));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const acceptTokens = useCallback(
    async (pair: TokenPair) => {
      api.setAccessToken(pair.accessToken);
      await setRefreshToken(pair.refreshToken);
      await loadMe();
    },
    [loadMe],
  );

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      setMe: setMeState,
      async signIn(identifier, password) {
        const raw = await api.request('/auth/login', {
          method: 'POST',
          body: { identifier: identifier.trim(), password, device },
          schema: z.unknown(),
          auth: false,
        });
        const outcome = classifyLogin(raw);
        if (!outcome) throw new ApiRequestError(200, 'invalid_response', 'Response does not match the contract');
        if (outcome.kind === 'twoFactor') return { twoFactorRequired: true, challengeId: outcome.challengeId };
        await acceptTokens(outcome.pair);
        return null;
      },
      async verifyTwoFactor(challengeId, factor) {
        const pair = await api.request('/auth/2fa/verify', {
          method: 'POST',
          body: { challengeId, ...factor, device },
          schema: tokenPairSchema,
          auth: false,
        });
        await acceptTokens(pair);
      },
      register: (input) =>
        api.request('/auth/register', {
          method: 'POST',
          body: { ...input, identifier: input.identifier.trim(), displayName: input.displayName.trim() },
          schema: challengeResponseSchema,
          auth: false,
        }),
      async verifyOtp(challengeId, code) {
        const pair = await api.request('/auth/otp/verify', {
          method: 'POST',
          body: { challengeId, code, device },
          schema: tokenPairSchema,
          auth: false,
        });
        await acceptTokens(pair);
      },
      resendOtp: (challengeId) =>
        api.request('/auth/otp/resend', {
          method: 'POST',
          body: { challengeId },
          schema: challengeResponseSchema,
          auth: false,
        }),
      forgotPassword: (identifier) =>
        api.request('/auth/password/forgot', {
          method: 'POST',
          body: { identifier: identifier.trim() },
          schema: challengeResponseSchema,
          auth: false,
        }),
      async resetPassword(input) {
        await api.request('/auth/password/reset', { method: 'POST', body: input, auth: false });
      },
      async signOut() {
        // Le jeton push est retiré tant que le jeton d'accès est valide, avant la révocation de la session.
        const { unregisterPush } = await import('../notifications/push');
        await unregisterPush();
        try {
          await api.request('/auth/logout', { method: 'POST' });
        } catch {
          // Même si le serveur est injoignable, on efface localement.
        }
        await clearRefreshToken();
        localSignOut();
      },
    }),
    [status, me, acceptTokens, localSignOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
