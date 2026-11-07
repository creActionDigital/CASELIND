export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Raised by an adapter; the message never contains the code or the recipient. */
export class OtpDeliveryError extends Error {
  constructor(
    readonly provider: string,
    detail: string,
  ) {
    super(`${provider}: ${detail}`);
    this.name = 'OtpDeliveryError';
  }
}

export const OTP_HTTP_TIMEOUT_MS = 5000;

/** One POST with a hard timeout and no retry. Non-2xx and network failures become OtpDeliveryError. */
export async function postJson(
  provider: string,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    throw new OtpDeliveryError(provider, timedOut ? `timeout after ${timeoutMs} ms` : `network error (${name})`);
  }
  if (!res.ok) throw new OtpDeliveryError(provider, `HTTP ${res.status}`);
}
