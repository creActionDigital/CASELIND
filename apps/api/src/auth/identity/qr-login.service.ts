import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type QrApproveRequest,
  type QrApproveResponse,
  type QrSessionRequest,
  type QrSessionResponse,
  type QrSessionStatus,
} from '@caselind/contracts';
import { and, eq, lt } from 'drizzle-orm';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { RequestMeta } from '../../common/request-meta.js';
import { DB, type Db } from '../../db/db.module.js';
import { qrLoginSessions, users } from '../../db/schema.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import type { AuthUser } from '../../security/auth.guard.js';
import { AuthService } from '../auth.service.js';

const QR_TTL_MS = 2 * 60_000;
/** An approved session can still be collected for this long after the approval. */
const COLLECT_WINDOW_MS = 2 * 60_000;
const PREFIX = 'caselind-qr1';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Web sign-in by QR code (A-13). The QR holds the session id and an approval nonce; the polling secret
 * stays with the web client, so a photographed QR cannot be used to collect the tokens. Only hashes are stored.
 */
@Injectable()
export class QrLoginService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(req: QrSessionRequest, meta: RequestMeta): Promise<QrSessionResponse> {
    const id = randomUUID();
    const nonce = randomBytes(24).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + QR_TTL_MS);
    await this.db.insert(qrLoginSessions).values({
      id,
      nonceHash: sha256(nonce),
      secretHash: sha256(secret),
      deviceName: req.device.name ?? null,
      platform: req.device.platform === 'other' ? 'web' : req.device.platform,
      ip: meta.ip,
      expiresAt,
    });
    return { qrSessionId: id, qrPayload: `${PREFIX}:${id}:${nonce}`, expiresAt: expiresAt.toISOString(), sessionSecret: secret };
  }

  /** Without `confirm` only shows who is asking; with `confirm: true` approves the web session. */
  async approve(auth: AuthUser, req: QrApproveRequest, meta: RequestMeta): Promise<QrApproveResponse> {
    const [prefix, id, nonce] = req.qrPayload.split(':');
    if (prefix !== PREFIX || !id || !nonce) throw AppError.notFound('QR code not recognised');
    const [row] = await this.db
      .select()
      .from(qrLoginSessions)
      .where(eq(qrLoginSessions.nonceHash, sha256(nonce)))
      .limit(1);
    if (!row || row.id !== id || row.status === 'consumed') throw AppError.notFound('QR code not recognised');
    const now = new Date();
    if (row.expiresAt <= now) throw new AppError(410, ErrorCodes.otpExpired, 'This QR code has expired');
    if (row.status !== 'pending') throw AppError.conflict('This QR code was already approved');

    const view = {
      device: { name: row.deviceName, platform: row.platform, ip: row.ip },
      requestedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
    if (!req.confirm) return { status: 'confirmation_required', ...view };

    const [claimed] = await this.db
      .update(qrLoginSessions)
      .set({ status: 'approved', approvedBy: auth.userId, approvedAt: now })
      .where(and(eq(qrLoginSessions.id, row.id), eq(qrLoginSessions.status, 'pending')))
      .returning({ id: qrLoginSessions.id });
    if (!claimed) throw AppError.conflict('This QR code was already approved');
    await this.audit.record({
      action: 'auth.qr_approved',
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      meta,
      metadata: { qrSessionId: row.id },
    });
    void this.notifications
      .notify({
        userId: auth.userId,
        category: 'security',
        title: 'Connexion web approuvée',
        body: row.deviceName ?? row.platform,
        urgent: true,
      })
      .catch(() => undefined);
    return { status: 'approved', ...view };
  }

  /** Public polling. Wrong id or secret: 404. The tokens are handed out exactly once. */
  async poll(id: string, secret: string | undefined, meta: RequestMeta): Promise<QrSessionStatus> {
    const [row] = await this.db.select().from(qrLoginSessions).where(eq(qrLoginSessions.id, id)).limit(1);
    if (!row || !secret || !safeEqualHex(row.secretHash, sha256(secret))) throw AppError.notFound('QR session not found');
    const now = Date.now();
    if (row.status === 'consumed') return { status: 'expired' };
    if (row.status === 'pending') return row.expiresAt.getTime() <= now ? { status: 'expired' } : { status: 'pending' };

    if (!row.approvedBy || !row.approvedAt || row.approvedAt.getTime() + COLLECT_WINDOW_MS <= now) {
      return { status: 'expired' };
    }
    const [claimed] = await this.db
      .update(qrLoginSessions)
      .set({ status: 'consumed' })
      .where(and(eq(qrLoginSessions.id, row.id), eq(qrLoginSessions.status, 'approved')))
      .returning({ id: qrLoginSessions.id });
    if (!claimed) return { status: 'expired' };
    const [user] = await this.db.select().from(users).where(eq(users.id, row.approvedBy)).limit(1);
    if (!user || user.status !== 'active') return { status: 'expired' };
    const tokens = await this.auth.createSession(
      user,
      { platform: row.platform as 'web', ...(row.deviceName ? { name: row.deviceName } : {}) },
      meta,
    );
    await this.audit.record({
      action: 'auth.login',
      subjectUserId: user.id,
      sessionId: tokens.sessionId,
      meta,
      metadata: { via: 'qr' },
    });
    return { status: 'approved', tokens };
  }

  async purgeExpired(cutoff: Date): Promise<number> {
    const res = await this.db.delete(qrLoginSessions).where(lt(qrLoginSessions.expiresAt, cutoff));
    return res.rowCount ?? 0;
  }
}
