import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type AccessLog,
  type AdminProfessionalList,
  type AdminProfessionalsQuery,
  type ApplyProfessionalRequest,
  type Appointment,
  type AppointmentList,
  type CreateAppointmentRequest,
  type CreatePrescriptionRequest,
  type CreateShareRequest,
  type HealthSlotList,
  type MyHealthAvailability,
  type SetHealthAvailabilityRequest,
  type MyProfessional,
  type Prescription,
  type PrescriptionList,
  type ProfessionalList,
  type ProfessionalListQuery,
  type ReviewProfessionalRequest,
  type Share,
  type ShareList,
  type SharedPatients,
  type SharedRecord,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { FlagsService } from '../flags/flags.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { HealthCrypto } from './health-crypto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DAY_MS = 86_400_000;
const invalid = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const consentRequired = () => new AppError(403, ErrorCodes.forbidden, 'Health data needs your explicit consent first', { reason: 'consent_required' });
const notFound = (what: string) => AppError.notFound(`${what} not found`);
const iso = (d: Date | string) => new Date(d).toISOString();
const newCode = (): string => Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Tx = Pick<Db, 'execute' | 'insert'>;

const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([iso(at), id])).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && !Number.isNaN(Date.parse(v[0])) && typeof v[1] === 'string' && UUID_RE.test(v[1])) return { at: v[0], id: v[1] };
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid cursor');
}

/**
 * Health professionals (licence verified by an administrator), appointments, temporary record sharing and e-prescriptions.
 * A professional never reads a record without an active share the patient granted; each read is logged for the patient.
 * The patient's reason and the prescription items are sealed with the patient's health key; nothing sensitive reaches audit.
 */
@Injectable()
export class HealthProService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly crypto: HealthCrypto,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly flags: FlagsService,
  ) {}

  // ---- Professionals ----------------------------------------------------------------------------

  /** Applies (or re-applies after a rejection). Stays hidden until an administrator approves. */
  async apply(userId: string, body: ApplyProfessionalRequest, meta: RequestMeta): Promise<MyProfessional> {
    await this.db.transaction(async (tx) => {
      const cur = await tx.execute<{ status: string }>(sql`SELECT status FROM health_professionals WHERE user_id = ${userId}::uuid FOR UPDATE`);
      const status = cur.rows[0]?.status;
      if (status === 'approved' || status === 'suspended') throw AppError.conflict('Your professional profile is already reviewed', { reason: 'already_registered', status });
      await tx.execute(sql`
        INSERT INTO health_professionals (user_id, kind, specialty, license_number, city, bio)
        VALUES (${userId}::uuid, ${body.kind}, ${body.specialty}, ${body.licenseNumber}, ${body.city}, ${body.bio})
        ON CONFLICT (user_id) DO UPDATE SET kind = EXCLUDED.kind, specialty = EXCLUDED.specialty, license_number = EXCLUDED.license_number,
          city = EXCLUDED.city, bio = EXCLUDED.bio, status = 'pending', review_note = '', reviewed_by = NULL, reviewed_at = NULL`);
      await this.audit.record({ action: 'health.professional_applied', actorUserId: userId, meta, metadata: { kind: body.kind } }, tx);
    });
    return this.mine(userId);
  }

  async mine(userId: string): Promise<MyProfessional> {
    const res = await this.db.execute<{ kind: ApplyKind; specialty: string; license_number: string; city: string; bio: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; review_note: string }>(sql`
      SELECT kind, specialty, license_number, city, bio, status, review_note FROM health_professionals WHERE user_id = ${userId}::uuid`);
    const r = res.rows[0];
    return { profile: r ? { kind: r.kind, specialty: r.specialty, licenseNumber: r.license_number, city: r.city, bio: r.bio, status: r.status, reviewNote: r.review_note } : null };
  }

  /** The public directory: approved professionals only, never the licence number, not those blocked with the caller. */
  async directory(viewerId: string, q: ProfessionalListQuery): Promise<ProfessionalList> {
    const f: SQL[] = [sql`p.status = 'approved'`, sql`p.user_id <> ${viewerId}::uuid`, sql`NOT EXISTS (
      SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ${viewerId}::uuid))`];
    if (q.kind) f.push(sql`p.kind = ${q.kind}`);
    if (q.city) f.push(sql`p.city ILIKE ${escapeLike(q.city)}`);
    if (q.q) f.push(sql`(u.display_name ILIKE ${'%' + escapeLike(q.q) + '%'} OR p.specialty ILIKE ${'%' + escapeLike(q.q) + '%'})`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(p.created_at, p.user_id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<{ user_id: string; display_name: string; handle: string; kind: ApplyKind; specialty: string; city: string; bio: string; created_at: Date }>(sql`
      SELECT p.user_id, u.display_name, u.handle::text AS handle, p.kind, p.specialty, p.city, p.bio, p.created_at
      FROM health_professionals p JOIN users u ON u.id = p.user_id WHERE ${sql.join(f, sql` AND `)} ORDER BY p.created_at DESC, p.user_id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, handle: r.handle, kind: r.kind, specialty: r.specialty, city: r.city, bio: r.bio })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.user_id) : null,
    };
  }

  async adminList(q: AdminProfessionalsQuery): Promise<AdminProfessionalList> {
    const f: SQL[] = [sql`TRUE`];
    if (q.status) f.push(sql`p.status = ${q.status}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(p.created_at, p.user_id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<{ user_id: string; display_name: string; handle: string; kind: ApplyKind; specialty: string; license_number: string; city: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; review_note: string; created_at: Date }>(sql`
      SELECT p.user_id, u.display_name, u.handle::text AS handle, p.kind, p.specialty, p.license_number, p.city, p.status, p.review_note, p.created_at
      FROM health_professionals p JOIN users u ON u.id = p.user_id WHERE ${sql.join(f, sql` AND `)} ORDER BY p.created_at DESC, p.user_id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, handle: r.handle, kind: r.kind, specialty: r.specialty, licenseNumber: r.license_number, city: r.city, status: r.status, reviewNote: r.review_note, createdAt: iso(r.created_at) })),
      nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.created_at, last.user_id) : null,
    };
  }

  /** Administrator decision after checking the licence with the competent body. Suspension also cuts every share. */
  async review(adminId: string, userId: string, body: ReviewProfessionalRequest, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(userId)) throw notFound('Professional');
    const status = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'suspended';
    await this.db.transaction(async (tx) => {
      const upd = await tx.execute(sql`UPDATE health_professionals SET status = ${status}, review_note = ${body.note}, reviewed_by = ${adminId}::uuid, reviewed_at = now() WHERE user_id = ${userId}::uuid`);
      if ((upd.rowCount ?? 0) === 0) throw notFound('Professional');
      await this.audit.record({ action: 'health.professional_reviewed', actorUserId: adminId, meta, metadata: { professionalId: userId, decision: body.decision } }, tx);
    });
    await this.notifications.notify({
      userId,
      category: 'system',
      title: 'CASELIND Santé',
      body: status === 'approved' ? 'Votre profil professionnel est vérifié.' : status === 'suspended' ? 'Votre profil professionnel est suspendu.' : 'Votre demande de profil professionnel n’a pas été retenue.',
      data: {},
    });
  }

  private async approvedPro(professionalId: string): Promise<void> {
    if (!UUID_RE.test(professionalId)) throw notFound('Professional');
    const res = await this.db.execute(sql`SELECT 1 FROM health_professionals WHERE user_id = ${professionalId}::uuid AND status = 'approved'`);
    if (res.rows.length === 0) throw notFound('Professional');
  }

  private async blocked(a: string, b: string): Promise<boolean> {
    const res = await this.db.execute(sql`SELECT 1 FROM user_blocks WHERE (blocker_id = ${a}::uuid AND blocked_id = ${b}::uuid) OR (blocker_id = ${b}::uuid AND blocked_id = ${a}::uuid) LIMIT 1`);
    return res.rows.length > 0;
  }

  private async requirePatientConsent(userId: string): Promise<void> {
    const res = await this.db.execute(sql`SELECT 1 FROM health_consents WHERE user_id = ${userId}::uuid`);
    if (res.rows.length === 0) throw consentRequired();
  }

// ---- Availability and agenda (lot 18c) --------------------------------------------------------

  async myAvailability(userId: string): Promise<MyHealthAvailability> {
    const res = await this.db.execute<{ slot_minutes: number; utc_offset_minutes: number; windows: Window[] }>(sql`SELECT slot_minutes, utc_offset_minutes, windows FROM health_availability WHERE professional_id = ${userId}::uuid`);
    const r = res.rows[0];
    return { availability: r ? { slotMinutes: r.slot_minutes as 15, utcOffsetMinutes: r.utc_offset_minutes, windows: r.windows } : null };
  }

  /** Only a professional whose licence is verified; an empty list removes the availability. */
  async setAvailability(userId: string, body: SetHealthAvailabilityRequest, meta: RequestMeta): Promise<MyHealthAvailability> {
    await this.approvedPro(userId);
    await this.db.transaction(async (tx) => {
      if (body.windows.length === 0) await tx.execute(sql`DELETE FROM health_availability WHERE professional_id = ${userId}::uuid`);
      else
        await tx.execute(sql`
          INSERT INTO health_availability (professional_id, slot_minutes, utc_offset_minutes, windows) VALUES (${userId}::uuid, ${body.slotMinutes}, ${body.utcOffsetMinutes}, ${JSON.stringify(body.windows)}::jsonb)
          ON CONFLICT (professional_id) DO UPDATE SET slot_minutes = EXCLUDED.slot_minutes, utc_offset_minutes = EXCLUDED.utc_offset_minutes, windows = EXCLUDED.windows, updated_at = now()`);
      await this.audit.record({ action: 'health.availability_updated', actorUserId: userId, meta, metadata: { windows: body.windows.length, slotMinutes: body.slotMinutes } }, tx);
    });
    return this.myAvailability(userId);
  }

  /** Free slots of the next 14 days: windows cut into slots, in the future, minus requested or confirmed appointments. null = no availability set. */
  private async freeSlots(professionalId: string): Promise<{ slotMinutes: number; starts: string[] } | null> {
    const res = await this.db.execute<{ slot_minutes: number; utc_offset_minutes: number; windows: Window[] }>(sql`SELECT slot_minutes, utc_offset_minutes, windows FROM health_availability WHERE professional_id = ${professionalId}::uuid`);
    const a = res.rows[0];
    if (!a) return null;
    const now = Date.now();
    const end = now + 14 * DAY_MS;
    const taken = await this.db.execute<{ starts_at: Date }>(sql`
      SELECT starts_at FROM health_appointments WHERE professional_id = ${professionalId}::uuid AND status IN ('requested', 'confirmed') AND starts_at > now() AND starts_at <= ${new Date(end).toISOString()}::timestamptz`);
    const busy = new Set(taken.rows.map((r) => iso(r.starts_at)));
    const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
    const localMidnight = Math.floor((now + a.utc_offset_minutes * 60_000) / DAY_MS) * DAY_MS; // the professional's today, as a UTC-looking instant
    const starts: string[] = [];
    for (let d = 0; d <= 14; d++) {
      const base = localMidnight + d * DAY_MS;
      const dow = new Date(base).getUTCDay() || 7;
      for (const w of a.windows.filter((x) => x.day === dow)) {
        for (let t = toMin(w.start); t + a.slot_minutes <= toMin(w.end); t += a.slot_minutes) {
          const at = base + (t - a.utc_offset_minutes) * 60_000;
          if (at > now && at <= end && !busy.has(new Date(at).toISOString())) starts.push(new Date(at).toISOString());
        }
      }
    }
    return { slotMinutes: a.slot_minutes, starts: starts.sort() };
  }

  async slots(viewerId: string, professionalId: string): Promise<HealthSlotList> {
    await this.approvedPro(professionalId);
    if (await this.blocked(viewerId, professionalId)) throw notFound('Professional');
    const f = await this.freeSlots(professionalId);
    return { slotMinutes: f?.slotMinutes ?? null, items: (f?.starts ?? []).map((startsAt) => ({ startsAt })) };
  }

  /** The professional's upcoming appointments (requested or confirmed), soonest first. */
  async agenda(professionalId: string): Promise<AppointmentList> {
    const res = await this.db.execute<ApptRow>(sql`${this.apptBase()} WHERE a.professional_id = ${professionalId}::uuid AND a.status IN ('requested', 'confirmed') AND a.starts_at >= now() ORDER BY a.starts_at, a.id LIMIT 100`);
    return { items: res.rows.map((r) => this.toAppointment(r, professionalId)), nextCursor: null };
  }

  // ---- Appointments -----------------------------------------------------------------------------

  async book(patientId: string, body: CreateAppointmentRequest, meta: RequestMeta): Promise<Appointment> {
    await this.requirePatientConsent(patientId);
    if (body.professionalId === patientId) throw AppError.forbidden('You cannot book yourself');
    await this.approvedPro(body.professionalId);
    if (await this.blocked(patientId, body.professionalId)) throw notFound('Professional');
    const when = new Date(body.startsAt);
    if (when.getTime() <= Date.now() || when.getTime() > Date.now() + 365 * DAY_MS) throw invalid('startsAt', 'must be in the future, within a year');
    const free = await this.freeSlots(body.professionalId); // lot 18c: with availability, only a free slot may be requested
    if (free && !free.starts.includes(when.toISOString())) throw AppError.conflict('That time is not a free slot of the professional', { reason: 'slot_unavailable' });
    if (body.mode === 'teleconsultation' && !(await this.flags.evaluateForUser('health.teleconsultation', patientId))) throw AppError.featureDisabled('Teleconsultation is not available');
    const reasonEnc = this.crypto.seal(patientId, { reason: body.reason });
    const id = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO health_appointments (patient_id, professional_id, starts_at, mode, reason_enc)
        VALUES (${patientId}::uuid, ${body.professionalId}::uuid, ${when.toISOString()}::timestamptz, ${body.mode}, ${reasonEnc}) RETURNING id`);
      const apptId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.appointment_requested', actorUserId: patientId, meta, metadata: { appointmentId: apptId, mode: body.mode } }, tx);
      return apptId;
    });
    await this.notifications.notify({ userId: body.professionalId, category: 'booking', title: 'CASELIND Santé', body: 'Nouvelle demande de rendez-vous.', data: { appointmentId: id } });
    return this.appointment(patientId, id);
  }

  async myAppointments(userId: string, role: 'patient' | 'professional', q: { limit: number; cursor?: string }): Promise<AppointmentList> {
    if (role === 'patient') await this.requirePatientConsent(userId);
    const f: SQL[] = [role === 'patient' ? sql`a.patient_id = ${userId}::uuid` : sql`a.professional_id = ${userId}::uuid`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      f.push(sql`(a.starts_at, a.id) < (${c.at}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<ApptRow>(sql`${this.apptBase()} WHERE ${sql.join(f, sql` AND `)} ORDER BY a.starts_at DESC, a.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.toAppointment(r, userId)), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.starts_at, last.id) : null };
  }

  private apptBase(): SQL {
    return sql`
      SELECT a.id, a.patient_id, a.professional_id, a.starts_at, a.mode, a.status, a.reason_enc,
        pu.id AS p_id, pu.display_name AS p_name, pu.handle::text AS p_handle, fu.id AS f_id, fu.display_name AS f_name, fu.handle::text AS f_handle,
        EXISTS (SELECT 1 FROM health_prescriptions rx WHERE rx.appointment_id = a.id) AS has_rx
      FROM health_appointments a JOIN users pu ON pu.id = a.patient_id JOIN users fu ON fu.id = a.professional_id`;
  }

  private toAppointment(r: ApptRow, viewerId: string): Appointment {
    const patient = r.patient_id === viewerId;
    return {
      id: r.id,
      startsAt: iso(r.starts_at),
      mode: r.mode,
      status: r.status,
      role: patient ? 'patient' : 'professional',
      other: patient ? { id: r.f_id, displayName: r.f_name, handle: r.f_handle } : { id: r.p_id, displayName: r.p_name, handle: r.p_handle },
      reason: this.crypto.open<{ reason: string }>(r.patient_id, r.reason_enc).reason,
      hasPrescription: r.has_rx,
    };
  }

  private async appointment(viewerId: string, id: string): Promise<Appointment> {
    if (!UUID_RE.test(id)) throw notFound('Appointment');
    const res = await this.db.execute<ApptRow>(sql`${this.apptBase()} WHERE a.id = ${id}::uuid AND (a.patient_id = ${viewerId}::uuid OR a.professional_id = ${viewerId}::uuid)`);
    if (!res.rows[0]) throw notFound('Appointment');
    return this.toAppointment(res.rows[0], viewerId);
  }

  /** confirm | decline | complete are the professional's; cancel is for either side. */
  async act(userId: string, id: string, action: 'confirm' | 'decline' | 'cancel' | 'complete', meta: RequestMeta): Promise<Appointment> {
    if (!UUID_RE.test(id)) throw notFound('Appointment');
    const notify = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ patient_id: string; professional_id: string; status: string; starts_at: Date }>(sql`
        SELECT patient_id, professional_id, status, starts_at FROM health_appointments WHERE id = ${id}::uuid AND (patient_id = ${userId}::uuid OR professional_id = ${userId}::uuid) FOR UPDATE`);
      const a = res.rows[0];
      if (!a) throw notFound('Appointment');
      const isPro = a.professional_id === userId;
      if (action !== 'cancel' && !isPro) throw notFound('Appointment');
      const allowed: Record<typeof action, string[]> = { confirm: ['requested'], decline: ['requested'], cancel: ['requested', 'confirmed'], complete: ['confirmed'] };
      const to = { confirm: 'confirmed', decline: 'declined', cancel: 'cancelled', complete: 'completed' }[action];
      if (a.status === to && action === 'cancel') return null; // idempotent cancel
      if (!allowed[action].includes(a.status)) throw AppError.conflict(`An appointment ${a.status} cannot be ${to}`, { reason: 'invalid_transition', from: a.status, to });
      if (action === 'complete' && new Date(a.starts_at).getTime() > Date.now()) throw AppError.conflict('The appointment has not started yet', { reason: 'not_started' });
      try {
        await tx.execute(sql`UPDATE health_appointments SET status = ${to}, updated_at = now() WHERE id = ${id}::uuid`);
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } };
        if (e.code === '23505' || e.cause?.code === '23505') throw AppError.conflict('You already have a confirmed appointment at that time', { reason: 'slot_taken' });
        throw err;
      }
      await this.audit.record({ action: 'health.appointment_updated', actorUserId: userId, meta, metadata: { appointmentId: id, to } }, tx);
      return { to, userId: isPro ? a.patient_id : a.professional_id };
    });
    if (notify) {
      const text = { confirmed: 'Votre rendez-vous est confirmé.', declined: 'Votre demande de rendez-vous est refusée.', cancelled: 'Un rendez-vous a été annulé.', completed: 'Votre rendez-vous est terminé.' }[notify.to]!;
      await this.notifications.notify({ userId: notify.userId, category: 'booking', title: 'CASELIND Santé', body: text, data: { appointmentId: id } });
    }
    return this.appointment(userId, id);
  }

  // ---- Sharing the record -----------------------------------------------------------------------

  /** The patient lets one verified professional read the chosen kinds for a limited time. Replaces any earlier active share with them. */
  async share(patientId: string, body: CreateShareRequest, meta: RequestMeta): Promise<Share> {
    await this.requirePatientConsent(patientId);
    if (body.professionalId === patientId) throw AppError.forbidden('You cannot share with yourself');
    await this.approvedPro(body.professionalId);
    if (await this.blocked(patientId, body.professionalId)) throw notFound('Professional');
    const expires = new Date(Date.now() + body.days * DAY_MS);
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE health_shares SET revoked_at = now() WHERE patient_id = ${patientId}::uuid AND professional_id = ${body.professionalId}::uuid AND revoked_at IS NULL AND expires_at > now()`);
      const res = await tx.execute<{ id: string }>(sql`
        INSERT INTO health_shares (patient_id, professional_id, kinds, expires_at)
        VALUES (${patientId}::uuid, ${body.professionalId}::uuid, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(body.kinds)}::jsonb)), ${expires.toISOString()}::timestamptz) RETURNING id`);
      const shareId = res.rows[0]!.id;
      await this.audit.record({ action: 'health.share_granted', actorUserId: patientId, meta, metadata: { shareId, professionalId: body.professionalId, kinds: body.kinds, days: body.days } }, tx);
      return shareId;
    });
    await this.notifications.notify({ userId: body.professionalId, category: 'system', title: 'CASELIND Santé', body: 'Un patient a partagé une partie de son dossier avec vous.', data: { shareId: id } });
    return this.shareById(patientId, id);
  }

  async myShares(patientId: string): Promise<ShareList> {
    await this.requirePatientConsent(patientId);
    const res = await this.db.execute<ShareRow>(sql`${this.shareBase()} WHERE s.patient_id = ${patientId}::uuid ORDER BY s.created_at DESC, s.id DESC LIMIT 50`);
    return { items: res.rows.map(toShare) };
  }

  async revokeShare(patientId: string, id: string, meta: RequestMeta): Promise<Share> {
    if (!UUID_RE.test(id)) throw notFound('Share');
    await this.db.transaction(async (tx) => {
      const own = await tx.execute(sql`SELECT 1 FROM health_shares WHERE id = ${id}::uuid AND patient_id = ${patientId}::uuid`);
      if (own.rows.length === 0) throw notFound('Share');
      const upd = await tx.execute(sql`UPDATE health_shares SET revoked_at = now() WHERE id = ${id}::uuid AND revoked_at IS NULL`);
      if ((upd.rowCount ?? 0) > 0) await this.audit.record({ action: 'health.share_revoked', actorUserId: patientId, meta, metadata: { shareId: id } }, tx);
    });
    return this.shareById(patientId, id);
  }

  async accessLog(patientId: string): Promise<AccessLog> {
    await this.requirePatientConsent(patientId);
    const res = await this.db.execute<{ at: Date; id: string; display_name: string; handle: string; entries_count: number }>(sql`
      SELECT l.at, u.id, u.display_name, u.handle::text AS handle, l.entries_count FROM health_access_log l JOIN users u ON u.id = l.accessor_id
      WHERE l.patient_id = ${patientId}::uuid ORDER BY l.id DESC LIMIT 100`);
    return { items: res.rows.map((r) => ({ at: iso(r.at), accessor: { id: r.id, displayName: r.display_name, handle: r.handle }, entriesCount: r.entries_count })) };
  }

  private shareBase(): SQL {
    return sql`
      SELECT s.id, s.kinds, s.expires_at, s.revoked_at, (s.revoked_at IS NULL AND s.expires_at > now()) AS active, u.id AS u_id, u.display_name, u.handle::text AS handle
      FROM health_shares s JOIN users u ON u.id = s.professional_id`;
  }

  private async shareById(patientId: string, id: string): Promise<Share> {
    const res = await this.db.execute<ShareRow>(sql`${this.shareBase()} WHERE s.id = ${id}::uuid AND s.patient_id = ${patientId}::uuid`);
    if (!res.rows[0]) throw notFound('Share');
    return toShare(res.rows[0]);
  }

  /** Professional side: the patients who currently share something (active share, approved professional, patient still consenting). */
  async sharedPatients(professionalId: string): Promise<SharedPatients> {
    const res = await this.db.execute<{ id: string; kinds: string[]; expires_at: Date; u_id: string; display_name: string; handle: string }>(sql`
      SELECT s.id, s.kinds, s.expires_at, u.id AS u_id, u.display_name, u.handle::text AS handle
      FROM health_shares s JOIN users u ON u.id = s.patient_id
      JOIN health_professionals p ON p.user_id = s.professional_id AND p.status = 'approved'
      JOIN health_consents c ON c.user_id = s.patient_id
      WHERE s.professional_id = ${professionalId}::uuid AND s.revoked_at IS NULL AND s.expires_at > now() ORDER BY s.created_at DESC LIMIT 100`);
    return { items: res.rows.map((r) => ({ shareId: r.id, patient: { id: r.u_id, displayName: r.display_name, handle: r.handle }, kinds: r.kinds as SharedPatients['items'][number]['kinds'], expiresAt: iso(r.expires_at) })) };
  }

  /** Reads the shared kinds of one patient. No active share (or revoked, expired, professional suspended, patient withdrew): 404. Logged for the patient. */
  async readSharedRecord(professionalId: string, patientId: string, meta: RequestMeta): Promise<SharedRecord> {
    if (!UUID_RE.test(patientId)) throw notFound('Record');
    const share = await this.db.execute<{ id: string; kinds: string[]; expires_at: Date; display_name: string }>(sql`
      SELECT s.id, s.kinds, s.expires_at, u.display_name FROM health_shares s JOIN users u ON u.id = s.patient_id
      JOIN health_professionals p ON p.user_id = s.professional_id AND p.status = 'approved'
      JOIN health_consents c ON c.user_id = s.patient_id
      WHERE s.professional_id = ${professionalId}::uuid AND s.patient_id = ${patientId}::uuid AND s.revoked_at IS NULL AND s.expires_at > now()
      ORDER BY s.created_at DESC LIMIT 1`);
    const s = share.rows[0];
    if (!s) throw notFound('Record');
    const entries = await this.db.execute<{ kind: SharedRecord['entries'][number]['kind']; recorded_on: string; payload: string }>(sql`
      SELECT kind, to_char(recorded_on, 'YYYY-MM-DD') AS recorded_on, payload FROM health_entries WHERE user_id = ${patientId}::uuid AND kind IN (${sql.join(s.kinds.map((k) => sql`${k}`), sql`, `)}) ORDER BY recorded_on DESC, id DESC LIMIT 500`);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO health_access_log (patient_id, accessor_id, share_id, entries_count) VALUES (${patientId}::uuid, ${professionalId}::uuid, ${s.id}::uuid, ${entries.rows.length})`);
      await this.audit.record({ action: 'health.record_read', actorUserId: professionalId, meta, metadata: { shareId: s.id, entries: entries.rows.length } }, tx);
    });
    return {
      patient: { id: patientId, displayName: s.display_name },
      expiresAt: iso(s.expires_at),
      entries: entries.rows.map((r) => {
        const p = this.crypto.open<{ title: string; details: string; severity: number | null }>(patientId, r.payload);
        return { kind: r.kind, recordedOn: r.recorded_on, title: p.title, details: p.details, severity: p.severity };
      }),
    };
  }

  // ---- E-prescriptions (regulated flag `health.prescriptions`) ----------------------------------

  async prescribe(professionalId: string, appointmentId: string, body: CreatePrescriptionRequest, meta: RequestMeta): Promise<Prescription> {
    if (!(await this.flags.evaluateForUser('health.prescriptions', professionalId))) throw AppError.featureDisabled('Electronic prescriptions are not available');
    if (!UUID_RE.test(appointmentId)) throw notFound('Appointment');
    const today = new Date().toISOString().slice(0, 10);
    const max = new Date(Date.now() + 365 * DAY_MS).toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(body.validUntil)) || body.validUntil < today || body.validUntil > max) throw invalid('validUntil', 'must be today or later, within a year');
    const out = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ patient_id: string; status: string }>(sql`
        SELECT a.patient_id, a.status FROM health_appointments a JOIN health_professionals p ON p.user_id = a.professional_id AND p.status = 'approved'
        WHERE a.id = ${appointmentId}::uuid AND a.professional_id = ${professionalId}::uuid FOR UPDATE OF a`);
      const a = res.rows[0];
      if (!a) throw notFound('Appointment');
      if (a.status !== 'completed') throw AppError.conflict('Only a completed appointment can lead to a prescription', { reason: 'appointment_not_completed' });
      const dup = await tx.execute(sql`SELECT 1 FROM health_prescriptions WHERE appointment_id = ${appointmentId}::uuid`);
      if (dup.rows.length > 0) throw AppError.conflict('A prescription was already issued for this appointment', { reason: 'already_issued' });
      const itemsEnc = this.crypto.seal(a.patient_id, { items: body.items });
      for (let i = 0; i < 5; i += 1) {
        const code = newCode();
        const ins = await tx.execute<{ id: string }>(sql`
          INSERT INTO health_prescriptions (appointment_id, patient_id, professional_id, code, items_enc, valid_until)
          VALUES (${appointmentId}::uuid, ${a.patient_id}::uuid, ${professionalId}::uuid, ${code}, ${itemsEnc}, ${body.validUntil}::date) ON CONFLICT (code) DO NOTHING RETURNING id`);
        if (ins.rows[0]) {
          await this.audit.record({ action: 'health.prescription_issued', actorUserId: professionalId, meta, metadata: { prescriptionId: ins.rows[0].id, appointmentId } }, tx);
          return { id: ins.rows[0].id, patientId: a.patient_id };
        }
      }
      throw new AppError(500, ErrorCodes.internal, 'Could not issue a prescription code');
    });
    await this.notifications.notify({ userId: out.patientId, category: 'system', title: 'CASELIND Santé', body: 'Une ordonnance est disponible.', data: { prescriptionId: out.id } });
    return (await this.prescriptions({ id: out.id }, out.patientId))[0]!;
  }

  async myPrescriptions(patientId: string): Promise<PrescriptionList> {
    await this.requirePatientConsent(patientId);
    return { items: await this.prescriptions({ patient: patientId }, patientId) };
  }

  private async prescriptions(where: { id?: string; patient?: string }, patientId: string): Promise<Prescription[]> {
    const f = where.id ? sql`rx.id = ${where.id}::uuid` : sql`rx.patient_id = ${where.patient!}::uuid`;
    const res = await this.db.execute<{ id: string; appointment_id: string; code: string; valid_until: string; items_enc: string; created_at: Date; pro_id: string; pro_name: string }>(sql`
      SELECT rx.id, rx.appointment_id, rx.code, to_char(rx.valid_until, 'YYYY-MM-DD') AS valid_until, rx.items_enc, rx.created_at, u.id AS pro_id, u.display_name AS pro_name
      FROM health_prescriptions rx JOIN users u ON u.id = rx.professional_id WHERE ${f} AND rx.patient_id = ${patientId}::uuid ORDER BY rx.created_at DESC LIMIT 50`);
    return res.rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointment_id,
      code: r.code,
      validUntil: r.valid_until,
      items: this.crypto.open<{ items: { name: string; dose: string; instructions: string }[] }>(patientId, r.items_enc).items,
      professional: { id: r.pro_id, displayName: r.pro_name },
      createdAt: iso(r.created_at),
    }));
  }

  // ---- Erasure and export (called with the 18a ones) --------------------------------------------

  /** Everything the user holds as a patient, sealed with their key, plus their professional application. */
  async exportFor(userId: string): Promise<{
    professional: MyProfessional['profile'];
    availability: MyHealthAvailability['availability'];
    appointments: { startsAt: string; mode: string; status: string; professional: string; reason: string }[];
    prescriptions: { code: string; validUntil: string; items: { name: string; dose: string; instructions: string }[] }[];
  }> {
    const appts = await this.db.execute<ApptRow>(sql`${this.apptBase()} WHERE a.patient_id = ${userId}::uuid ORDER BY a.starts_at, a.id`);
    return {
      professional: (await this.mine(userId)).profile,
      availability: (await this.myAvailability(userId)).availability,
      appointments: appts.rows.map((r) => {
        const a = this.toAppointment(r, userId);
        return { startsAt: a.startsAt, mode: a.mode, status: a.status, professional: a.other.displayName, reason: a.reason };
      }),
      prescriptions: (await this.prescriptions({ patient: userId }, userId)).map((p) => ({ code: p.code, validUntil: p.validUntil, items: p.items })),
    };
  }

  /** Patient-side erasure: appointments (with their prescriptions), shares and the access log. */
  async eraseFor(tx: Tx, userId: string): Promise<void> {
    await tx.execute(sql`DELETE FROM health_appointments WHERE patient_id = ${userId}::uuid`);
    await tx.execute(sql`DELETE FROM health_shares WHERE patient_id = ${userId}::uuid`);
    await tx.execute(sql`DELETE FROM health_access_log WHERE patient_id = ${userId}::uuid`);
  }
}

type Window = { day: number; start: string; end: string };
type ApplyKind = 'doctor' | 'dentist' | 'laboratory' | 'pharmacist' | 'nurse' | 'psychologist' | 'other';
type ApptRow = {
  id: string;
  patient_id: string;
  professional_id: string;
  starts_at: Date;
  mode: Appointment['mode'];
  status: Appointment['status'];
  reason_enc: string;
  p_id: string;
  p_name: string;
  p_handle: string;
  f_id: string;
  f_name: string;
  f_handle: string;
  has_rx: boolean;
};
type ShareRow = { id: string; kinds: string[]; expires_at: Date; revoked_at: Date | null; active: boolean; u_id: string; display_name: string; handle: string };
const toShare = (r: ShareRow): Share => ({
  id: r.id,
  professional: { id: r.u_id, displayName: r.display_name, handle: r.handle },
  kinds: r.kinds as Share['kinds'],
  expiresAt: iso(r.expires_at),
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
  active: r.active,
});
