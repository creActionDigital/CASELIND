import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { KycPort } from '../wallet/kyc.port.js';
import { ANOMALY, evaluateAnomalies } from './anomaly.rules.js';

/**
 * Called AFTER a successful send (wallet transfer, tip, request payment, scheduled payment). Gathers the figures, applies the
 * pure rules (anomaly.rules.ts) and records information alerts. Never blocks a transfer and never throws.
 */
@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kyc: KycPort,
    private readonly notifications: NotificationsService,
  ) {}

  async afterTransfer(userId: string, transferId: string, currency: string): Promise<void> {
    try {
      await this.check(userId, transferId, currency);
    } catch (err) {
      this.logger.warn(`anomaly check failed: ${(err as Error).name}`);
    }
  }

  private async check(userId: string, transferId: string, currency: string): Promise<void> {
    const res = await this.db.execute<{ id: string; amount_minor: string; currency: string; created_at: Date; to_account: string | null }>(sql`
      SELECT e.id, e.amount_minor::text, e.currency::text AS currency, e.created_at,
        (SELECT p.account_id::text FROM postings p WHERE p.entry_id = e.id AND p.amount_minor > 0 LIMIT 1) AS to_account
      FROM journal_entries e
      WHERE e.initiated_by = ${userId}::uuid AND e.kind = 'p2p'
      ORDER BY e.created_at DESC, e.id DESC LIMIT 200`);
    const rows = res.rows;
    const current = rows.find((r) => r.id === transferId);
    if (!current) return;
    const at = new Date(current.created_at).getTime();
    const older = rows.filter((r) => r.id !== transferId && new Date(r.created_at).getTime() <= at);
    const inWindow = (ms: number) => rows.filter((r) => new Date(r.created_at).getTime() > at - ms && new Date(r.created_at).getTime() <= at);
    const recipients = new Set(inWindow(ANOMALY.recipientsWindowMs).map((r) => r.to_account));
    let first = false;
    if (current.to_account) {
      const seen = await this.db.execute(sql`
        SELECT 1 FROM journal_entries e JOIN postings p ON p.entry_id = e.id AND p.amount_minor > 0 AND p.account_id = ${current.to_account}::uuid
        WHERE e.initiated_by = ${userId}::uuid AND e.kind = 'p2p' AND e.id <> ${transferId}::uuid LIMIT 1`);
      first = seen.rows.length === 0;
    }
    const limits = await this.kyc.limitsFor(userId, currency);
    const hits = evaluateAnomalies({
      amountMinor: Number(current.amount_minor),
      previousAmounts: older
        .filter((r) => r.currency.trim() === currency)
        .slice(0, ANOMALY.historySize)
        .map((r) => Number(r.amount_minor)),
      sendsLast10Min: inWindow(ANOMALY.burstWindowMs).length,
      distinctRecipientsLastHour: recipients.size,
      isFirstToRecipient: first,
      dailyLimitMinor: limits.maxDailyOutgoingMinor,
    });
    let created = 0;
    for (const h of hits) {
      // The rate rules would fire again on every send of the same burst: one alert per rule per 30 minutes.
      const dedupe = h.rule === 'burst' || h.rule === 'many_recipients';
      const ins = await this.db.execute(sql`
        INSERT INTO wallet_alerts (user_id, rule, severity, transfer_id)
        SELECT ${userId}::uuid, ${h.rule}, ${h.severity}, ${transferId}::uuid
        WHERE ${dedupe}::boolean = false OR NOT EXISTS (
          SELECT 1 FROM wallet_alerts WHERE user_id = ${userId}::uuid AND rule = ${h.rule} AND created_at > now() - interval '30 minutes')
        ON CONFLICT (transfer_id, rule) DO NOTHING`);
      created += ins.rowCount ?? 0;
    }
    if (created > 0) {
      await this.notifications.notify({
        userId,
        category: 'security',
        title: 'Activité inhabituelle (mode test)',
        body: 'Un envoi récent sur votre portefeuille de test semble inhabituel. Vérifiez-le dans vos alertes.',
        data: { kind: 'wallet_alert' },
        urgent: true,
      });
    }
  }
}
