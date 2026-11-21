import { deliveryTarget } from '../delivery/routing';
import { rideTarget } from '../mobility/routing';
import { sellerTarget } from '../seller/routing';
import { bookingTarget } from '../services/logic';
import { commerceTarget } from '../shop/order-logic';
import { socialTarget } from '../social/routing';
import { walletTarget } from '../wallet/routing';

export type NotifTarget = { pathname: string; params?: Record<string, string> };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Écran à ouvrir pour une notification (liste ou push). Fonction pure : `null` si rien ne correspond,
 * l'appelant affiche alors la feuille de détail. Vérifié contre les envois de apps/api (clés de `data`).
 */
export function notificationTarget(n: { category: string; data?: unknown }): NotifTarget | null {
  const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  const id = (k: string) => str(d[k]);
  const to = (pathname: string, params?: Record<string, string>): NotifTarget => (params ? { pathname, params } : { pathname });
  const orgId = id('orgId');
  const kind = id('kind') ?? id('type');

  const conversationId = id('conversationId');
  if (conversationId) return to('/messages/[conversationId]', { conversationId });
  const ride = rideTarget(d);
  if (ride) return ride;

  // Types explicites (`data.kind` / `data.type`).
  const appId = id('appId');
  const webhookId = id('webhookId');
  switch (kind) {
    case 'money_request': return to('/wallet/requests');
    case 'split_bill': return to('/wallet/split');
    case 'scheduled_payment': return to('/wallet/scheduled');
    case 'wallet_alert': return to('/wallet/alerts');
    case 'savings_reminder': return to('/wallet/savings');
    case 'kyc': return to('/kyc');
    case 'driver_decision': return to('/rides/driver');
    case 'ride_alert': return to('/rides');
    case 'miniapp_status': return appId ? to('/miniapps/developer/[id]', { id: appId }) : to('/miniapps');
    case 'miniapp_webhook_disabled': return webhookId ? to('/miniapps/developer/webhook/[id]', { id: webhookId }) : to('/miniapps');
    case 'miniapp_reconsent':
    case 'miniapp_payment_request':
    case 'miniapp_notify':
      return appId ? to('/miniapps/activity/[appId]', { appId }) : to('/miniapps');
    case 'merchant_payment': return walletTarget(d);
    case 'hr.leave_requested':
    case 'hr.leave_decided':
      if (orgId) return to('/seller/[orgId]/hr/leave', { orgId });
      break;
  }
  if (kind?.startsWith('stock.batches') && orgId) return to('/seller/[orgId]/batches', { orgId });

  // Clés d'identifiants (indépendantes de la catégorie).
  const seller = sellerTarget(d);
  if (seller) return seller;
  const delivery = deliveryTarget(d);
  if (delivery) return delivery;
  const order = commerceTarget(d);
  if (order) return order;
  const courierRequestId = id('courierRequestId');
  if (courierRequestId) return to('/courier/[id]', { id: courierRequestId });
  if (id('approvalId')) return to('/admin/approvals');
  if (id('sanctionId')) return to('/my-sanctions');
  if (id('reportId')) return to('/my-reports');
  if (id('announcementId')) return to('/announcements');
  if (id('appointmentId')) return to('/health/appointments');
  if (id('shareId')) return to('/health/sharing');
  if (id('prescriptionId')) return to('/health/record');
  if (id('resultId')) return to('/health/results');
  if (id('doseId')) return to('/health/reminders');
  if (id('interviewId')) return to('/jobs/interviews');
  if (id('applicationId')) return to('/jobs/applications');
  const jobId = id('jobId');
  if (jobId) return to('/jobs/[id]', { id: jobId });
  const contractId = id('contractId');
  if (contractId) return to('/freelance/contract/[id]', { id: contractId });
  const missionId = id('missionId');
  if (missionId) return to('/freelance/[id]', { id: missionId });
  if (id('visitId')) return to('/listings/visits');
  if (id('offerId')) return to('/listings/offers');
  const listingId = id('listingId');
  if (listingId) return to('/listings/[id]', { id: listingId });
  const courseId = id('courseId');
  if (courseId) return to('/education/[id]', { id: courseId });
  if (id('guardianshipId')) return to('/school/children');
  const classId = id('classId');
  if (classId) return to('/school/[classId]', { classId });
  const tripId = id('tripId');
  if (tripId) return to('/carpool/[id]', { id: tripId });
  if (id('roadsideId')) return to('/roadside');
  if (id('campaignId')) return to('/loyalty');
  if (orgId && id('questionId')) return to('/seller/[orgId]/questions', { orgId });
  if (orgId && webhookId) return to('/seller/[orgId]/webhooks', { orgId });
  if (id('bookingId')) {
    if (orgId) return to('/seller/[orgId]/rentals', { orgId });
    if (n.category === 'booking') return bookingTarget(d);
    return to('/rentals/mine'); // `system` + bookingId sans tripId : location de véhicule
  }
  if (id('transferId') || n.category === 'payment') return walletTarget(d);
  if (n.category === 'social' || id('postId') || id('actorId')) {
    const social = socialTarget(d);
    if (social) return social;
  }
  if (n.category === 'security') return to('/sessions');
  return null;
}
