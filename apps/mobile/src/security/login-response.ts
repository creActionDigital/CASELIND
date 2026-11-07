import { loginResponseSchema, type TokenPair } from '@caselind/contracts';

export type LoginOutcome =
  | { kind: 'tokens'; pair: TokenPair }
  | { kind: 'twoFactor'; challengeId: string };

/** Distingue la réponse de `POST /auth/login` : paire de jetons (inchangée) ou défi de double authentification. */
export function classifyLogin(json: unknown): LoginOutcome | null {
  const parsed = loginResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const v = parsed.data;
  if ('twoFactorRequired' in v) return { kind: 'twoFactor', challengeId: v.challengeId };
  return { kind: 'tokens', pair: v };
}
