import { Inject, Injectable } from '@nestjs/common';
import {
  type AiConversation,
  type AiMessage,
  type AiModelList,
  type AiSettings,
  ErrorCodes,
  type ProductDescriptionRequest,
  type ProductDescriptionResult,
  type SendAiMessageResult,
  type UpdateAiSettingsRequest,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { type AvailableModel, AiModelsService, toCard } from './ai-models.service.js';
import { type LlmMessage, LlmProviderError } from './llm-provider.js';

/**
 * CASELIND system prompt. Kept in code (never in the database). French by default, states it is an AI,
 * and must not invent facts about the application.
 */
export const SYSTEM_PROMPT = [
  "Tu es l'assistant IA de CASELIND, une application de messagerie, de réseau social, de commerce, de services et de paiement.",
  "Tu es une intelligence artificielle, pas un humain : dis-le clairement si on te le demande.",
  "Réponds en français par défaut, ou dans la langue de l'utilisateur s'il écrit dans une autre langue. Sois clair, concis et poli.",
  "N'invente jamais de faits sur CASELIND (fonctionnalités, prix, délais, règles, comptes ou commandes) : si tu ne le sais pas, dis-le et propose de contacter le support.",
  "Tu n'as accès à aucune donnée de l'utilisateur ni des autres : ni messages privés, ni paiements, ni pièces d'identité. Ne demande jamais de mot de passe, de code ou de numéro de carte.",
  "Tu ne donnes pas de conseil médical, juridique ou financier personnalisé.",
  "Pour une question de santé, tu ne remplaces jamais un professionnel : reste général, ne pose pas de diagnostic, ne conseille ni dose ni traitement, et invite à consulter un médecin ou un pharmacien ; en cas d'urgence (douleur forte, difficulté à respirer, perte de connaissance, idées suicidaires), dis d'appeler immédiatement les secours locaux.",
].join('\n');

const PRODUCT_PROMPT = [
  "Tu rédiges une fiche produit pour une boutique CASELIND, en français.",
  "Utilise uniquement le titre et les faits fournis ; n'invente aucune caractéristique, aucun prix, aucune garantie ni aucun délai.",
  "Écris 2 à 4 phrases, ton commercial sobre, sans émojis ni titres. Réponds avec la description seule.",
].join('\n');

const HISTORY_WINDOW = 20;
const MAX_CONVERSATIONS = 200;
const TEMPERATURE = 0.4;

const iso = (v: string | Date): string => new Date(v).toISOString();

interface Row {
  [k: string]: unknown;
}

@Injectable()
export class AiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly models: AiModelsService,
  ) {}

  // ---- models and settings ------------------------------------------------------------------------

  async listModels(): Promise<AiModelList> {
    const available = await this.models.available();
    return { items: available.map((m) => toCard(m.entry)), defaultModelId: this.models.defaultOf(available)?.entry.id ?? null };
  }

  async getSettings(userId: string): Promise<AiSettings> {
    const res = await this.db.execute(sql`SELECT model_id, allow_fallback, acknowledged_data_notice FROM ai_user_settings WHERE user_id = ${userId}::uuid`);
    const r = res.rows[0] as { model_id: string | null; allow_fallback: boolean; acknowledged_data_notice: boolean } | undefined;
    return { modelId: r?.model_id ?? null, allowFallback: r?.allow_fallback ?? false, acknowledgedDataNotice: r?.acknowledged_data_notice ?? false };
  }

  async updateSettings(userId: string, patch: UpdateAiSettingsRequest): Promise<AiSettings> {
    const cur = await this.getSettings(userId);
    const next: AiSettings = {
      modelId: patch.modelId === undefined ? cur.modelId : patch.modelId,
      allowFallback: patch.allowFallback ?? cur.allowFallback,
      acknowledgedDataNotice: patch.acknowledgedDataNotice ?? cur.acknowledgedDataNotice,
    };
    const available = await this.models.available();
    if (next.modelId !== null) {
      if (!this.models.entry(next.modelId)) throw AppError.notFound('Model not found');
      if (!available.some((m) => m.entry.id === next.modelId)) {
        throw AppError.conflict('This model is not available', { reason: 'model_unavailable' });
      }
    }
    const chosen = next.modelId ? this.models.entry(next.modelId) : this.models.defaultOf(available)?.entry;
    if (chosen?.trainsOnData === true && !next.acknowledgedDataNotice) throw dataNotice(chosen.id);
    await this.db.execute(sql`
      INSERT INTO ai_user_settings (user_id, model_id, allow_fallback, acknowledged_data_notice, acknowledged_at, updated_at)
      VALUES (${userId}::uuid, ${next.modelId}, ${next.allowFallback}, ${next.acknowledgedDataNotice}, ${next.acknowledgedDataNotice ? sql`now()` : sql`NULL`}, now())
      ON CONFLICT (user_id) DO UPDATE SET model_id = EXCLUDED.model_id, allow_fallback = EXCLUDED.allow_fallback,
        acknowledged_data_notice = EXCLUDED.acknowledged_data_notice,
        acknowledged_at = CASE WHEN EXCLUDED.acknowledged_data_notice AND NOT ai_user_settings.acknowledged_data_notice THEN now()
                               WHEN EXCLUDED.acknowledged_data_notice THEN ai_user_settings.acknowledged_at ELSE NULL END,
        updated_at = now()`);
    return next;
  }

  // ---- conversations ------------------------------------------------------------------------------

  async createConversation(userId: string, title?: string): Promise<AiConversation> {
    const n = await this.db.execute(sql`SELECT count(*)::int AS n FROM ai_conversations WHERE user_id = ${userId}::uuid`);
    if ((n.rows[0] as { n: number }).n >= MAX_CONVERSATIONS) throw AppError.conflict('Too many conversations: delete some first', { reason: 'conversations_limit' });
    const res = await this.db.execute(sql`
      INSERT INTO ai_conversations (user_id, title) VALUES (${userId}::uuid, ${title ?? 'Nouvelle conversation'})
      RETURNING id, title, created_at, updated_at`);
    return toConversation(res.rows[0] as Row);
  }

  async listConversations(userId: string): Promise<{ items: AiConversation[] }> {
    const res = await this.db.execute(sql`
      SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ${userId}::uuid ORDER BY updated_at DESC, id LIMIT 200`);
    return { items: res.rows.map((r) => toConversation(r as Row)) };
  }

  /** Foreign or malformed ids are 404, like any private resource. */
  private async owned(userId: string, id: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw AppError.notFound('Conversation not found');
    const res = await this.db.execute(sql`SELECT 1 FROM ai_conversations WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    if (res.rows.length === 0) throw AppError.notFound('Conversation not found');
  }

  async listMessages(userId: string, id: string): Promise<{ items: AiMessage[] }> {
    await this.owned(userId, id);
    const res = await this.db.execute(sql`
      SELECT id, role, content, model_id, created_at FROM ai_messages WHERE conversation_id = ${id}::uuid ORDER BY created_at, id LIMIT 1000`);
    return { items: res.rows.map((r) => toMessage(r as Row)) };
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.db.execute(sql`DELETE FROM ai_conversations WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
  }

  async sendMessage(userId: string, id: string, content: string): Promise<SendAiMessageResult> {
    await this.owned(userId, id);
    const hist = await this.db.execute(sql`
      SELECT role, content FROM (SELECT role, content, created_at, id FROM ai_messages WHERE conversation_id = ${id}::uuid ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_WINDOW}) h
      ORDER BY created_at, id`);
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(hist.rows as { role: 'user' | 'assistant'; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];
    const out = await this.generate(userId, messages);
    const saved = await this.db.transaction(async (tx) => {
      const u = await tx.execute(sql`INSERT INTO ai_messages (conversation_id, role, content) VALUES (${id}::uuid, 'user', ${content}) RETURNING id, role, content, model_id, created_at`);
      const a = await tx.execute(sql`INSERT INTO ai_messages (conversation_id, role, content, model_id) VALUES (${id}::uuid, 'assistant', ${out.text}, ${out.model.entry.id}) RETURNING id, role, content, model_id, created_at`);
      await tx.execute(sql`
        UPDATE ai_conversations SET updated_at = now(),
          title = CASE WHEN title = 'Nouvelle conversation' THEN ${content.replace(/\s+/g, ' ').slice(0, 60)} ELSE title END
        WHERE id = ${id}::uuid`);
      return { user: toMessage(u.rows[0] as Row), reply: toMessage(a.rows[0] as Row) };
    });
    return { userMessage: saved.user, reply: saved.reply, modelId: out.model.entry.id, fallbackUsed: out.fallbackUsed, aiGenerated: true };
  }

  // ---- seller help --------------------------------------------------------------------------------

  /** Only the title and facts typed by the seller are sent. The draft is never stored nor published. */
  async productDescription(userId: string, req: ProductDescriptionRequest): Promise<ProductDescriptionResult> {
    const prompt = `Titre : ${req.title}\nFaits :\n${req.facts.map((f) => `- ${f}`).join('\n')}`;
    const out = await this.generate(userId, [
      { role: 'system', content: PRODUCT_PROMPT },
      { role: 'user', content: prompt },
    ]);
    return { description: out.text.trim(), modelId: out.model.entry.id, fallbackUsed: out.fallbackUsed, aiGenerated: true };
  }

  // ---- generation ---------------------------------------------------------------------------------

  private async reserveQuota(userId: string): Promise<void> {
    const res = await this.db.execute(sql`
      INSERT INTO ai_usage_daily (user_id, day, count) VALUES (${userId}::uuid, (now() AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (user_id, day) DO UPDATE SET count = ai_usage_daily.count + 1 WHERE ai_usage_daily.count < ${this.env.AI_DAILY_MESSAGES}
      RETURNING count`);
    if (res.rows.length === 0) {
      throw new AppError(429, ErrorCodes.rateLimited, 'Daily AI quota reached, try again tomorrow', { reason: 'ai_daily_quota', limit: this.env.AI_DAILY_MESSAGES });
    }
  }

  private async refundQuota(userId: string): Promise<void> {
    await this.db.execute(sql`UPDATE ai_usage_daily SET count = GREATEST(count - 1, 0) WHERE user_id = ${userId}::uuid AND day = (now() AT TIME ZONE 'UTC')::date`);
  }

  /** Picks the candidates (requested model first, others only with allowFallback), reserves quota and calls them in order. */
  private async generate(userId: string, messages: LlmMessage[]): Promise<{ text: string; model: AvailableModel; fallbackUsed: boolean }> {
    const settings = await this.getSettings(userId);
    const available = await this.models.available();
    const primary = settings.modelId ? available.find((m) => m.entry.id === settings.modelId) : this.models.defaultOf(available);
    const acceptable = (m: AvailableModel): boolean => m.entry.trainsOnData !== true || settings.acknowledgedDataNotice;

    let candidates: AvailableModel[] = primary ? [primary] : [];
    if (primary && !acceptable(primary)) throw dataNotice(primary.entry.id);
    if (settings.allowFallback) candidates = [...candidates, ...available.filter((m) => m !== primary && acceptable(m))];
    if (candidates.length === 0) {
      // A chosen model that went away without fallback, or nothing enabled at all.
      const gone = settings.modelId !== null && !primary;
      throw new AppError(503, ErrorCodes.aiUnavailable, 'The AI assistant is currently unavailable', gone ? { reason: 'model_unavailable' } : undefined);
    }

    await this.reserveQuota(userId);
    let last: LlmProviderError | undefined;
    for (const m of candidates) {
      try {
        const r = await m.provider.chat({ model: m.entry.model, messages, maxTokens: this.env.AI_MAX_OUTPUT_TOKENS, temperature: TEMPERATURE });
        return { text: r.text, model: m, fallbackUsed: m !== candidates[0] || (primary === undefined) };
      } catch (err) {
        last = err instanceof LlmProviderError ? err : new LlmProviderError(m.provider.id, 'server');
      }
    }
    await this.refundQuota(userId);
    throw new AppError(502, ErrorCodes.aiProviderError, 'The AI provider could not answer, try again later', { reason: last?.kind ?? 'server' });
  }
}

function dataNotice(modelId: string): AppError {
  return new AppError(409, ErrorCodes.dataNoticeRequired, 'This model may train on submitted data: accept the data notice first', { modelId });
}

function toConversation(r: Row): AiConversation {
  return { id: r.id as string, title: r.title as string, createdAt: iso(r.created_at as string | Date), updatedAt: iso(r.updated_at as string | Date) };
}

function toMessage(r: Row): AiMessage {
  return { id: r.id as string, role: r.role as 'user' | 'assistant', content: r.content as string, modelId: (r.model_id as string | null) ?? null, createdAt: iso(r.created_at as string | Date) };
}
