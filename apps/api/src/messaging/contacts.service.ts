import { Inject, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@caselind/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { DB, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { PrivacyService } from '../privacy/privacy.service.js';
import { type Exec, userNotFound } from './messaging.shared.js';

/**
 * Who may start a conversation with whom.
 *
 * A "contact" is a user with whom you share a direct conversation in which both of you are
 * active members. There is no separate contact list: talking to someone makes you contacts.
 * The target's `contactRequestsFrom` setting is then applied to whoever initiates the contact
 * (creating a direct conversation, adding the target to a group):
 *  - everyone: always allowed;
 *  - contacts_of_contacts: allowed if already contacts, or if they have a contact in common;
 *  - nobody: allowed only if already contacts.
 */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly privacy: PrivacyService,
  ) {}

  /** Active users among `ids`, or 404 (inactive, unknown and blocked-either-way look the same). */
  async resolveTargets(initiatorId: string, ids: string[]): Promise<{ id: string; contactRequestsFrom: string }[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: users.id, contactRequestsFrom: users.contactRequestsFrom })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'active')));
    if (rows.length !== new Set(ids).size) throw userNotFound();
    for (const r of rows) {
      if (await this.privacy.isBlockedEitherWay(initiatorId, r.id)) throw userNotFound();
    }
    return rows;
  }

  /** Direct conversation target: unknown or inactive = 404, blocked either way = 403. */
  async resolveDirectTarget(initiatorId: string, targetId: string): Promise<{ id: string; contactRequestsFrom: string }> {
    const [row] = await this.db
      .select({ id: users.id, contactRequestsFrom: users.contactRequestsFrom })
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.status, 'active')))
      .limit(1);
    if (!row) throw userNotFound();
    if (await this.privacy.isBlockedEitherWay(initiatorId, targetId)) throw AppError.forbidden('You cannot message this user');
    return row;
  }

  /** 403 `forbidden` / `details.reason = 'contact_requests_restricted'` when the target's setting refuses. */
  async assertAllowed(initiatorId: string, target: { id: string; contactRequestsFrom: string }): Promise<void> {
    if (target.contactRequestsFrom === 'everyone') return;
    if (await this.areContacts(this.db, initiatorId, target.id)) return;
    if (target.contactRequestsFrom === 'contacts_of_contacts' && (await this.haveCommonContact(initiatorId, target.id))) {
      return;
    }
    throw new AppError(403, ErrorCodes.forbidden, 'This user does not accept messages from you', {
      reason: 'contact_requests_restricted',
    });
  }

  async areContacts(exec: Exec, a: string, b: string): Promise<boolean> {
    const res = await exec.execute(sql`
      SELECT 1 FROM conversations c
      JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ${a} AND m1.status = 'active'
      JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ${b} AND m2.status = 'active'
      WHERE c.kind = 'direct'
      LIMIT 1`);
    return res.rows.length > 0;
  }

  private async haveCommonContact(a: string, b: string): Promise<boolean> {
    const res = await this.db.execute(sql`
      WITH contacts AS (
        SELECT m1.user_id AS owner, m2.user_id AS contact
        FROM conversation_members m1
        JOIN conversations c ON c.id = m1.conversation_id AND c.kind = 'direct'
        JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id <> m1.user_id AND m2.status = 'active'
        WHERE m1.status = 'active' AND m1.user_id IN (${a}, ${b})
      )
      SELECT 1 FROM contacts ca JOIN contacts cb ON cb.contact = ca.contact
      WHERE ca.owner = ${a} AND cb.owner = ${b}
      LIMIT 1`);
    return res.rows.length > 0;
  }
}
