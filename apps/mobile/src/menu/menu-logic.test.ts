import { describe, expect, it } from 'vitest';
import { ROUTES } from '../lib/back-target';
import { activityEntries, DELETE_ACCOUNT_HREF, filterEntries, helpEntries, proEntries, securityEntries, settingsEntries, shortcutEntries, type MenuContext } from './menu-logic';
import { SERVICE_SECTIONS } from './services';

const FULL: MenuContext = {
  flags: Object.fromEntries(SERVICE_SECTIONS.flatMap((s) => s.entries).flatMap((x) => (x.flag ? [[x.flag, true]] : []))),
  orgs: [
    { role: 'owner', status: 'active', org: { id: 'o1' } },
    { role: 'delivery', status: 'active', org: { id: 'o2' } },
  ],
  isProvider: true,
  unread: 3,
  hasAdmin: true,
};
// Une route dynamique ([orgId], [scope]...) accepte n'importe quelle valeur ; la requête (?mode=...) est ignorée.
const matches = (href: string) => {
  const parts = href.split('?')[0]!.split('/').filter(Boolean);
  return ROUTES.some((r) => {
    const p = r.split('/').filter(Boolean);
    return p.length === parts.length && p.every((seg, i) => seg.startsWith('[') || seg === parts[i]);
  });
};
const all = [
  ...shortcutEntries(FULL.flags),
  ...proEntries(FULL),
  ...proEntries({ ...FULL, orgs: [], isProvider: false, hasAdmin: false }),
  ...activityEntries(FULL),
  ...settingsEntries(),
  ...securityEntries(),
  ...helpEntries(),
];

describe('menu « ⋯ »', () => {
  it('chaque entrée pointe vers une route qui existe', () => {
    expect(all.filter((x) => !matches(x.href)).map((x) => x.href)).toEqual([]);
    expect(matches(DELETE_ACCOUNT_HREF)).toBe(true);
  });
  it('la grille couvre tous les services demandés, sans doublon', () => {
    const ids = shortcutEntries(FULL.flags).map((x) => x.id);
    for (const p of ['/wallet', '/orders', '/bookings', '/rides/history', '/deliveries', '/wishlist', '/downloads', '/listings/mine', '/jobs', '/freelance', '/education', '/school', '/health', '/miniapps', '/ai', '/games', '/carpool', '/rentals', '/roadside', '/maps', '/videos', '/creator', '/loyalty', '/premium', '/ads']) expect(ids).toContain(p);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('santé et école masquées tant que leur module n’est pas actif', () => {
    const ids = shortcutEntries({}).map((x) => x.id);
    expect(ids).not.toContain('/health');
    expect(ids).not.toContain('/school');
  });
  it('administration réservée aux admins, livreur aux adhésions livraison', () => {
    const plain = proEntries({ ...FULL, hasAdmin: false, orgs: [] }).map((x) => x.id);
    expect(plain).not.toContain('admin');
    expect(plain).not.toContain('courier');
    expect(proEntries(FULL).map((x) => x.id)).toEqual(expect.arrayContaining(['admin', 'courier', 'team']));
  });
  it('le filtre ignore casse et accents', () => {
    expect(filterEntries(settingsEntries(), 'LANGUE', (k) => (k === 'account.language' ? 'Langue' : 'x')).map((x) => x.id)).toEqual(['language']);
    expect(filterEntries(settingsEntries(), 'verification', () => 'Vérification')).toHaveLength(settingsEntries().length);
  });
  it('aucun écran destiné à l’utilisateur n’est hors de portée du menu', () => {
    const hrefs = [...all.map((x) => x.href.split('?')[0]!), DELETE_ACCOUNT_HREF];
    // Écrans internes : atteints depuis un autre écran (flux), onglets, ou sans entrée propre.
    const EXEMPT = new Set(['/', '/ui-kit', '/setup-profile', '/more', '/search', '/checkout', '/compose', '/pay', '/live/preview', '/story/new', '/review/new', '/security/qr-approve', '/places/add', '/places/explore', '/games/play', '/ai/settings', '/premium/history', '/premium/pro', '/product/compare']);
    const orphans = ROUTES.filter((r) => !r.includes('[') && !EXEMPT.has(r) && !hrefs.some((h) => h === r || r.startsWith(`${h}/`)));
    expect(orphans).toEqual([]);
  });
});
