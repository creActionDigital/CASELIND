import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { auditEvents } from '../db/schema.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.register_existing_identifier'
  | 'auth.otp_verified'
  | 'auth.otp_failed'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.account_locked'
  | 'auth.refresh_token_reuse'
  | 'auth.logout'
  | 'auth.session_revoked'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.deletion_cancelled'
  /** Lot 1c: 2FA and QR login. Never a code, a secret or a payload; metadata {remaining} / {qrSessionId} / {channel}. */
  | 'auth.2fa_enabled'
  | 'auth.2fa_disabled'
  | 'auth.2fa_failed'
  | 'auth.2fa_backup_used'
  | 'auth.qr_approved'
  | 'user.identifier_change_requested'
  | 'user.identifier_changed'
  | 'user.profile_updated'
  | 'user.privacy_updated'
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.data_exported'
  | 'user.deletion_requested'
  | 'user.deleted'
  | 'admin.flag_updated'
  | 'media.uploaded'
  | 'media.rejected'
  | 'media.deleted'
  | 'user.avatar_updated'
  | 'org.created'
  | 'org.updated'
  | 'org.member_invited'
  | 'org.invitation_accepted'
  | 'org.invitation_declined'
  | 'org.member_role_changed'
  | 'org.member_removed'
  /** System (maintenance): the org's last active owner was purged; metadata.orgId. */
  | 'org.suspended_orphaned'
  /** Messaging governance (lot 3A). Never the message content. */
  | 'conversation.group_created'
  | 'conversation.member_added'
  | 'community.published'
  | 'community.unpublished'
  | 'community.joined'
  /** Personal finance (sandbox): metadata {currency, limitMinor?}. */
  | 'finance.budget_set'
  | 'finance.budget_removed'
  /** Classified ads (lot 15): metadata {listingId, kind?}. Never the text or the contact. */
  | 'listing.created'
  | 'listing.updated'
  | 'listing.closed'
  | 'listing.alert_created'
  | 'listing.alert_deleted'
  /** Visit appointments (lot 15c): metadata {visitId, listingId}. Never the message or the place. */
  | 'listing.visit_requested'
  | 'listing.visit_confirmed'
  | 'listing.visit_declined'
  | 'listing.visit_cancelled'
  /** Jobs (lot 16a): metadata ids and statuses only, never a CV, a message or a name. */
  | 'job.posted'
  | 'job.updated'
  | 'job.closed'
  | 'job.alert_created'
  | 'job.alert_deleted'
  | 'job.profile_saved'
  | 'job.profile_deleted'
  | 'job.applied'
  | 'job.application_withdrawn'
  | 'job.application_status'
  | 'job.interview_proposed'
  | 'job.interview_confirmed'
  | 'job.interview_declined'
  | 'job.interview_cancelled'
  /** Freelance (lot 16b): ids and outcomes only, never a message, a note or a reason. */
  | 'freelance.mission_created'
  | 'freelance.mission_updated'
  | 'freelance.mission_closed'
  | 'freelance.proposal_sent'
  | 'freelance.proposal_withdrawn'
  | 'freelance.proposal_accepted'
  | 'freelance.milestone_delivered'
  | 'freelance.milestone_approved'
  | 'freelance.milestone_revision'
  | 'freelance.contract_completed'
  | 'freelance.contract_cancelled'
  | 'freelance.review_left'
  | 'freelance.dispute_opened'
  | 'freelance.dispute_resolved'
  | 'freelance.profile_saved'
  | 'freelance.profile_disabled'
  /** Education (lot 17a): ids and scores only, never lesson text, answers or a name. */
  | 'education.course_created'
  | 'education.course_published'
  | 'education.course_unpublished'
  | 'education.enrolled'
  | 'education.quiz_attempted'
  | 'education.certificate_issued'
  | 'education.review_saved'
  | 'education.review_deleted'
  | 'education.exam_configured'
  | 'education.exam_started'
  | 'education.exam_finished'
  /** Health (lot 18a): ids and kinds only. Never a title, a detail, a symptom, a medicine or a dose. */
  | 'health.consent_granted'
  | 'health.consent_revoked'
  | 'health.entry_created'
  | 'health.entry_updated'
  | 'health.entry_deleted'
  | 'health.reminder_created'
  | 'health.reminder_deleted'
  | 'health.erased'
  /** Health professionals (lot 18b): ids, kinds and decisions only; never a licence number, a reason or a record's content. */
  | 'health.professional_applied'
  | 'health.professional_reviewed'
  | 'health.appointment_requested'
  | 'health.appointment_updated'
  | 'health.share_granted'
  | 'health.share_revoked'
  | 'health.availability_updated'
  | 'health.record_read'
  | 'health.prescription_issued'
  /** Games (lot 20a): session id and score only, never an answer. */
  | 'games.session_started'
  | 'games.session_finished'
  | 'games.tournament_created'
  | 'school.class_created'
  | 'school.enrolled'
  | 'school.unenrolled'
  | 'school.left'
  | 'school.announced'
  | 'school.scholarship_published'
  | 'school.scholarship_closed'
  | 'school.scholarship_updated'
  | 'conversation.member_removed'
  | 'conversation.member_role_changed'
  | 'message.recalled'
  /** Moderation (lot 4B): metadata {targetType, targetId, action}. Never the content. */
  | 'moderation.action'
  /** Commerce (lot 5B): metadata {orgId, orderId, number, from, to} / {orgId, couponId, code}. */
  | 'commerce.order_status_changed'
  | 'commerce.coupon_created'
  | 'commerce.document_created'
  | 'commerce.document_status'
  | 'commerce.coupon_deactivated'
  /** Services (lot 9): metadata {offerId, orgId?, fields?}. Never a booking note. */
  | 'service.created'
  | 'service.updated'
  | 'service.archived'
  /** Catalogue (lot 5A): metadata {orgId, productId[, variantId, delta, reason]}. No free text. */
  | 'product.created'
  | 'product.published'
  | 'product.archived'
  | 'stock.adjusted'
  /** Sandbox wallet (lot 6A): metadata {transferId, amountMinor, currency, counterpartyId}. Never the note. */
  | 'wallet.transfer'
  | 'wallet.sandbox_topup'
  /** Ledger back-office (lot 6A): metadata {accountId, ownerKind, orgId, currency}. */
  | 'ledger.account_frozen'
  | 'ledger.account_unfrozen'
  /** KYC (lot 6B): metadata {submissionId, level[, reason]}. Never the identity, the number or the files. */
  | 'kyc.submitted'
  | 'kyc.approved'
  | 'kyc.rejected'
  | 'kyc.viewed'
  /** Payment PIN (lot 6B): never the PIN. */
  | 'wallet.pin_set'
  | 'wallet.pin_failed'
  | 'wallet.pin_locked'
  /** Merchant QR (lot 6B): metadata {orgId, qrId[, currency, amountMinor]}. */
  | 'wallet.qr_created'
  | 'wallet.qr_revoked'
  /** Delivery (lot 8): metadata {orgId, deliveryId, orderId[, courierUserId, from, to, zoneId]}. Never a code, a position or an address. */
  | 'delivery.zone_saved'
  | 'delivery.zone_deleted'
  | 'delivery.assigned'
  | 'delivery.status_changed'
  | 'delivery.proof_reset'
  /** Mobility (lot 11): driver decisions. metadata {driverUserId, decision}. */
  | 'mobility.driver_decided'
  /** Mini-apps (lot 10): metadata {orgId?, appId[, scopes, decision, from, to, kind, requestId, transferId]}. Never a secret, a code or a token. */
  | 'miniapp.created'
  | 'miniapp.updated'
  | 'miniapp.submitted'
  | 'miniapp.secret_rotated'
  | 'miniapp.reviewed'
  | 'miniapp.authorized'
  | 'miniapp.grant_revoked'
  | 'miniapp.token_replay'
  | 'miniapp.payment_confirmed'
  /** AI (lot 12): admin enables/disables a catalogue model. metadata {modelId, from, to}. Never a prompt, a reply or a key. */
  | 'ai.model_toggled';

export interface AuditInput {
  action: AuditAction;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  sessionId?: string | null;
  meta?: RequestMeta;
  /** Never put secrets (passwords, codes, tokens) here. */
  metadata?: Record<string, unknown>;
}

/** Writes to the append-only audit_events table (UPDATE/DELETE are rejected by a DB trigger). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Db) {}

  /** `executor`: pass a transaction so the audit row commits (or rolls back) with the change. */
  async record(input: AuditInput, executor: Pick<Db, 'insert'> = this.db): Promise<void> {
    await executor.insert(auditEvents).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      subjectUserId: input.subjectUserId ?? input.actorUserId ?? null,
      sessionId: input.sessionId ?? null,
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
      requestId: input.meta?.requestId ?? null,
      metadata: input.metadata ?? {},
    });
    this.logger.log({ action: input.action, subject: input.subjectUserId ?? input.actorUserId }, 'audit');
  }
}
