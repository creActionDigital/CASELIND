import type { PosTicket } from '@caselind/contracts';
import { formatMinor, parseDecimalToMinor } from '../seller/money';

/** Montant de caisse saisi (« 0 », « 25 », « 12,50 ») -> unités mineures ; zéro permis (fond vide), null si invalide. */
export function parseCashMinor(input: string, currency: string): number | null {
  return /^\s*0+([.,]0*)?\s*$/.test(input) ? 0 : parseDecimalToMinor(input, currency);
}

export interface TicketLabels {
  total: string;
  /** « Mode de paiement ». */
  mode: string;
  /** Nom du mode déjà traduit (« Espèces »). */
  modeName: string;
  voided: string;
}

/** Ticket en texte brut (en-tête de la boutique, lignes, total, mode, date) pour l'API Share. */
export function ticketText(t: PosTicket, labels: TicketLabels, locale: string): string {
  const { sale, shop } = t;
  const out: string[] = [shop.name];
  if (shop.address) out.push(shop.address);
  if (shop.phone) out.push(shop.phone);
  out.push('', new Date(sale.createdAt).toLocaleString(locale));
  for (const l of sale.lines) {
    out.push(`${l.title}${l.variantLabel ? ` (${l.variantLabel})` : ''}`, `  ${l.quantity} x ${formatMinor(l.unitPriceMinor, sale.currency, locale)} = ${formatMinor(l.quantity * l.unitPriceMinor, sale.currency, locale)}`);
  }
  out.push('', `${labels.total} : ${formatMinor(sale.totalMinor, sale.currency, locale)}`, `${labels.mode} : ${labels.modeName}`);
  if (sale.voidedAt) out.push(labels.voided);
  return out.join('\n');
}
