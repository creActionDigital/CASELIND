import type { MessageKey } from '../i18n';
import { SERVICE_SECTIONS, serviceVisible, type Icon } from './services';

/** Une entrée du menu « ⋯ » : `href` est l'adresse réellement ouverte (valeurs dynamiques remplies), vérifiée contre ROUTES. */
export interface MenuEntry {
  id: string;
  href: string;
  label: MessageKey;
  icon: Icon;
  /** Orange de marque (Premium, publicité, assistant). */
  accent?: boolean;
  badge?: number;
}

export interface MenuContext {
  flags?: Record<string, boolean>;
  roles?: readonly string[] | null;
  orgs?: readonly { role: string; status: string; org: { id: string } }[];
  isProvider: boolean;
  unread: number;
  hasAdmin: boolean;
}

const e = (id: string, href: string, label: MessageKey, icon: Icon, accent?: boolean): MenuEntry => ({ id, href, label, icon, accent });

// Services que « Plus » ne propose pas (ou autrement) mais que le menu doit offrir d'un geste.
const EXTRA_SHORTCUTS: MenuEntry[] = [
  e('/wallet', '/wallet', 'wallet.title', 'wallet-outline'),
  e('/orders', '/orders', 'orders.title', 'receipt-outline'),
  e('/bookings', '/bookings', 'bookings.title', 'calendar-outline'),
  e('/rides/history', '/rides/history', 'mobility.history.title', 'time-outline'),
  e('/deliveries', '/deliveries', 'delivery.mine.title', 'bicycle-outline'),
  e('/maps', '/maps', 'menu.maps', 'map-outline'),
  e('/videos', '/videos', 'mb.videos.title', 'play-circle-outline'),
  e('/loyalty', '/loyalty', 'menu.loyalty', 'gift-outline'),
  e('/bookmarks', '/bookmarks', 'creator.tile.bookmarks', 'bookmark-outline'),
  e('/hub', '/hub', 'tabs.hub', 'planet-outline'),
  e('/messages', '/messages', 'tabs.messages', 'chatbubble-ellipses-outline'),
  e('/calls', '/calls', 'md.calls.title', 'call-outline'),
  e('/discover', '/discover', 'ma.discover.title', 'compass-outline'),
  e('/deals', '/deals', 'mc.deals.title', 'pricetag-outline'),
  e('/categories', '/categories', 'mc.cat.title', 'grid-outline'),
  e('/cart', '/cart', 'cart.title', 'bag-handle-outline'),
  e('/claims', '/claims', 'mc.claims.title', 'alert-circle-outline'),
  e('/transport', '/transport', 'mb.transport.title', 'bus-outline'),
  e('/scan', '/scan', 'scan.title', 'scan-outline'),
];
const LISTINGS_MINE = e('/listings/mine', '/listings/mine', 'listings.mine', 'pricetags-outline');
// Présents ailleurs dans le menu (Activité, Aide) : pas de doublon dans la grille.
const ELSEWHERE = new Set(['/help', '/my-sanctions']);

/** Grille « Vos raccourcis » : la liste de l'onglet Plus (mêmes drapeaux) + les services de compte, sans doublon. */
export function shortcutEntries(flags: Record<string, boolean> | undefined): MenuEntry[] {
  const seen = new Set<string>();
  const out: MenuEntry[] = [];
  const add = (x: MenuEntry) => {
    if (!seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
  };
  EXTRA_SHORTCUTS.slice(0, 5).forEach(add);
  for (const s of SERVICE_SECTIONS)
    for (const x of s.entries) if (!ELSEWHERE.has(x.path) && serviceVisible(x, flags)) add(e(x.path, x.path, x.label, x.icon, x.accent || x.path === '/premium' || x.path === '/ads'));
  if (flags?.listings !== false) add(LISTINGS_MINE);
  EXTRA_SHORTCUTS.slice(5).forEach(add);
  return out;
}

export function proEntries(c: MenuContext): MenuEntry[] {
  const active = c.orgs?.find((m) => m.status === 'active');
  const hasOrgs = !!c.orgs && c.orgs.length > 0;
  const out: MenuEntry[] = [
    e('shop', hasOrgs ? '/seller' : '/seller/new', active ? 'seller.title' : hasOrgs ? 'seller.invitations' : 'seller.createShop', 'storefront-outline'),
  ];
  if (active) out.push(e('team', `/seller/${active.org.id}/team`, 'menu.business', 'business-outline'));
  out.push(e('provider', '/provider/me', c.isProvider ? 'services.pro.mine' : 'services.pro.become', 'construct-outline'));
  out.push(e('driver', '/rides/driver', 'mobility.driver.title', 'car-sport-outline'));
  if (c.orgs?.some((m) => m.status === 'active' && m.role === 'delivery')) out.push(e('courier', '/deliveries', 'menu.courierSpace', 'bicycle-outline'));
  out.push(e('dev', '/miniapps/developer', 'miniapps.dev.open', 'code-slash-outline'));
  out.push(e('creator', '/creator', 'creator.tile.dashboard', 'bar-chart-outline'));
  out.push({ ...e('ads', '/ads', 'mon.ads.title', 'megaphone-outline'), accent: true });
  if (c.hasAdmin) out.push(e('admin', '/admin', 'adm.hub.title', 'shield-checkmark-outline'));
  return out;
}

export function activityEntries(c: MenuContext): MenuEntry[] {
  return [
    { ...e('notifs', '/notifications', 'account.notifications', 'notifications-outline'), badge: c.unread },
    e('reports', '/my-reports', 'report.mine.title', 'flag-outline'),
    e('favs', '/favorites', 'messagesX.fav.title', 'star-outline'),
    e('storiesArchive', '/stories-archive', 'sarch.title', 'images-outline'),
    e('scheduled', '/scheduled', 'messagesX.scheduled.menu', 'time-outline'),
    e('sanctions', '/my-sanctions', 'ops2.mine.title', 'shield-half-outline'),
    e('videoHistory', '/videos', 'menu.videoHistory', 'film-outline'),
  ];
}

export const settingsEntries = (): MenuEntry[] => [
  e('profile', '/profile', 'account.profile', 'person-outline'),
  e('language', '/language', 'account.language', 'language-outline'),
  e('appearance', '/appearance', 'ma.appearance.title', 'contrast-outline'),
  e('notifPrefs', '/notification-preferences', 'account.notificationPreferences', 'options-outline'),
  e('privacy', '/privacy', 'account.privacy', 'shield-checkmark-outline'),
  e('blocked', '/blocked', 'blocks.title', 'ban-outline'),
  e('permissions', '/permissions', 'ma.perm.title', 'hand-left-outline'),
  e('mydata', '/my-data', 'mydata.title', 'download-outline'),
  e('consents', '/consents', 'consents.title', 'document-text-outline'),
];

export const securityEntries = (): MenuEntry[] => [
  e('sessions', '/sessions', 'account.sessions', 'phone-portrait-outline'),
  e('2fa', '/security/2fa', 'security.2fa.title', 'lock-closed-outline'),
  e('identifier', '/security/identifier', 'security.identifier.title', 'swap-horizontal-outline'),
  e('payPin', '/wallet/pin', 'account.paymentSecurity', 'keypad-outline'),
  e('kyc', '/kyc', 'kyc.title', 'id-card-outline'),
  e('bio', '/security/biometrics', 'ma.bio.title', 'finger-print-outline'),
];

export const helpEntries = (): MenuEntry[] => [
  e('helpCenter', '/help', 'ma.help.title', 'help-circle-outline'),
  e('support', '/support', 'ma.support.title', 'chatbubbles-outline'),
  e('problem', '/support?mode=problem', 'ma.support.problemTitle', 'bug-outline'),
  e('requests', '/help-requests', 'md.help.title', 'mail-open-outline'),
  e('about', '/about', 'ma.about.title', 'information-circle-outline'),
];

/** Route de suppression de compte (le formulaire et sa confirmation sont dans « Mes données »). */
export const DELETE_ACCOUNT_HREF = '/my-data';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Filtre en direct : insensible à la casse et aux accents ; requête vide = tout. */
export function filterEntries(list: MenuEntry[], query: string, label: (k: MessageKey) => string): MenuEntry[] {
  const q = fold(query);
  return q ? list.filter((x) => fold(label(x.label)).includes(q)) : list;
}
