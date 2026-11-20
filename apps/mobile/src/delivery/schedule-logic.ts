import type { CartGroup, DeliveryZone } from '@caselind/contracts';
import { parseLocalDateTime } from '../jobs/logic';
import { expressSupplement } from './logic';

/* Livraison express et programmée : logique pure (le serveur reste la référence). */

const MIN_MS = 2 * 3_600_000;
const MAX_MS = 7 * 86_400_000;
/** Marge pour que le créneau reste valide le temps de l'envoi. */
const MARGIN_MS = 2 * 60_000;

export type SlotCheck = { ok: true; iso: string } | { ok: false; reason: 'invalid' | 'too_soon' | 'too_far' };

/** Créneau « AAAA-MM-JJ HH:MM » (heure locale) : entre 2 h et 7 jours à partir de maintenant. */
export function checkSlot(text: string, now: number = Date.now()): SlotCheck {
  const iso = parseLocalDateTime(text);
  if (!iso) return { ok: false, reason: 'invalid' };
  const t = new Date(iso).getTime();
  if (t < now + MIN_MS + MARGIN_MS) return { ok: false, reason: 'too_soon' };
  if (t > now + MAX_MS - MARGIN_MS) return { ok: false, reason: 'too_far' };
  return { ok: true, iso };
}

/** Express : chaque boutique doit avoir une zone choisie avec un supplément dans la devise de sa commande. */
export function expressOffered(
  groups: readonly CartGroup[],
  zonesByOrg: Readonly<Record<string, readonly DeliveryZone[] | undefined>>,
  chosen: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    groups.length > 0 &&
    groups.every((g) => {
      const z = zonesByOrg[g.orgId]?.find((x) => x.id === chosen[g.orgId]);
      return !!z && expressSupplement(z, g.currency) !== null;
    })
  );
}

/** Date et heure locales lisibles d'un créneau ISO. */
export function formatSlot(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
