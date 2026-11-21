import { describe, expect, it } from 'vitest';
import { ROUTES } from '../lib/back-target';
import { notificationTarget as t } from './targets';

type Row = [string, string, Record<string, string>, string, Record<string, string>?];

const rows: Row[] = [
  ['message', 'conversationId', { conversationId: 'c1' }, '/messages/[conversationId]', { conversationId: 'c1' }],
  ['system', 'rideId', { rideId: 'r1' }, '/rides/[rideId]', { rideId: 'r1' }],
  ['delivery', 'deliveryId', { deliveryId: 'd1', orderId: 'o1' }, '/deliveries/[deliveryId]', { deliveryId: 'd1', orderId: 'o1' }],
  ['delivery', 'orgId+orderId', { orgId: 'g', orderId: 'o' }, '/seller/[orgId]/orders/[orderId]', { orgId: 'g', orderId: 'o' }],
  ['delivery', 'orderId', { orderId: 'o' }, '/orders/[orderId]', { orderId: 'o' }],
  ['delivery', 'courierRequestId', { courierRequestId: 'x' }, '/courier/[id]', { id: 'x' }],
  ['commerce', 'listingId', { listingId: 'l' }, '/listings/[id]', { id: 'l' }],
  ['commerce', 'visitId', { visitId: 'v' }, '/listings/visits'],
  ['commerce', 'offerId', { offerId: 'v' }, '/listings/offers'],
  ['commerce', 'campaignId', { orgId: 'g', campaignId: 'c' }, '/loyalty'],
  ['commerce', 'questionId', { orgId: 'g', questionId: 'q' }, '/seller/[orgId]/questions', { orgId: 'g' }],
  ['booking', 'bookingId', { bookingId: 'b' }, '/bookings/[id]', { id: 'b' }],
  ['booking', 'appointmentId', { appointmentId: 'a' }, '/health/appointments'],
  ['system', 'rental bookingId', { bookingId: 'b' }, '/rentals/mine'],
  ['system', 'rental org', { bookingId: 'b', orgId: 'g' }, '/seller/[orgId]/rentals', { orgId: 'g' }],
  ['system', 'tripId', { tripId: 't', bookingId: 'b' }, '/carpool/[id]', { id: 't' }],
  ['system', 'roadsideId', { roadsideId: 'r' }, '/roadside'],
  ['payment', 'transferId', { transferId: 'x' }, '/wallet', { tx: 'x' }],
  ['payment', 'money_request', { kind: 'money_request', requestId: 'x' }, '/wallet/requests'],
  ['payment', 'split_bill', { kind: 'split_bill', billId: 'x' }, '/wallet/split'],
  ['payment', 'scheduled_payment', { kind: 'scheduled_payment', paymentId: 'x' }, '/wallet/scheduled'],
  ['payment', 'merchant_payment', { kind: 'merchant_payment', orgId: 'g', transferId: 'x' }, '/seller/[orgId]/wallet', { orgId: 'g' }],
  ['payment', 'miniapp payment', { kind: 'miniapp_payment_request', requestId: 'x', appId: 'a' }, '/miniapps/activity/[appId]', { appId: 'a' }],
  ['social', 'postId', { kind: 'comment', postId: 'p', actorId: 'u' }, '/post/[postId]', { postId: 'p' }],
  ['social', 'follow', { kind: 'follow', actorId: 'u' }, '/user/[userId]', { userId: 'u' }],
  ['social', 'boost_rejected', { kind: 'boost_rejected', postId: 'p' }, '/post/[postId]', { postId: 'p' }],
  ['security', 'sans données', {}, '/sessions'],
  ['security', 'wallet_alert', { kind: 'wallet_alert' }, '/wallet/alerts'],
  ['security', 'kyc', { kind: 'kyc', submissionId: 's' }, '/kyc'],
  ['security', 'ride_alert', { kind: 'ride_alert', fromUserId: 'u' }, '/rides'],
  ['system', 'driver_decision', { kind: 'driver_decision' }, '/rides/driver'],
  ['system', 'sanctionId', { sanctionId: 's' }, '/my-sanctions'],
  ['system', 'approvalId', { approvalId: 'a', kind: 'x' }, '/admin/approvals'],
  ['system', 'reportId', { reportId: 'r' }, '/my-reports'],
  ['system', 'announcementId', { announcementId: 'a' }, '/announcements'],
  ['system', 'courseId', { courseId: 'c' }, '/education/[id]', { id: 'c' }],
  ['system', 'shareId', { shareId: 's' }, '/health/sharing'],
  ['system', 'prescriptionId', { prescriptionId: 's' }, '/health/record'],
  ['system', 'resultId', { resultId: 's' }, '/health/results'],
  ['reminder', 'doseId', { doseId: 'd' }, '/health/reminders'],
  ['reminder', 'savings', { kind: 'savings_reminder' }, '/wallet/savings'],
  ['reminder', 'batches', { type: 'stock.batches_expired', orgId: 'g' }, '/seller/[orgId]/batches', { orgId: 'g' }],
  ['system', 'hr leave', { type: 'hr.leave_requested', orgId: 'g', leaveId: 'l' }, '/seller/[orgId]/hr/leave', { orgId: 'g' }],
  ['system', 'guardianshipId', { guardianshipId: 'g' }, '/school/children'],
  ['system', 'classId', { classId: 'c' }, '/school/[classId]', { classId: 'c' }],
  ['system', 'miniapp_status', { kind: 'miniapp_status', appId: 'a' }, '/miniapps/developer/[id]', { id: 'a' }],
  ['system', 'webhook org', { orgId: 'g', webhookId: 'w' }, '/seller/[orgId]/webhooks', { orgId: 'g' }],
  ['system', 'miniapp webhook', { kind: 'miniapp_webhook_disabled', appId: 'a', webhookId: 'w' }, '/miniapps/developer/webhook/[id]', { id: 'w' }],
  ['job', 'jobId', { jobId: 'j' }, '/jobs/[id]', { id: 'j' }],
  ['job', 'applicationId', { applicationId: 'a', jobId: 'j' }, '/jobs/applications'],
  ['job', 'interviewId', { interviewId: 'i' }, '/jobs/interviews'],
  ['job', 'missionId', { missionId: 'm' }, '/freelance/[id]', { id: 'm' }],
  ['job', 'contractId', { contractId: 'c' }, '/freelance/contract/[id]', { id: 'c' }],
];

describe('notificationTarget', () => {
  it.each(rows)('%s / %s', (category, _label, data, pathname, params) => {
    const r = t({ category, data });
    expect(r?.pathname).toBe(pathname);
    if (params) expect(r?.params).toEqual(params);
  });

  it('ne renvoie que des écrans qui existent (pas de /security nu, ni /miniapps/activity sans id)', () => {
    const extra: Record<string, string>[] = [
      { kind: 'miniapp_reconsent' }, { kind: 'miniapp_notify' }, { kind: 'miniapp_payment_request' }, { kind: 'miniapp_status' }, { kind: 'miniapp_webhook_disabled' },
    ];
    const known = new Set<string>(ROUTES);
    const all = [...rows.map((r) => ({ category: r[0], data: r[2] })), ...extra.map((data) => ({ category: 'system', data })), { category: 'security', data: {} }];
    for (const n of all) {
      const r = t(n);
      if (r) expect(known.has(r.pathname), r.pathname).toBe(true);
    }
    expect(t({ category: 'system', data: { kind: 'miniapp_reconsent' } })?.pathname).toBe('/miniapps');
  });

  it('retombe sur null (feuille de détail) sans cible', () => {
    expect(t({ category: 'system', data: {} })).toBeNull();
    expect(t({ category: 'job', data: {} })).toBeNull();
    expect(t({ category: 'commerce', data: { orgId: 'g', reviewId: 'r', productId: 'p' } })).toBeNull();
    expect(t({ category: 'system' })).toBeNull();
  });
});
