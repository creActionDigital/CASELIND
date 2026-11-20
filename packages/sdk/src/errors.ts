/** Any non-2xx answer of the API: HTTP status, stable code (`rate_limited`, `forbidden`...), message and OAuth `error` when present. */
export class CaselindApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'CaselindApiError';
  }

  /** RFC 6749 error of the token endpoint (`invalid_grant`, `invalid_client`...). */
  get oauthError(): string | undefined {
    const d = this.details as { error?: unknown } | undefined;
    return typeof d?.error === 'string' ? d.error : undefined;
  }
}

/** 429: the application exceeded its quota. Wait `retryAfterSeconds` before calling again. */
export class CaselindRateLimitError extends CaselindApiError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    details?: unknown,
    requestId?: string,
  ) {
    super(429, 'rate_limited', message, details, requestId);
    this.name = 'CaselindRateLimitError';
  }
}

/** 403 `not_declared`: the approved manifest of your app does not declare this endpoint or scope. Declare it in a new version. */
export class CaselindNotDeclaredError extends CaselindApiError {
  constructor(message: string, details?: unknown, requestId?: string) {
    super(403, 'forbidden', message, details, requestId);
    this.name = 'CaselindNotDeclaredError';
  }
}

/** The user has not (or no longer) consented: scope missing from the token, authorization revoked or re-consent required. Restart `beginAuthorization`. */
export class CaselindConsentRequiredError extends CaselindApiError {
  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(status, code, message, details, requestId);
    this.name = 'CaselindConsentRequiredError';
  }
}

/** 429 `notify_quota`: the daily notification limit (per user or per app) is reached; retry after `retryAfterSeconds` (next UTC midnight). */
export class CaselindQuotaError extends CaselindApiError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    details?: unknown,
    requestId?: string,
  ) {
    super(429, 'rate_limited', message, details, requestId);
    this.name = 'CaselindQuotaError';
  }

  get scope(): 'user' | 'app' | undefined {
    const s = (this.details as { scope?: unknown } | undefined)?.scope;
    return s === 'user' || s === 'app' ? s : undefined;
  }
}
