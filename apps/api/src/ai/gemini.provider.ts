import {
  DEFAULT_LLM_TIMEOUT_MS,
  type FetchLike,
  type LlmChatRequest,
  type LlmChatResult,
  LlmProvider,
  LlmProviderError,
  postLlmJson,
} from './llm-provider.js';

export interface GeminiOptions {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
}

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

/**
 * Google AI Studio (Gemini API) adapter.
 * Source: https://ai.google.dev/api/generate-content (now https://aistudio.google.com/api-reference/generate-content)
 *   POST {base}/models/{model}:generateContent, header `x-goog-api-key`,
 *   body { systemInstruction: {parts:[{text}]}, contents: [{role:'user'|'model', parts:[{text}]}],
 *          generationConfig: {maxOutputTokens, temperature} },
 *   response { candidates[].content.parts[].text, candidates[].finishReason (STOP, MAX_TOKENS, SAFETY...),
 *              promptFeedback.blockReason, usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount} }.
 * Verify against the documentation again when the owner provisions the key.
 */
export class GeminiProvider extends LlmProvider {
  readonly id = 'gemini';
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: GeminiOptions) {
    super();
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const body: Record<string, unknown> = {
      contents: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temperature },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const url = `${this.options.baseUrl ?? GEMINI_BASE_URL}/models/${encodeURIComponent(req.model)}:generateContent`;
    const json = (await postLlmJson(
      'gemini',
      this.fetchImpl,
      url,
      { 'x-goog-api-key': this.options.apiKey },
      body,
      this.options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      req.signal,
    )) as GeminiResponse;
    if (json?.promptFeedback?.blockReason) throw new LlmProviderError('gemini', 'blocked');
    const cand = json?.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    const reason = cand?.finishReason;
    if (!text.trim()) throw new LlmProviderError('gemini', reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' ? 'blocked' : 'empty');
    const u = json.usageMetadata;
    return {
      text,
      finishReason: reason === 'MAX_TOKENS' ? 'length' : reason === 'STOP' || reason === undefined ? 'stop' : reason === 'SAFETY' ? 'blocked' : 'other',
      ...(u ? { usage: { promptTokens: u.promptTokenCount, completionTokens: u.candidatesTokenCount, totalTokens: u.totalTokenCount } } : {}),
    };
  }
}
