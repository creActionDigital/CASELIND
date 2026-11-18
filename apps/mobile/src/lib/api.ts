import { tokenPairSchema, type TokenPair } from '@caselind/contracts';
import type { ZodType } from 'zod';

/** Erreur normalisée : enveloppe `ApiError` des contrats, ou erreur réseau (status 0). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** Lit `details[key]` quand `details` est un objet. */
  detail<T = unknown>(key: string): T | undefined {
    if (this.details && typeof this.details === 'object' && !Array.isArray(this.details)) {
      return (this.details as Record<string, T>)[key];
    }
    return undefined;
  }
}

export interface SessionHooks {
  /** Refresh token courant (stockage sécurisé), ou null. */
  getRefreshToken(): Promise<string | null>;
  /** Appelé avec la nouvelle paire après un refresh réussi (à persister). */
  onTokens(pair: TokenPair): Promise<void> | void;
  /** Refresh impossible (jeton invalide/expiré) : déconnexion locale. */
  onSignedOut(): Promise<void> | void;
}

export interface ApiClientOptions {
  baseUrl: string;
  hooks: SessionHooks;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Schéma Zod de la réponse ; omis pour les 204. */
  schema?: ZodType<T>;
  /** false pour les routes publiques (pas d'en-tête, pas de refresh). */
  auth?: boolean;
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = options.baseUrl.replace(/\/+$/, '');
  let accessToken: string | null = null;
  let refreshing: Promise<string> | null = null;

  async function send(path: string, opts: RequestOptions<unknown>, token: string | null): Promise<Response> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
    try {
      return await doFetch(url.toString(), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new ApiRequestError(0, 'network_error', 'Network request failed');
    }
  }

  async function toError(res: Response): Promise<ApiRequestError> {
    try {
      const json = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } };
      const e = json.error;
      if (e && typeof e.code === 'string') {
        return new ApiRequestError(res.status, e.code, e.message ?? e.code, e.details, e.requestId);
      }
    } catch {
      /* corps non JSON */
    }
    return new ApiRequestError(res.status, res.status >= 500 ? 'internal_error' : 'unknown_error', `HTTP ${res.status}`);
  }

  /** Un seul rafraîchissement en vol : les appels concurrents partagent la même promesse. */
  function refreshOnce(): Promise<string> {
    if (!refreshing) {
      refreshing = (async () => {
        const refreshToken = await options.hooks.getRefreshToken();
        if (!refreshToken) {
          await options.hooks.onSignedOut();
          throw new ApiRequestError(401, 'refresh_token_invalid', 'No refresh token');
        }
        try {
          const pair = await request('/auth/refresh', {
            method: 'POST',
            body: { refreshToken },
            schema: tokenPairSchema,
            auth: false,
          });
          accessToken = pair.accessToken;
          await options.hooks.onTokens(pair);
          return pair.accessToken;
        } catch (err) {
          // Erreur réseau : on garde la session. Rejet du serveur : déconnexion locale.
          if (err instanceof ApiRequestError && err.status !== 0 && err.status !== 429 && err.status < 500) {
            accessToken = null;
            await options.hooks.onSignedOut();
          }
          throw err;
        }
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function request<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const usedToken = accessToken;
    let res = await send(path, opts, usedToken);

    if (res.status === 401 && opts.auth !== false) {
      const err = await toError(res);
      if (err.code !== 'unauthenticated') throw err;
      // Si un autre appel a déjà renouvelé le jeton entre-temps, on réessaie simplement avec lui.
      const fresh = accessToken && accessToken !== usedToken ? accessToken : await refreshOnce();
      res = await send(path, opts, fresh);
    }

    if (!res.ok) throw await toError(res);
    if (res.status === 204 || !opts.schema) return undefined as T;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiRequestError(res.status, 'invalid_response', 'Response is not valid JSON');
    }
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiRequestError(res.status, 'invalid_response', 'Response does not match the contract');
    }
    return parsed.data;
  }

  return {
    request,
    setAccessToken(token: string | null) {
      accessToken = token;
    },
    getAccessToken: () => accessToken,
    /** Tente de restaurer une session depuis le refresh token stocké. */
    restore: () => refreshOnce(),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
