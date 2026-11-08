export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatRequest {
  /** Provider-side model name. */
  model: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  /** Aborts the call (the adapter also applies its own timeout). */
  signal?: AbortSignal;
}

export interface LlmChatResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  finishReason: 'stop' | 'length' | 'blocked' | 'other';
}

export type LlmErrorKind = 'timeout' | 'network' | 'rate_limited' | 'auth' | 'bad_request' | 'server' | 'empty' | 'blocked';

/** Raised by an adapter. The message is a fixed kind: never a prompt, a response, a key or a provider body. */
export class LlmProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: LlmErrorKind,
  ) {
    super(`${provider}: ${kind}`);
    this.name = 'LlmProviderError';
  }
}

/** Port towards one LLM provider. One call, a hard timeout, no automatic retry. */
export abstract class LlmProvider {
  abstract readonly id: string;
  abstract chat(req: LlmChatRequest): Promise<LlmChatResult>;
}

export const DEFAULT_LLM_TIMEOUT_MS = 30_000;

/** One JSON POST with timeout; HTTP and network failures become LlmProviderError (body never read into the error). */
export async function postLlmJson(
  provider: string,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    throw new LlmProviderError(provider, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!res.ok) {
    const s = res.status;
    throw new LlmProviderError(provider, s === 429 ? 'rate_limited' : s === 401 || s === 403 ? 'auth' : s >= 500 ? 'server' : 'bad_request');
  }
  try {
    return await res.json();
  } catch {
    throw new LlmProviderError(provider, 'server');
  }
}
