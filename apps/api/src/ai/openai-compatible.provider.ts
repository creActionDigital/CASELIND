import {
  DEFAULT_LLM_TIMEOUT_MS,
  type FetchLike,
  type LlmChatRequest,
  type LlmChatResult,
  LlmProvider,
  LlmProviderError,
  postLlmJson,
} from './llm-provider.js';

export interface OpenAiCompatibleOptions {
  /** Provider label used in errors only (groq, mistral, openrouter, custom). */
  id: string;
  /** Base URL including the version segment, e.g. https://api.groq.com/openai/v1. */
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export const OPENAI_COMPATIBLE_BASES = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
} as const;

interface ChatCompletion {
  choices?: { message?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/**
 * Any service speaking the OpenAI Chat Completions format:
 * POST {baseUrl}/chat/completions, `Authorization: Bearer <key>`,
 * body { model, messages:[{role,content}], max_tokens, temperature },
 * response { choices[0].message.content, choices[0].finish_reason, usage.{prompt,completion,total}_tokens }.
 * Used for Groq, Mistral, OpenRouter and custom endpoints.
 */
export class OpenAiCompatibleProvider extends LlmProvider {
  readonly id: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    super();
    this.id = options.id;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const json = (await postLlmJson(
      this.id,
      this.fetchImpl,
      `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.options.apiKey}` },
      {
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        stream: false,
      },
      this.options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      req.signal,
    )) as ChatCompletion;
    const choice = json?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    const reason = choice?.finish_reason;
    if (!text.trim()) throw new LlmProviderError(this.id, reason === 'content_filter' ? 'blocked' : 'empty');
    const u = json.usage;
    return {
      text,
      finishReason: reason === 'length' ? 'length' : reason === 'content_filter' ? 'blocked' : reason === 'stop' || !reason ? 'stop' : 'other',
      ...(u ? { usage: { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens } } : {}),
    };
  }
}
