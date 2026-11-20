import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CONSENT_KINDS,
  CONSENT_VERSIONS,
  type ConsentHistory,
  type ConsentJournalEntry,
  type ConsentKind,
  type UserConsent,
} from '@caselind/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { HealthService } from '../health/health.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { appendConsent } from './consents.shared.js';

const iso = (d: Date | string) => new Date(d).toISOString();
const HISTORY_MAX = 200;

/**
 * Central consents. The journal (`user_consents`) is append-only; health and marketing keep their
 * historical tables, which stay the source of truth for their effect (health access, marketing mails),
 * and are written through their own services.
 */
@Injectable()
export class ConsentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly health: HealthService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /** One item per whitelisted kind, in whitelist order. */
  async items(userId: string): Promise<UserConsent[]> {
    const latest = await this.db.execute<{ kind: ConsentKind; granted: boolean; version: string; created_at: Date }>(sql`
      SELECT DISTINCT ON (kind) kind, granted, version, created_at FROM user_consents WHERE user_id = ${userId}::uuid ORDER BY kind, seq DESC`);
    const byKind = new Map<ConsentKind, UserConsent>(
      latest.rows.map((r) => [r.kind, { kind: r.kind, granted: r.granted, version: r.version, updatedAt: iso(r.created_at) }]),
    );
    // Legacy tables decide for health and marketing: a row there is what actually gates the feature.
    const health = (await this.db.execute<{ version: string; granted_at: Date }>(sql`SELECT version, granted_at FROM health_consents WHERE user_id = ${userId}::uuid`)).rows[0];
    if (health) byKind.set('health', { kind: 'health', granted: true, version: health.version, updatedAt: iso(health.granted_at) });
    else if (byKind.has('health')) byKind.set('health', { ...byKind.get('health')!, granted: false });
    const marketing = (await this.db.execute<{ opted_in: boolean; updated_at: Date }>(sql`SELECT opted_in, updated_at FROM marketing_consents WHERE user_id = ${userId}::uuid`)).rows[0];
    if (marketing) byKind.set('marketing', { kind: 'marketing', granted: marketing.opted_in, version: CONSENT_VERSIONS.marketing, updatedAt: iso(marketing.updated_at) });
    return CONSENT_KINDS.map((kind) => byKind.get(kind) ?? { kind, granted: false, version: null, updatedAt: null });
  }

  /** Journal lines, most recent first; the history screen keeps the last 200, the account export takes everything (`all`). */
  async journal(userId: string, all = false): Promise<ConsentJournalEntry[]> {
    const { rows } = await this.db.execute<{ id: string; kind: ConsentKind; granted: boolean; version: string; source: string; created_at: Date }>(sql`
      SELECT id, kind, granted, version, source, created_at FROM user_consents WHERE user_id = ${userId}::uuid ORDER BY seq DESC LIMIT ${all ? null : HISTORY_MAX}`);
    return rows.map((r) => ({ id: r.id, kind: r.kind, granted: r.granted, version: r.version, source: r.source, createdAt: iso(r.created_at) }));
  }

  async history(userId: string): Promise<ConsentHistory> {
    return { items: await this.journal(userId) };
  }

  /** Grant or withdraw, effective immediately. Idempotent. Audit carries the kind and the answer only. */
  async set(userId: string, kind: ConsentKind, granted: boolean, meta: RequestMeta): Promise<UserConsent> {
    const version = CONSENT_VERSIONS[kind];
    if (kind === 'health') {
      if (granted) await this.health.grant(userId, version, meta);
      else await this.health.revoke(userId, meta);
    } else if (kind === 'marketing') {
      await this.loyalty.setConsent(userId, granted, meta);
    } else {
      await this.db.transaction(async (tx) => {
        await appendConsent(tx, userId, kind, granted, version);
        await this.audit.record({ action: 'user.consent_updated', actorUserId: userId, meta, metadata: { kind, granted } }, tx);
      });
    }
    return (await this.items(userId)).find((i) => i.kind === kind)!;
  }
}
