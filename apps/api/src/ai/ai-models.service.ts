import { Inject, Injectable } from '@nestjs/common';
import type { AdminAiModel, AiCatalogEntry, AiModelCard } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { GeminiProvider } from './gemini.provider.js';
import { type FetchLike, LlmProvider } from './llm-provider.js';
import { OPENAI_COMPATIBLE_BASES, OpenAiCompatibleProvider } from './openai-compatible.provider.js';

export const AI_FETCH = Symbol('AI_FETCH');

/** Provider adapters for which a key is configured. Others are simply unavailable. */
export function buildProviders(env: Env, fetchImpl?: FetchLike): Map<AiCatalogEntry['provider'], LlmProvider> {
  const out = new Map<AiCatalogEntry['provider'], LlmProvider>();
  const common = { fetch: fetchImpl, timeoutMs: env.AI_TIMEOUT_MS };
  if (env.GEMINI_API_KEY) out.set('gemini', new GeminiProvider({ apiKey: env.GEMINI_API_KEY, ...common }));
  for (const id of ['groq', 'mistral', 'openrouter'] as const) {
    const key = { groq: env.GROQ_API_KEY, mistral: env.MISTRAL_API_KEY, openrouter: env.OPENROUTER_API_KEY }[id];
    if (key) out.set(id, new OpenAiCompatibleProvider({ id, baseUrl: OPENAI_COMPATIBLE_BASES[id], apiKey: key, ...common }));
  }
  if (env.AI_CUSTOM_BASE_URL && env.AI_CUSTOM_API_KEY) {
    out.set('custom', new OpenAiCompatibleProvider({ id: 'custom', baseUrl: env.AI_CUSTOM_BASE_URL, apiKey: env.AI_CUSTOM_API_KEY, ...common }));
  }
  return out;
}

export interface AvailableModel {
  entry: AiCatalogEntry;
  provider: LlmProvider;
}

export function toCard(e: AiCatalogEntry): AiModelCard {
  const { model: _model, ...card } = e;
  return card;
}

/** Catalogue (environment), admin activation (database) and provider keys (environment) combined. */
@Injectable()
export class AiModelsService {
  private readonly providers: Map<AiCatalogEntry['provider'], LlmProvider>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    @Inject(AI_FETCH) fetchImpl: FetchLike | undefined,
  ) {
    this.providers = buildProviders(env, fetchImpl);
  }

  catalog(): AiCatalogEntry[] {
    return this.env.AI_MODELS;
  }

  entry(id: string): AiCatalogEntry | undefined {
    return this.catalog().find((e) => e.id === id);
  }

  private async enabledIds(): Promise<Set<string>> {
    const res = await this.db.execute(sql`SELECT model_id FROM ai_model_settings WHERE enabled`);
    return new Set((res.rows as { model_id: string }[]).map((r) => r.model_id));
  }

  /** Enabled by an admin AND the key of its provider is configured. Catalogue order. */
  async available(): Promise<AvailableModel[]> {
    const enabled = await this.enabledIds();
    const out: AvailableModel[] = [];
    for (const entry of this.catalog()) {
      const provider = this.providers.get(entry.provider);
      if (provider && enabled.has(entry.id)) out.push({ entry, provider });
    }
    return out;
  }

  /** Gemini first when available (owner decision), otherwise the first available model. */
  defaultOf(models: AvailableModel[]): AvailableModel | undefined {
    return models.find((m) => m.entry.provider === 'gemini') ?? models[0];
  }

  async adminList(): Promise<AdminAiModel[]> {
    const enabled = await this.enabledIds();
    return this.catalog().map((e) => {
      const providerConfigured = this.providers.has(e.provider);
      const isOn = enabled.has(e.id);
      return { ...e, enabled: isOn, providerConfigured, available: isOn && providerConfigured };
    });
  }

  async setEnabled(modelId: string, enabled: boolean, actorUserId: string, meta: RequestMeta): Promise<AdminAiModel> {
    if (!this.entry(modelId)) throw AppError.notFound('Model not found');
    await this.db.transaction(async (tx) => {
      const cur = await tx.execute(sql`SELECT enabled FROM ai_model_settings WHERE model_id = ${modelId} FOR UPDATE`);
      const from = (cur.rows[0] as { enabled: boolean } | undefined)?.enabled ?? false;
      await tx.execute(sql`
        INSERT INTO ai_model_settings (model_id, enabled, updated_by, updated_at) VALUES (${modelId}, ${enabled}, ${actorUserId}::uuid, now())
        ON CONFLICT (model_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record({ action: 'ai.model_toggled', actorUserId, meta, metadata: { modelId, from, to: enabled } }, tx);
    });
    return (await this.adminList()).find((m) => m.id === modelId)!;
  }
}
