import type {
  CreateMiniAppPaymentRequest,
  MiniAppMe,
  MiniAppNotifyRequest,
  MiniAppNotifyResponse,
  MiniAppOrderList,
  MiniAppPaymentRequest,
  MiniAppScope,
  TokenResponse,
} from '@caselind/contracts';
import { CaselindApiError, CaselindConsentRequiredError, CaselindNotDeclaredError, CaselindQuotaError, CaselindRateLimitError } from './errors.js';
import { codeChallengeS256, generateCodeVerifier, generateState } from './pkce.js';

export interface CaselindClientOptions {
  /** API origin, e.g. `https://api.example.com` (the SDK adds `/v1`). */
  baseUrl: string;
  /** `clientId` of your application (developer portal). */
  clientId: string;
  /** Confidential applications only; never ship it in a browser or mobile bundle. */
  clientSecret?: string;
  /** One of the https redirect URIs registered for the application, matched exactly. */
  redirectUri: string;
  /** Consent page that opens in CASELIND for the user; default `<baseUrl>/oauth/authorize`. */
  authorizeUrl?: string;
  /** Replaces the global fetch (tests, React Native, proxies). */
  fetch?: typeof fetch;
  /** Called each time tokens change (code exchange, rotation): persist them, the previous refresh token is dead. */
  onTokens?: (tokens: Tokens) => void | Promise<void>;
  /** Automatic retries after a 429 that carries Retry-After (default 2; 0 disables). Daily notification quotas are never retried. */
  maxRetries?: number;
  /** A 429 asking to wait longer than this many seconds is thrown instead of waited for (default 30). */
  maxRetryWaitSeconds?: number;
  /** Replaces the sleep used between retries (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** What you must keep between `beginAuthorization` and the redirect back (session storage, secure store...). */
export interface PendingAuthorization {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: MiniAppScope[];
}

/** `clientRef` is optional: when absent the SDK generates one ONCE per call, so a retry after a network error never creates a second request. */
export type PaymentRequestInput = Omit<CreateMiniAppPaymentRequest, 'clientRef'> & { clientRef?: string };

export type PaymentOutcome = { status: 'paid' | 'declined' | 'expired' | 'cancelled' | 'pending'; request: MiniAppPaymentRequest };

const EXPIRY_SKEW_MS = 30_000;

/** Client of the mini-app API: OAuth 2.0 authorization code + PKCE, scoped resources and PIN payment requests. */
export class CaselindClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private current: Tokens | null = null;
  private refreshing: Promise<Tokens> | null = null;

  constructor(private readonly options: CaselindClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  // ---- authorization -------------------------------------------------------------------------------

  /** Builds the consent URL (S256 challenge, fresh state). Open it, then call `completeAuthorization` with the redirect. */
  async beginAuthorization(scopes: readonly MiniAppScope[]): Promise<PendingAuthorization> {
    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const url = new URL(this.options.authorizeUrl ?? `${this.base}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', await codeChallengeS256(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), state, codeVerifier };
  }

  /** `redirected` is the full redirect URL received by your app (or its query string). The state must match. */
  async completeAuthorization(redirected: string, pending: Pick<PendingAuthorization, 'state' | 'codeVerifier'>): Promise<Tokens> {
    const params = new URL(redirected, this.options.redirectUri).searchParams;
    const error = params.get('error');
    if (error) throw new CaselindApiError(400, 'validation_failed', params.get('error_description') ?? error, { error });
    if (params.get('state') !== pending.state) throw new CaselindApiError(400, 'validation_failed', 'state mismatch', { error: 'invalid_request' });
    const code = params.get('code');
    if (!code) throw new CaselindApiError(400, 'validation_failed', 'no authorization code in the redirect', { error: 'invalid_request' });
    return this.exchangeCode(code, pending.codeVerifier);
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<Tokens> {
    return this.storeTokens(
      await this.token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: this.options.redirectUri }),
    );
  }

  /**
   * Rotates the refresh token: the previous one is dead as soon as this returns. Concurrent callers share one rotation (a second
   * use of a rotated token would cut the whole chain). An `invalid_grant` means the user revoked access: consent is required again.
   */
  refresh(refreshToken = this.current?.refreshToken): Promise<Tokens> {
    if (!refreshToken) return Promise.reject(new CaselindApiError(401, 'unauthenticated', 'no refresh token'));
    this.refreshing ??= this.token({ grant_type: 'refresh_token', refresh_token: refreshToken })
      .then((t) => this.storeTokens(t))
      .catch((err: unknown) => {
        if (err instanceof CaselindApiError && err.oauthError === 'invalid_grant') {
          this.current = null;
          throw new CaselindConsentRequiredError(err.status, err.code, 'the authorization was revoked or expired: ask the user to authorize again', err.details, err.requestId);
        }
        throw err;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  get tokens(): Tokens | null {
    return this.current;
  }

  setTokens(tokens: Tokens | null): void {
    this.current = tokens;
  }

  private async token(body: Record<string, string>): Promise<TokenResponse> {
    const payload: Record<string, string> = { ...body, client_id: this.options.clientId };
    if (this.options.clientSecret) payload.client_secret = this.options.clientSecret;
    return this.send<TokenResponse>('POST', '/oauth/token', { body: payload });
  }

  private storeTokens(t: TokenResponse): Tokens {
    this.current = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      scopes: t.scope.split(' ').filter(Boolean) as MiniAppScope[],
    };
    void this.options.onTokens?.(this.current);
    return this.current;
  }

  // ---- resources (scope in brackets) ---------------------------------------------------------------

  /** [profile.basic] id, name, handle, avatar; phone and e-mail when their scopes were granted. */
  me(): Promise<MiniAppMe> {
    return this.authed<MiniAppMe>('GET', '/miniapp-api/me');
  }

  /** [orders.read] orders of the user with the organisation that publishes the app. */
  orders(params: { limit?: number; cursor?: string } = {}): Promise<MiniAppOrderList> {
    return this.authed<MiniAppOrderList>('GET', '/miniapp-api/orders', { query: params });
  }

  // ---- payments by PIN (wallet.pay) --------------------------------------------------------------

  /** Opens a sandbox payment request; money moves only when the user confirms with their PIN. Idempotent on `clientRef` (generated when omitted). */
  createPaymentRequest(input: PaymentRequestInput): Promise<MiniAppPaymentRequest> {
    const clientRef = input.clientRef ?? globalThis.crypto.randomUUID();
    return this.authed<MiniAppPaymentRequest>('POST', '/miniapp-api/payment-requests', { body: { ...input, clientRef } });
  }

  /**
   * The whole PIN flow: opens the request, calls `onPending` so you can send the user to CASELIND (`caselind://miniapps`),
   * then waits for their decision. Never moves money by itself; resolves with the final outcome (`pending` if the wait timed out).
   */
  async requestPayment(
    input: PaymentRequestInput,
    opts: { onPending?: (request: MiniAppPaymentRequest) => void | Promise<void>; intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ): Promise<PaymentOutcome> {
    const created = await this.createPaymentRequest(input);
    if (created.status === 'pending') await opts.onPending?.(created);
    const final = created.status === 'pending' ? await this.waitForPayment(created.id, opts) : created;
    return { status: final.status, request: final };
  }

  // ---- notifications (notify) --------------------------------------------------------------------

  /** [notify] One notification to the user of the token (5 a day per user; the user can mute your app). `delivered: false` = muted. */
  notify(input: MiniAppNotifyRequest): Promise<MiniAppNotifyResponse> {
    return this.authed<MiniAppNotifyResponse>('POST', '/miniapp-api/notify', { body: input });
  }

  getPaymentRequest(id: string): Promise<MiniAppPaymentRequest> {
    return this.authed<MiniAppPaymentRequest>('GET', `/miniapp-api/payment-requests/${encodeURIComponent(id)}`);
  }

  /** Polls until the user paid, declined, or the request expired or was cancelled (default: every 2 s, up to 10 minutes). */
  async waitForPayment(
    id: string,
    opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ): Promise<MiniAppPaymentRequest> {
    const interval = opts.intervalMs ?? 2000;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = opts.now ?? Date.now;
    const deadline = now() + (opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const req = await this.getPaymentRequest(id);
      if (req.status !== 'pending') return req;
      if (now() >= deadline) return req;
      await sleep(interval);
    }
  }

  // ---- transport -----------------------------------------------------------------------------------

  /** Refreshes an expired access token first, and once more if the API still answers 401. */
  private async authed<T>(method: string, path: string, init: { query?: Record<string, unknown>; body?: unknown } = {}): Promise<T> {
    let t = this.current;
    if (!t) throw new CaselindApiError(401, 'unauthenticated', 'not authorized yet: call completeAuthorization or setTokens');
    if (t.expiresAt - EXPIRY_SKEW_MS <= Date.now()) t = await this.refresh(t.refreshToken);
    try {
      return await this.send<T>(method, path, { ...init, accessToken: t.accessToken });
    } catch (err) {
      if (!(err instanceof CaselindApiError) || err.status !== 401 || err.code !== 'unauthenticated') throw err;
      t = await this.refresh(t.refreshToken);
      return this.send<T>(method, path, { ...init, accessToken: t.accessToken });
    }
  }

  private async send<T>(method: string, path: string, init: { query?: Record<string, unknown>; body?: unknown; accessToken?: string }): Promise<T> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sendOnce<T>(method, path, init);
      } catch (err) {
        const wait = err instanceof CaselindRateLimitError && !(err instanceof CaselindQuotaError) ? err.retryAfterSeconds : undefined;
        if (wait === undefined || attempt >= maxRetries || wait > (this.options.maxRetryWaitSeconds ?? 30)) throw err;
        await sleep(wait * 1000);
      }
    }
  }

  private async sendOnce<T>(method: string, path: string, init: { query?: Record<string, unknown>; body?: unknown; accessToken?: string }): Promise<T> {
    const url = new URL(`${this.base}/v1${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.accessToken) headers.authorization = `Bearer ${init.accessToken}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(url.toString(), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.ok) return json as T;
    const e = (json as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error;
    const message = e?.message ?? `HTTP ${res.status}`;
    const reason = (e?.details as { reason?: unknown } | undefined)?.reason;
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      const after = Number.isFinite(retry) && retry > 0 ? retry : 1;
      if (reason === 'notify_quota') throw new CaselindQuotaError(message, after, e?.details, e?.requestId);
      throw new CaselindRateLimitError(message, after, e?.details, e?.requestId);
    }
    if (res.status === 403 && reason === 'not_declared') throw new CaselindNotDeclaredError(message, e?.details, e?.requestId);
    if (res.status === 403 && path.startsWith('/miniapp-api/')) throw new CaselindConsentRequiredError(403, e?.code ?? 'forbidden', message, e?.details, e?.requestId);
    throw new CaselindApiError(res.status, e?.code ?? 'unknown', message, e?.details, e?.requestId);
  }
}
