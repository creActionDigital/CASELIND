import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCodes,
  type Notification,
  type NotificationCategory,
  type NotificationList,
  type NotificationListQuery,
  type NotificationPreferences,
  type PushPlatform,
  type UpdateNotificationPreferencesRequest,
} from '@caselind/contracts';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { notificationPreferences, notifications, pushTokens, sessions } from '../db/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PushGateway, type PushMessage } from './push-gateway.js';

export type { NotificationCategory };

export interface NotifyInput {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Opaque routing data for the client (e.g. `{ conversationId }`). Never secrets. */
  data?: Record<string, string>;
  /** false = push only, no notification-centre row (chat messages have their own unread counters). */
  persist?: boolean;
  /** Bypasses the user's quiet mode (e.g. an @mention or a security alert). Category opt-outs still apply. */
  urgent?: boolean;
  /** A message-category body that holds no message content (e.g. "you were mentioned"): kept even when previews are off. */
  genericBody?: boolean;
}

const MAX_TOKENS_PER_USER = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGE_PREVIEW_PLACEHOLDER = 'Nouveau message';

function encodeCursor(createdAtExact: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAtExact, id]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      !Number.isNaN(Date.parse(v[0])) &&
      typeof v[1] === 'string' &&
      UUID_RE.test(v[1])
    ) {
      return { createdAt: v[0], id: v[1] };
    }
  } catch {
    // fall through
  }
  throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
    { path: 'cursor', message: 'invalid cursor' },
  ]);
}

type NotificationRow = typeof notifications.$inferSelect;

function toNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    category: r.category as NotificationCategory,
    title: r.title,
    body: r.body,
    data: r.data,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Single entry point for notifying a user: centre row (if persisted), `notification.new` on the
 * socket, and push through the PushGateway, honouring the user's preferences. Call AFTER the commit:
 * it never throws and never makes the calling request fail. Push delivery is asynchronous and its
 * failures are logged without content.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeService,
    private readonly push: PushGateway,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    await this.notifyMany([input]);
  }

  /** Same as `notify` for several recipients, with a single PushGateway call. */
  async notifyMany(inputs: NotifyInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      const persisted = inputs.filter((i) => i.persist !== false);
      if (persisted.length > 0) {
        const rows = await this.db
          .insert(notifications)
          .values(
            persisted.map((i) => ({
              userId: i.userId,
              category: i.category,
              title: i.title,
              body: i.body,
              data: i.data ?? {},
            })),
          )
          .returning();
        rows.forEach((row) => this.realtime.emitToUser(row.userId, 'notification.new', toNotification(row)));
      }
    } catch (err) {
      this.logger.warn(`notification persistence failed: ${(err as Error).name}`);
    }
    try {
      const messages = await this.buildPushMessages(inputs);
      if (messages.length > 0) void this.deliver(messages);
    } catch (err) {
      this.logger.warn(`push preparation failed: ${(err as Error).name}`);
    }
  }

  private async buildPushMessages(inputs: NotifyInput[]): Promise<PushMessage[]> {
    const userIds = [...new Set(inputs.map((i) => i.userId))];
    const now = new Date();
    // Tokens of revoked or expired sessions are removed here, the first time a send passes over them.
    await this.db
      .delete(pushTokens)
      .where(
        and(
          inArray(pushTokens.userId, userIds),
          inArray(
            pushTokens.sessionId,
            this.db
              .select({ id: sessions.id })
              .from(sessions)
              .where(or(sql`${sessions.revokedAt} IS NOT NULL`, lte(sessions.expiresAt, now))),
          ),
        ),
      );
    const [tokenRows, prefRows] = await Promise.all([
      this.db
        .select({ userId: pushTokens.userId, token: pushTokens.token })
        .from(pushTokens)
        .innerJoin(sessions, eq(sessions.id, pushTokens.sessionId))
        .where(and(inArray(pushTokens.userId, userIds), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > ${now}`)),
      this.db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds)),
    ]);
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokenRows) tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);
    const prefs = new Map(prefRows.map((p) => [p.userId, p]));

    const messages: PushMessage[] = [];
    for (const i of inputs) {
      const tokens = tokensByUser.get(i.userId);
      if (!tokens?.length) continue;
      const pref = prefs.get(i.userId);
      const urgent = i.urgent === true;
      if (i.category !== 'security' && pref?.pushDisabledCategories.includes(i.category)) continue;
      if (pref?.quietUntil && pref.quietUntil > now && !urgent) continue;
      const hideBody = i.category === 'message' && !(pref?.messagePreviews ?? false) && !i.genericBody;
      for (const to of tokens) {
        messages.push({
          to,
          title: i.title,
          body: hideBody ? MESSAGE_PREVIEW_PLACEHOLDER : i.body,
          data: { ...(i.data ?? {}), category: i.category }, // le mobile route le tap push avec la catégorie
          urgent,
        });
      }
    }
    return messages;
  }

  private async deliver(messages: PushMessage[]): Promise<void> {
    try {
      const results = await this.push.send(messages);
      const dead = messages.filter((_, idx) => {
        const r = results[idx];
        return r?.status === 'error' && r.error === 'DeviceNotRegistered';
      });
      if (dead.length > 0) {
        await this.db.delete(pushTokens).where(inArray(pushTokens.token, dead.map((m) => m.to)));
      }
    } catch (err) {
      this.logger.warn(`push delivery failed: ${(err as Error).name}`);
    }
  }

  // ---- push tokens -------------------------------------------------------------------------

  /** Idempotent. Re-attaches the token to the caller's current session (even if it belonged to another account). */
  async registerToken(userId: string, sessionId: string, token: string, platform: PushPlatform): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(pushTokens)
        .values({ userId, sessionId, token, platform })
        .onConflictDoUpdate({
          target: pushTokens.token,
          set: { userId, sessionId, platform, lastSeenAt: sql`now()` },
        });
      await tx.execute(sql`
        DELETE FROM push_tokens WHERE id IN (
          SELECT id FROM push_tokens WHERE user_id = ${userId}
          ORDER BY last_seen_at DESC, id OFFSET ${MAX_TOKENS_PER_USER}
        )`);
    });
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
  }

  // ---- notification centre -----------------------------------------------------------------

  async list(userId: string, q: NotificationListQuery): Promise<NotificationList> {
    const filters = [eq(notifications.userId, userId)];
    if (q.unreadOnly === 'true') filters.push(isNull(notifications.readAt));
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filters.push(sql`(${notifications.createdAt}, ${notifications.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`);
    }
    const rows = await this.db
      .select({ row: notifications, exact: sql<string>`${notifications.createdAt}::text` })
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toNotification(r.row)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.exact, last.row.id) : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  }

  /** Idempotent; a notification of another user (or a malformed id) is a 404. */
  async markRead(userId: string, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Notification not found');
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    if (!row) throw AppError.notFound('Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  // ---- preferences -------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const [row] = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return {
      pushDisabledCategories: (row?.pushDisabledCategories ?? []) as NotificationPreferences['pushDisabledCategories'],
      quietUntil: row?.quietUntil ? row.quietUntil.toISOString() : null,
      messagePreviews: row?.messagePreviews ?? false,
    };
  }

  async updatePreferences(userId: string, patch: UpdateNotificationPreferencesRequest): Promise<NotificationPreferences> {
    const set: Partial<typeof notificationPreferences.$inferInsert> = { updatedAt: new Date() };
    if (patch.pushDisabledCategories !== undefined) {
      set.pushDisabledCategories = [...new Set<string>(patch.pushDisabledCategories)];
    }
    if (patch.quietUntil !== undefined) set.quietUntil = patch.quietUntil ? new Date(patch.quietUntil) : null;
    if (patch.messagePreviews !== undefined) set.messagePreviews = patch.messagePreviews;
    await this.db
      .insert(notificationPreferences)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set });
    return this.getPreferences(userId);
  }
}
