import { Inject, Injectable } from '@nestjs/common';
import { AI_ACTION_TTL_MINUTES, type AiAction, type AiActionTool, type AiCartLine } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { FlagsService } from '../flags/flags.service.js';
import { StorefrontService } from '../catalog/storefront.service.js';
import { UUID_RE } from '../catalog/catalog.shared.js';
import { aiActionsEnabled, coordinatesFromUser, defaultLabel, type ParsedReply, type Proposal, textFromUser } from './ai-actions.logic.js';

export type ActionLogStatus = 'proposed' | 'confirmed' | 'dismissed' | 'expired' | 'failed' | 'ignored';

interface Row {
  [k: string]: unknown;
}

export function toAction(r: Row): AiAction {
  return {
    id: r.id as string,
    tool: r.tool as AiActionTool,
    args: r.args as Record<string, unknown>,
    label: r.label as string,
    status: r.status as AiAction['status'],
    expiresAt: new Date(r.expires_at as string | Date).toISOString(),
  };
}

const money = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`;

/**
 * Proposals of the assistant: gate (emergency stop), validation against what the user actually wrote, storage
 * and the arguments-free journal. Nothing here executes anything.
 */
@Injectable()
export class AiActionStore {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly flags: FlagsService,
    private readonly storefront: StorefrontService,
  ) {}

  async enabled(userId: string): Promise<boolean> {
    const production = this.env.NODE_ENV === 'production';
    const flagOn = this.env.AI_ACTIONS_ENABLED === undefined && production ? await this.flags.evaluateForUser('ai_actions', userId) : false;
    return aiActionsEnabled({ envFlag: this.env.AI_ACTIONS_ENABLED, production, flagOn });
  }

  /** One journal line: user, tool, status, date. Never an argument. */
  async log(userId: string, tool: AiActionTool | 'unknown', status: ActionLogStatus): Promise<void> {
    await this.db.execute(sql`INSERT INTO ai_action_log (user_id, tool, status) VALUES (${userId}::uuid, ${tool}, ${status})`);
  }

  /** Keeps the proposals that hold up against the user's own message; stores them; journals the rest as ignored. */
  async record(userId: string, conversationId: string, reply: ParsedReply, userMessage: string): Promise<AiAction[]> {
    for (const t of reply.ignoredTools) await this.log(userId, t, 'ignored');
    const out: AiAction[] = [];
    for (const p of reply.proposals) {
      const ready = await this.prepare(userId, p, userMessage);
      if (!ready) {
        await this.log(userId, p.tool, 'ignored');
        continue;
      }
      const res = await this.db.execute(sql`
        INSERT INTO ai_actions (user_id, conversation_id, tool, args, label, expires_at)
        VALUES (${userId}::uuid, ${conversationId}::uuid, ${p.tool}, ${JSON.stringify(ready.args)}::jsonb, ${ready.label},
                now() + make_interval(mins => ${AI_ACTION_TTL_MINUTES}))
        RETURNING id, tool, args, label, status, expires_at`);
      out.push(toAction(res.rows[0] as Row));
      await this.log(userId, p.tool, 'proposed');
    }
    return out;
  }

  private async prepare(userId: string, p: Proposal, userMessage: string): Promise<{ args: Record<string, unknown>; label: string } | null> {
    const a = p.args;
    if (p.tool === 'summarize_text' && !textFromUser(String(a.text), userMessage)) return null;
    if (p.tool === 'search_places' && !coordinatesFromUser(Number(a.lat), Number(a.lng), userMessage)) return null;
    if (p.tool === 'prepare_cart') {
      const lines = await this.resolveCart(userId, a.items as { q: string; quantity: number }[]);
      if (lines.length === 0) return null;
      const label = `Ajouter au panier : ${lines.map((l) => `${l.quantity} × ${l.title} (${money(l.priceMinor, l.currency)})`).join(', ')}`;
      return { args: { lines }, label: label.slice(0, 120) };
    }
    return { args: a, label: p.label ?? defaultLabel(p.tool, a) };
  }

  /** Wishes to concrete variants: the cheapest in-stock variant of the best match the user can buy. */
  private async resolveCart(userId: string, items: { q: string; quantity: number }[]): Promise<AiCartLine[]> {
    const lines: AiCartLine[] = [];
    for (const it of items) {
      const found = await this.storefront.search(userId, { q: it.q, sort: 'price_asc', limit: 1 });
      const card = found.items[0];
      if (!card) continue;
      const detail = await this.storefront.detail(userId, card.id);
      const variant = detail.variants.filter((v) => v.inStock).sort((x, y) => x.priceMinor - y.priceMinor)[0];
      if (!variant) continue;
      lines.push({ variantId: variant.id, quantity: it.quantity, title: detail.title.slice(0, 80), priceMinor: variant.priceMinor, currency: variant.currency });
    }
    return lines;
  }

  /** Still-pending proposals of a conversation (expired ones are marked and dropped). */
  async pending(userId: string, conversationId: string): Promise<AiAction[]> {
    if (!UUID_RE.test(conversationId)) throw AppError.notFound('Conversation not found');
    const own = await this.db.execute(sql`SELECT 1 FROM ai_conversations WHERE id = ${conversationId}::uuid AND user_id = ${userId}::uuid`);
    if (own.rows.length === 0) throw AppError.notFound('Conversation not found');
    await this.expireDue(userId);
    const res = await this.db.execute(sql`
      SELECT id, tool, args, label, status, expires_at FROM ai_actions
      WHERE conversation_id = ${conversationId}::uuid AND user_id = ${userId}::uuid AND status = 'proposed' ORDER BY created_at, id`);
    return res.rows.map((r) => toAction(r as Row));
  }

  /** Marks the user's overdue proposals as expired (one journal line each). */
  async expireDue(userId: string): Promise<void> {
    const res = await this.db.execute(sql`
      UPDATE ai_actions SET status = 'expired', decided_at = now()
      WHERE user_id = ${userId}::uuid AND status = 'proposed' AND expires_at <= now() RETURNING tool`);
    for (const r of res.rows as { tool: AiActionTool }[]) await this.log(userId, r.tool, 'expired');
  }

  async dismiss(userId: string, id: string): Promise<AiAction> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Action not found');
    const res = await this.db.execute(sql`
      UPDATE ai_actions SET status = 'dismissed', decided_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND status = 'proposed' RETURNING id, tool, args, label, status, expires_at`);
    if (res.rows[0]) {
      await this.log(userId, (res.rows[0] as { tool: AiActionTool }).tool, 'dismissed');
      return toAction(res.rows[0] as Row);
    }
    const cur = await this.db.execute(sql`SELECT id, tool, args, label, status, expires_at FROM ai_actions WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    const row = cur.rows[0] as Row | undefined;
    if (!row) throw AppError.notFound('Action not found');
    if (row.status === 'dismissed') return toAction(row);
    throw AppError.conflict('This action was already decided', { reason: 'action_not_pending', status: row.status });
  }
}
