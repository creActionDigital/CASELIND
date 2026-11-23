/**
 * Retour de secours quand un écran n'a pas d'historique (ouvert depuis un lien, une notification push ou un rechargement
 * sur le web) : on remonte au plus proche écran parent qui existe, sinon à l'accueil. Comme les grandes applis, le
 * bouton retour mène toujours quelque part de logique.
 * `ROUTES` = écrans de src/app/(app) en forme d'URL ; back-target.test.ts vérifie qu'elle suit les fichiers.
 */
export const ROUTES = [
  '/about', '/blocked', '/stories-archive', '/ui-kit', '/appearance', '/discover', '/help', '/permissions', '/setup-profile', '/support', '/security/biometrics',
  '/', '/admin', '/admin/ai', '/admin/ads', '/admin/analytics', '/admin/announcements', '/admin/appeals', '/admin/approvals', '/admin/audit', '/admin/boosts',
  '/admin/commissions', '/admin/disputes', '/admin/flags', '/admin/games', '/admin/governance', '/admin/help', '/admin/health', '/admin/kyc', '/admin/ledger',
  '/admin/miniapp-versions', '/admin/miniapps', '/admin/mobility', '/admin/moderation', '/admin/sanctions', '/admin/settings', '/admin/subscriptions', '/admin/wallet-alerts',
  '/ai', '/ai/[id]', '/ai/settings', '/ads', '/ads/[id]', '/ads/billing', '/ads/new', '/announcements', '/bookings', '/bookings/[id]', '/bookmarks', '/calls', '/calls/[id]', '/help-requests', '/carpool', '/carpool/[id]',
  '/carpool/mine', '/carpool/new', '/cart', '/categories', '/categories/[categoryId]', '/claims', '/deals', '/chat-info/[conversationId]', '/checkout', '/compose', '/consents', '/courier', '/courier/[id]',
  '/courier/available', '/courier/route', '/creator', '/deliveries', '/deliveries/[deliveryId]', '/downloads', '/education', '/education/[id]',
  '/education/edit/[id]', '/education/exam/[id]', '/education/mine', '/education/new', '/education/quiz/[id]', '/education/verify', '/favorites',
  '/freelance', '/freelance/[id]', '/freelance/contract/[id]', '/freelance/disputes', '/freelance/freelancers', '/freelance/mine', '/freelance/new',
  '/freelance/profile', '/games', '/games/play', '/group/[conversationId]', '/hashtag/[tag]', '/health', '/health/appointments', '/health/availability',
  '/health/book', '/health/patient/[id]', '/health/pro', '/health/professionals', '/health/record', '/health/reminders', '/health/results',
  '/health/sharing', '/hub', '/jobs', '/jobs/[id]', '/jobs/alerts', '/jobs/applications', '/jobs/cv', '/jobs/interviews', '/kyc', '/language',
  '/listings', '/listings/[id]', '/listings/alerts', '/listings/compare', '/listings/mine', '/listings/new', '/listings/offers', '/listings/visits',
  '/live/preview', '/lives/[id]', '/loyalty', '/maps', '/messages', '/messages/[conversationId]', '/messages/pins', '/miniapps', '/miniapps/activity/[appId]',
  '/miniapps/consent', '/miniapps/developer', '/miniapps/developer/[id]', '/miniapps/developer/manifest/[id]', '/miniapps/developer/new',
  '/miniapps/developer/revenue/[id]', '/miniapps/developer/webhook/[id]', '/more', '/my-data', '/my-reports', '/my-sanctions',
  '/notification-preferences', '/notifications', '/orders', '/orders/[orderId]', '/pay', '/post/[postId]', '/premium', '/premium/history', '/premium/pro', '/privacy', '/product/[productId]',
  '/product/compare', '/profile', '/provider/[scope]', '/provider/[scope]/availability', '/provider/[scope]/offer/[id]', '/provider/[scope]/requests',
  '/provider/[scope]/reviews', '/rentals', '/rentals/[id]', '/rentals/mine', '/review/new', '/rides', '/rides/[rideId]', '/rides/contacts',
  '/rides/driver', '/rides/history', '/rides/places', '/rides/shared/[token]', '/roadside', '/roadside/available', '/scan', '/scheduled', '/school', '/school/[classId]',
  '/school/children', '/school/fees', '/school/scholarships', '/school/scholarships/[id]', '/school/search', '/search', '/security/2fa',
  '/security/identifier', '/security/qr-approve', '/seller', '/seller/[orgId]', '/seller/[orgId]/batches', '/seller/[orgId]/campaigns',
  '/seller/[orgId]/commissions', '/seller/[orgId]/coupons', '/seller/[orgId]/coupons/new', '/seller/[orgId]/customers', '/seller/[orgId]/documents',
  '/seller/[orgId]/documents/[id]', '/seller/[orgId]/documents/new', '/seller/[orgId]/expenses', '/seller/[orgId]/hr', '/seller/[orgId]/hr/leave',
  '/seller/[orgId]/hr/salary', '/seller/[orgId]/hr/schedule', '/seller/[orgId]/inventory', '/seller/[orgId]/jobs', '/seller/[orgId]/jobs/[jobId]',
  '/seller/[orgId]/jobs/new', '/seller/[orgId]/location', '/seller/[orgId]/loyalty', '/seller/[orgId]/orders', '/seller/[orgId]/orders/[orderId]',
  '/seller/[orgId]/pos', '/seller/[orgId]/product-files', '/seller/[orgId]/products', '/seller/[orgId]/products/[productId]',
  '/seller/[orgId]/profitability', '/seller/[orgId]/promotions', '/seller/[orgId]/purchasing', '/seller/[orgId]/purchasing/[poId]',
  '/seller/[orgId]/purchasing/new', '/seller/[orgId]/qr', '/seller/[orgId]/questions', '/seller/[orgId]/rentals', '/seller/[orgId]/returns',
  '/seller/[orgId]/reviews', '/seller/[orgId]/sales', '/seller/[orgId]/team', '/seller/[orgId]/school', '/seller/[orgId]/school/[classId]',
  '/seller/[orgId]/school/fees/[classId]', '/seller/[orgId]/school/guardians', '/seller/[orgId]/school/scholarships', '/seller/[orgId]/services',
  '/seller/[orgId]/stock', '/seller/[orgId]/updates', '/seller/[orgId]/vitrine', '/seller/[orgId]/wallet', '/seller/[orgId]/webhooks',
  '/seller/[orgId]/deliveries', '/seller/[orgId]/zones', '/seller/[orgId]/zones/[zoneId]', '/seller/new', '/services', '/services/[id]', '/sessions', '/shop', '/store/[slug]',
  '/story/[userId]', '/story/new', '/u/[handle]', '/user/[userId]', '/user/[userId]/followers', '/user/[userId]/following', '/wallet', '/wallet/alerts',
  '/wallet/cards', '/wallet/convert', '/wallet/limits', '/wallet/qr', '/wallet/receipts', '/wallet/finance', '/wallet/manage', '/wallet/pin', '/wallet/receive', '/wallet/requests', '/wallet/savings', '/wallet/scheduled',
  '/wallet/send', '/wallet/split', '/wallet/topup', '/wishlist', '/work',
  '/place/[slug]', '/places/add', '/places/explore', '/transport', '/videos',
] as const;

const PATTERNS = ROUTES.map((r) => r.split('/').filter(Boolean));
const KNOWN = new Set<string>(ROUTES);
const fits = (p: string[], segs: string[]) => p.length === segs.length && p.every((s, i) => s.startsWith('[') || s === segs[i]);
const statics = (p: string[]) => p.filter((s) => !s.startsWith('[')).length;

/** Écran parent existant le plus proche de `pathname` (sans la requête), sinon l'accueil. */
export function parentRoute(pathname: string): string {
  const segs = pathname.split('?')[0]!.split('/').filter(Boolean);
  // Modèle de l'écran courant (le plus de segments fixes : « school/fees/[classId] » plutôt que « school/[classId] »),
  // puis ses préfixes qui sont eux-mêmes des écrans : on garde les vraies valeurs des segments.
  const own = PATTERNS.filter((p) => fits(p, segs)).sort((x, y) => statics(y) - statics(x))[0];
  for (let k = segs.length - 1; k > 0; k--) {
    const ok = own ? KNOWN.has('/' + own.slice(0, k).join('/')) : PATTERNS.some((p) => fits(p, segs.slice(0, k)));
    if (ok) return '/' + segs.slice(0, k).join('/');
  }
  return '/';
}

/** Bouton retour « maison » (écrans plein écran) : revient en arrière s'il y a un historique, sinon va à `fallback`. */
export function safeBack(router: { canGoBack(): boolean; back(): void; replace(href: never): void }, fallback = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}
