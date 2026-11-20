import { Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, type TipRequest, type TipResponse } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { WalletService } from '../ledger/wallet.service.js';
import { bestEffort } from '../messaging/messaging.shared.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthUser } from '../security/auth.guard.js';
import { PostsService } from '../social/posts.service.js';
import { UUID_RE } from '../social/social.shared.js';

/** Rough CDF per USD, sandbox only (same as the wallet top-up cap). */
const CDF_PER_USD = 2800;
/** Caps in USD minor units; other currencies are scaled (CDF) or use the same figure. */
export const TIP_MAX_MINOR_USD = 5_000;
export const TIP_DAILY_MAX_MINOR_USD = 20_000;

export const scaleForCurrency = (usdMinor: number, currency: string): number => usdMinor * (currency === 'CDF' ? CDF_PER_USD : 1);

const formatAmount = (minor: number, currency: string): string => `${(minor / 100).toFixed(2)} ${currency}`;

/**
 * Tips: a P2P transfer of the sandbox wallet (kind 'p2p', metadata.ref = 'tip') from the caller to a creator, through
 * WalletService.payInternal (PIN, KYC limits, freeze, idempotency, audit). Test funds only, never real money.
 */
@Injectable()
export class TipsService {
  private readonly logger = new Logger(TipsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly posts: PostsService,
    private readonly notifications: NotificationsService,
  ) {}

  async tipPost(auth: AuthUser, postId: string, body: TipRequest, meta: RequestMeta): Promise<{ response: TipResponse; created: boolean }> {
    const found = await this.posts.requireVisible(auth.userId, auth.roles, postId);
    return this.send(auth, found.row.authorId, found.row.id, body, meta);
  }

  async tipUser(auth: AuthUser, userId: string, body: TipRequest, meta: RequestMeta): Promise<{ response: TipResponse; created: boolean }> {
    if (!UUID_RE.test(userId)) throw AppError.notFound('Recipient not found');
    const r = await this.db.execute(sql`
      SELECT 1 FROM users u WHERE u.id = ${userId}::uuid AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${auth.userId}::uuid AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${auth.userId}::uuid))`);
    if (r.rows.length === 0) throw AppError.notFound('Recipient not found');
    return this.send(auth, userId, null, body, meta);
  }

  private async send(auth: AuthUser, creatorId: string, postId: string | null, body: TipRequest, meta: RequestMeta): Promise<{ response: TipResponse; created: boolean }> {
    if (creatorId === auth.userId) throw new AppError(400, ErrorCodes.validationFailed, 'You cannot tip yourself');
    // A replay of an already processed tip never trips the caps.
    const prior = await this.db.execute(sql`
      SELECT 1 FROM journal_entries WHERE initiated_by = ${auth.userId}::uuid AND idempotency_key = ${body.clientId}`);
    if (prior.rows.length === 0) await this.assertCaps(auth.userId, body);

    const metadata: Record<string, string> = { ref: 'tip', creatorId, note: 'Pourboire' };
    if (postId) metadata.postId = postId;
    const r = await this.wallet.payInternal(
      auth,
      { to: { kind: 'user', userId: creatorId }, amountMinor: body.amountMinor, currency: body.currency, clientId: body.clientId, pin: body.pin, metadata },
      meta,
      // The authoritative daily check, in the payment's own transaction under a per-user lock: parallel tips queue up, so the total never passes the cap.
      async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tip-cap:${auth.userId}`}, 0))`);
        await this.assertCaps(auth.userId, body, tx, true);
      },
    );
    if (!r.replayed) await bestEffort(this.logger, 'tip notification', () => this.notify(creatorId, auth.userId, r.amountMinor, r.currency, r.transferId, postId));
    return {
      created: !r.replayed,
      response: { mode: 'sandbox', tipId: r.transferId, replayed: r.replayed, amountMinor: r.amountMinor, currency: r.currency, balanceMinor: r.balanceMinor, createdAt: r.createdAt },
    };
  }

  /** `includesSelf`: inside the payment's transaction, the tip being paid is already in the journal. */
  private async assertCaps(userId: string, body: TipRequest, exec: DbExecutor = this.db, includesSelf = false): Promise<void> {
    const max = scaleForCurrency(TIP_MAX_MINOR_USD, body.currency);
    if (body.amountMinor > max) {
      throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'amountMinor', message: `at most ${max} per tip` }]);
    }
    const day = await exec.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM journal_entries
      WHERE initiated_by = ${userId}::uuid AND kind = 'p2p' AND metadata->>'ref' = 'tip' AND currency = ${body.currency}
        AND created_at > now() - interval '1 day'`);
    const dailyMax = scaleForCurrency(TIP_DAILY_MAX_MINOR_USD, body.currency);
    if (Number(day.rows[0]?.total ?? 0) + (includesSelf ? 0 : body.amountMinor) > dailyMax) {
      throw AppError.conflict('Daily tip limit reached', { reason: 'tip_daily_limit', maxMinor: dailyMax });
    }
  }

  private async notify(creatorId: string, senderId: string, amountMinor: number, currency: string, transferId: string, postId: string | null): Promise<void> {
    const s = await this.db.execute<{ display_name: string }>(sql`SELECT display_name FROM users WHERE id = ${senderId}::uuid`);
    await this.notifications.notify({
      userId: creatorId,
      category: 'payment',
      title: 'Pourboire reçu (mode test)',
      body: `${s.rows[0]?.display_name ?? 'Un utilisateur'} vous a envoyé un pourboire de ${formatAmount(amountMinor, currency)}`,
      data: postId ? { transferId, kind: 'tip', postId } : { transferId, kind: 'tip' },
    });
  }
}
