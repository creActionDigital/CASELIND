import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  ErrorCodes,
  HEALTH_CONSENT_VERSION,
  type CreateHealthEntryRequest,
  type CreateReminderRequest,
  type Dose,
  type DoseList,
  type ExportedHealth,
  type HealthConsent,
  type HealthEntry,
  type HealthEntryList,
  type HealthEntryListQuery,
  type Reminder,
  type ReminderList,
  type UpdateHealthEntryRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { HealthCrypto } from './health-crypto.js';
import { HealthProService } from './health-pro.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REMINDER_INTERVAL_MS = 60_000;
/** A reminder is still sent when the minute job runs up to this many minutes late (restart, slow run). */
const REMINDER_CATCH_UP_MINUTES = 5;
const MINUTE_MS = 60_000;
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const consentRequired = () => new AppError(403, ErrorCodes.forbidden, 'Health data needs your explicit consent first', { reason: 'consent_required' });
const iso = (d: Date | string) => new Date(d).toISOString();
const day = (d: Date | string) => iso(d).slice(0, 10);

type EntryPayload = { title: string; details: string; severity: number | null };
type ReminderPayload = { title: string; dose: string };

const encodeCursor = (on: Date | string, id: string) => Buffer.from(JSON.stringify([day(on), id])).toString('base64url');
function decodeCursor(cursor: string): { on: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v[0]) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { on: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}

/**
 * Personal health data. Everything here needs the user's explicit consent, is private to the user, and keeps its free text
 * encrypted. Nothing is ever put in a notification body, an audit row or a log. Medication reminders are a convenience,
 * not medical advice.
 */
@Injectable()
export class HealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: HealthCrypto,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pro: HealthProService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.HEALTH_REMINDERS_ENABLED) return;
    this.timer = setInterval(() => void this.safeRun(), REMINDER_INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async safeRun(): Promise<void> {
    try {
      await this.runDue();
    } catch (err) {
      this.logger.error(`reminder run failed: ${(err as Error).name}`);
    }
  }

  // ---- Consent ----------------------------------------------------------------------------------

  async consent(userId: string): Promise<HealthConsent> {
    const res = await this.db.execute<{ version: string; granted_at: Date }>(sql`SELECT version, granted_at FROM health_consents WHERE user_id = ${userId}::uuid`);
    const row = res.rows[0];
    return row ? { granted: true, version: row.version, grantedAt: iso(row.granted_at) } : { granted: false, version: null, grantedAt: null };
  }

  /** The user states the version they read; an older text is refused so consent always matches what is shown. Idempotent. */
  async grant(userId: string, version: string, meta: RequestMeta): Promise<HealthConsent> {
    if (version !== HEALTH_CONSENT_VERSION) throw AppError.conflict('The consent text changed: read it again', { reason: 'consent_version', current: HEALTH_CONSENT_VERSION });
    await this.db.transaction(async (tx) => {
      const ins = await tx.execute(sql`INSERT INTO health_consents (user_id, version) VALUES (${userId}::uuid, ${version}) ON CONFLICT (user_id) DO NOTHING`);
      if ((ins.rowCount ?? 0) > 0) await this.audit.record({ action: 'health.consent_granted', actorUserId: userId, meta, metadata: { version } }, tx);
    });
    return this.consent(userId);
  }

  /** Withdrawing hides everything and stops reminders; the data stays (encrypted) until the user erases it or consents again. */
  async revoke(userId: string, meta: RequestMeta): Promise<HealthConsent> {
    await this.db.transaction(async (tx) => {
      const del = await tx.execute(sql`DELETE FROM health_consents WHERE user_id = ${userId}::uuid`);
      if ((del.rowCount ?? 0) > 0) await this.audit.record({ action: 'health.consent_revoked', actorUserId: userId, meta, metadata: {} }, tx);
    });
    return this.consent(userId);
  }

  /** Right to erasure: every entry, reminder and dose, and the consent. */
  async erase(userId: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM health_entries WHERE user_id = ${userId}::uuid`);
      await tx.execute(sql`DELETE FROM health_reminders WHERE user_id = ${userId}::uuid`);
      await this.pro.eraseFor(tx, userId);
      await tx.execute(sql`DELETE FROM health_consents WHERE user_id = ${userId}::uuid`);
      await this.audit.record({ action: 'health.erased', actorUserId: userId, meta, metadata: {} }, tx);
    });
  }

  private async requireConsent(userId: string): Promise<void> {
    const res = await this.db.execute(sql`SELECT 1 FROM health_consents WHERE user_id = ${userId}::uuid`);
    if (res.rows.length === 0) throw consentRequired();
  }

  // ---- Record -----------------------------------------------------------------------------------

  async createEntry(userId: string, body: CreateHealthEntryRequest, meta: RequestMeta): Promise<HealthEntry> {
    await this.requireConsent(userId);
    const payload = this.crypto.seal(userId, { title: body.title, details: body.details, severity: body.severity } satisfies EntryPayload);
    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`INSERT INTO health_entries (user_id, kind, recorded_on, payload) VALUES (${userId}::uuid, ${body.kind}, ${body.recordedOn}::date, ${payload}) RETURNING id`);
      const entryId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.entry_created', actorUserId: userId, meta, metadata: { entryId, kind: body.kind } }, tx);
      return entryId;
    });
    return this.entry(userId, id);
  }

  async updateEntry(userId: string, id: string, body: UpdateHealthEntryRequest, meta: RequestMeta): Promise<HealthEntry> {
    await this.requireConsent(userId);
    const cur = await this.entry(userId, id);
    const severity = body.severity !== undefined ? body.severity : cur.severity;
    if (severity !== null && cur.kind !== 'symptom') throw invalid('severity', 'severity only applies to a symptom');
    const payload = this.crypto.seal(userId, { title: body.title ?? cur.title, details: body.details ?? cur.details, severity } satisfies EntryPayload);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE health_entries SET payload = ${payload}, recorded_on = ${body.recordedOn ?? cur.recordedOn}::date, updated_at = now() WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
      await this.audit.record({ action: 'health.entry_updated', actorUserId: userId, meta, metadata: { entryId: id, kind: cur.kind } }, tx);
    });
    return this.entry(userId, id);
  }

  async deleteEntry(userId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.requireConsent(userId);
    if (!UUID_RE.test(id)) return;
    await this.db.transaction(async (tx) => {
      const del = await tx.execute(sql`DELETE FROM health_entries WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
      if ((del.rowCount ?? 0) > 0) await this.audit.record({ action: 'health.entry_deleted', actorUserId: userId, meta, metadata: { entryId: id } }, tx);
    });
  }

  async listEntries(userId: string, q: HealthEntryListQuery): Promise<HealthEntryList> {
    await this.requireConsent(userId);
    const f: SQL[] = [sql`user_id = ${userId}::uuid`];
    if (q.kind) f.push(sql`kind = ${q.kind}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(recorded_on, id) < (${c.on}::date, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<{ id: string; kind: HealthEntry['kind']; recorded_on: Date | string; payload: string; created_at: Date }>(sql`
      SELECT id, kind, recorded_on, payload, created_at FROM health_entries WHERE ${sql.join(f, sql` AND `)} ORDER BY recorded_on DESC, id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.toEntry(userId, r)), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.recorded_on, last.id) : null };
  }

  private async entry(userId: string, id: string): Promise<HealthEntry> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Entry not found');
    const res = await this.db.execute<{ id: string; kind: HealthEntry['kind']; recorded_on: Date | string; payload: string; created_at: Date }>(sql`
      SELECT id, kind, recorded_on, payload, created_at FROM health_entries WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Entry not found');
    return this.toEntry(userId, res.rows[0]);
  }

  private toEntry(userId: string, r: { id: string; kind: HealthEntry['kind']; recorded_on: Date | string; payload: string; created_at: Date }): HealthEntry {
    const p = this.crypto.open<EntryPayload>(userId, r.payload);
    return { id: r.id, kind: r.kind, recordedOn: day(r.recorded_on), title: p.title, details: p.details, severity: p.severity, createdAt: iso(r.created_at) };
  }

  // ---- Reminders --------------------------------------------------------------------------------

  async createReminder(userId: string, body: CreateReminderRequest, meta: RequestMeta): Promise<Reminder> {
    await this.requireConsent(userId);
    const payload = this.crypto.seal(userId, { title: body.title, dose: body.dose } satisfies ReminderPayload);
    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO health_reminders (user_id, payload, times, utc_offset_minutes, starts_on, ends_on)
        VALUES (${userId}::uuid, ${payload}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.times)}::jsonb)), ${body.utcOffsetMinutes}, ${body.startsOn}::date, ${body.endsOn}::date)
        RETURNING id`);
      const reminderId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.reminder_created', actorUserId: userId, meta, metadata: { reminderId } }, tx);
      return reminderId;
    });
    return this.reminder(userId, id);
  }

  async listReminders(userId: string): Promise<ReminderList> {
    await this.requireConsent(userId);
    const res = await this.db.execute<ReminderRow>(sql`
      SELECT id, payload, times, utc_offset_minutes, starts_on, ends_on, active FROM health_reminders WHERE user_id = ${userId}::uuid ORDER BY created_at DESC, id DESC LIMIT 100`);
    return { items: res.rows.map((r) => this.toReminder(userId, r)) };
  }

  async setReminderActive(userId: string, id: string, active: boolean): Promise<Reminder> {
    await this.requireConsent(userId);
    await this.reminder(userId, id);
    await this.db.execute(sql`UPDATE health_reminders SET active = ${active} WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    return this.reminder(userId, id);
  }

  async deleteReminder(userId: string, id: string, meta: RequestMeta): Promise<void> {
    await this.requireConsent(userId);
    if (!UUID_RE.test(id)) return;
    await this.db.transaction(async (tx) => {
      const del = await tx.execute(sql`DELETE FROM health_reminders WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
      if ((del.rowCount ?? 0) > 0) await this.audit.record({ action: 'health.reminder_deleted', actorUserId: userId, meta, metadata: { reminderId: id } }, tx);
    });
  }

  private async reminder(userId: string, id: string): Promise<Reminder> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Reminder not found');
    const res = await this.db.execute<ReminderRow>(sql`SELECT id, payload, times, utc_offset_minutes, starts_on, ends_on, active FROM health_reminders WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Reminder not found');
    return this.toReminder(userId, res.rows[0]);
  }

  private toReminder(userId: string, r: ReminderRow): Reminder {
    const p = this.crypto.open<ReminderPayload>(userId, r.payload);
    return { id: r.id, title: p.title, dose: p.dose, times: r.times, utcOffsetMinutes: r.utc_offset_minutes, startsOn: day(r.starts_on), endsOn: r.ends_on ? day(r.ends_on) : null, active: r.active };
  }

  // ---- Doses ------------------------------------------------------------------------------------

  /** The last 50 doses, pending ones first by date, so the user can tick what they took. */
  async listDoses(userId: string): Promise<DoseList> {
    await this.requireConsent(userId);
    const res = await this.db.execute<DoseRow>(sql`
      SELECT d.id, d.reminder_id, d.due_at, d.status, r.payload FROM health_doses d JOIN health_reminders r ON r.id = d.reminder_id
      WHERE d.user_id = ${userId}::uuid ORDER BY d.due_at DESC LIMIT 50`);
    return { items: res.rows.map((r) => this.toDose(userId, r)) };
  }

  async resolveDose(userId: string, id: string, status: 'taken' | 'skipped'): Promise<Dose> {
    await this.requireConsent(userId);
    if (!UUID_RE.test(id)) throw AppError.notFound('Dose not found');
    const upd = await this.db.execute(sql`UPDATE health_doses SET status = ${status}, resolved_at = now() WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`);
    if ((upd.rowCount ?? 0) === 0) throw AppError.notFound('Dose not found');
    const res = await this.db.execute<DoseRow>(sql`
      SELECT d.id, d.reminder_id, d.due_at, d.status, r.payload FROM health_doses d JOIN health_reminders r ON r.id = d.reminder_id WHERE d.id = ${id}::uuid`);
    return this.toDose(userId, res.rows[0]!);
  }

  private toDose(userId: string, r: DoseRow): Dose {
    const p = this.crypto.open<ReminderPayload>(userId, r.payload);
    return { id: r.id, reminderId: r.reminder_id, title: p.title, dose: p.dose, dueAt: iso(r.due_at), status: r.status };
  }

  /**
   * Turns due reminders into doses and sends one generic notification each (the body never names the medicine: a lock
   * screen must not reveal it). Safe to run from several instances: the unique (reminder, due time) decides who notifies.
   */
  async runDue(now: Date = new Date()): Promise<number> {
    // shortcut: loads every active reminder each minute, add a next-due column when volumes need it.
    const res = await this.db.execute<{ id: string; user_id: string; times: string[]; utc_offset_minutes: number; starts_on: Date | string; ends_on: Date | string | null }>(sql`
      SELECT r.id, r.user_id, r.times, r.utc_offset_minutes, r.starts_on, r.ends_on
      FROM health_reminders r JOIN health_consents c ON c.user_id = r.user_id WHERE r.active`);
    const minute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
    let sent = 0;
    for (const r of res.rows) {
      for (let k = 0; k <= REMINDER_CATCH_UP_MINUTES; k += 1) {
        const instant = minute - k * MINUTE_MS;
        const local = new Date(instant + r.utc_offset_minutes * MINUTE_MS).toISOString(); // wall clock of the user, read as UTC fields
        if (!r.times.includes(local.slice(11, 16))) continue;
        const localDay = local.slice(0, 10);
        if (localDay < day(r.starts_on) || (r.ends_on && localDay > day(r.ends_on))) continue;
        const ins = await this.db.execute<{ id: string }>(sql`
          INSERT INTO health_doses (reminder_id, user_id, due_at) VALUES (${r.id}::uuid, ${r.user_id}::uuid, ${new Date(instant).toISOString()}::timestamptz)
          ON CONFLICT (reminder_id, due_at) DO NOTHING RETURNING id`);
        if (ins.rows[0]) {
          sent += 1;
          await this.notifications.notify({ userId: r.user_id, category: 'reminder', title: 'CASELIND Santé', body: 'C’est l’heure de votre rappel.', data: { doseId: ins.rows[0].id } });
        }
      }
    }
    return sent;
  }

  // ---- Export -----------------------------------------------------------------------------------

  /** Decrypted copy of the user's own data for the personal data export. Empty entries when no consent is on file. */
  async exportFor(userId: string): Promise<ExportedHealth> {
    const consent = await this.consent(userId);
    const entries = await this.db.execute<{ kind: HealthEntry['kind']; recorded_on: Date | string; payload: string }>(sql`SELECT kind, recorded_on, payload FROM health_entries WHERE user_id = ${userId}::uuid ORDER BY recorded_on, id`);
    const reminders = await this.db.execute<ReminderRow>(sql`SELECT id, payload, times, utc_offset_minutes, starts_on, ends_on, active FROM health_reminders WHERE user_id = ${userId}::uuid ORDER BY created_at, id`);
    return {
      consent,
      ...(await this.pro.exportFor(userId)),
      entries: entries.rows.map((r) => {
        const p = this.crypto.open<EntryPayload>(userId, r.payload);
        return { kind: r.kind, recordedOn: day(r.recorded_on), title: p.title, details: p.details, severity: p.severity };
      }),
      reminders: reminders.rows.map((r) => {
        const p = this.crypto.open<ReminderPayload>(userId, r.payload);
        return { title: p.title, dose: p.dose, times: r.times, startsOn: day(r.starts_on), endsOn: r.ends_on ? day(r.ends_on) : null, active: r.active };
      }),
    };
  }
}

type ReminderRow = { id: string; payload: string; times: string[]; utc_offset_minutes: number; starts_on: Date | string; ends_on: Date | string | null; active: boolean };
type DoseRow = { id: string; reminder_id: string; due_at: Date; status: Dose['status']; payload: string };
