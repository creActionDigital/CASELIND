import { EXPENSE_CATEGORIES, type CreateExpenseRequest, type CreateSupplierRequest, type ExpenseCategory, type PurchaseOrder, type PurchaseOrderLineInput, type PurchaseOrderStatus } from '@caselind/contracts';
import { minorDigits } from '../seller/money';

/** Logique pure de la gestion d'entreprise (achats, dépenses, rentabilité) : validation, calculs d'affichage, périodes. */

const MAX_MINOR = 1_000_000_000_000;
const MAX_QTY = 1_000_000;

/** « 12,50 » -> 1250 ; contrairement à `parseDecimalToMinor`, zéro est accepté (coût nul). null si invalide. */
export function parseCostToMinor(input: string, currency: string): number | null {
  const s = input.trim().replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const digits = minorDigits(currency);
  const frac = m[2] ?? '';
  if (frac.length > digits) return null;
  const minor = Number(m[1] + frac.padEnd(digits, '0'));
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= MAX_MINOR ? minor : null;
}

/** Entier strictement positif (quantité) ; null sinon. */
export function parseQuantity(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_QTY ? n : null;
}

export interface LineForm {
  variantId: string;
  /** Libellé de l'article choisi, ou description libre. */
  description: string;
  quantity: string;
  unitCost: string;
}
export const emptyLineForm = (): LineForm => ({ variantId: '', description: '', quantity: '', unitCost: '' });

export type LineError = 'description' | 'quantity' | 'unitCost';

/** Ligne de bon de commande saisie → requête ; l'erreur nomme le champ à corriger. */
export function buildPoLine(f: LineForm, currency: string): { ok: PurchaseOrderLineInput } | { error: LineError } {
  const description = f.description.trim();
  if (!f.variantId && (description.length < 1 || description.length > 120)) return { error: 'description' };
  const quantity = parseQuantity(f.quantity);
  if (quantity === null) return { error: 'quantity' };
  const unitCostMinor = parseCostToMinor(f.unitCost, currency);
  if (unitCostMinor === null) return { error: 'unitCost' };
  return { ok: { ...(f.variantId ? { variantId: f.variantId } : {}), ...(description ? { description: description.slice(0, 120) } : {}), quantity, unitCostMinor } };
}

/** Total d'un brouillon, affiché avant l'envoi (le serveur le recalcule toujours). */
export const poTotal = (lines: readonly { quantity: number; unitCostMinor: number }[]): number => lines.reduce((s, l) => s + l.quantity * l.unitCostMinor, 0);

export const remainingQty = (l: { quantityOrdered: number; quantityReceived: number }): number => Math.max(0, l.quantityOrdered - l.quantityReceived);

export const canSendPo = (s: PurchaseOrderStatus): boolean => s === 'draft';
export const canReceivePo = (s: PurchaseOrderStatus): boolean => s === 'ordered' || s === 'partially_received';
export const canCancelPo = (s: PurchaseOrderStatus): boolean => s === 'draft' || s === 'ordered' || s === 'partially_received';

export const PO_TONE: Record<PurchaseOrderStatus, 'primary' | 'accent' | 'neutral'> = {
  draft: 'neutral',
  ordered: 'primary',
  partially_received: 'accent',
  received: 'neutral',
  cancelled: 'neutral',
};

/** Quantités saisies par ligne → corps de réception ; les lignes vides ou à 0 sont ignorées. Erreur : saisie invalide, dépassement du reste, rien à recevoir. */
export function buildReceipt(
  po: Pick<PurchaseOrder, 'lines'>,
  input: Record<string, string>,
): { ok: { lines: { lineId: string; quantity: number }[] } } | { error: 'empty' | 'quantity' | 'exceeds' } {
  const lines: { lineId: string; quantity: number }[] = [];
  for (const l of po.lines) {
    const raw = (input[l.id] ?? '').trim();
    if (raw === '' || raw === '0') continue;
    const quantity = parseQuantity(raw);
    if (quantity === null) return { error: 'quantity' };
    if (quantity > remainingQty(l)) return { error: 'exceeds' };
    lines.push({ lineId: l.id, quantity });
  }
  return lines.length === 0 ? { error: 'empty' } : { ok: { lines } };
}

/** Valeurs de départ de la saisie de réception : tout le reste attendu. */
export const receiptDefaults = (po: Pick<PurchaseOrder, 'lines'>): Record<string, string> =>
  Object.fromEntries(po.lines.filter((l) => remainingQty(l) > 0).map((l) => [l.id, String(remainingQty(l))]));

// ---- dépenses --------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
/** Date de l'appareil au format AAAA-MM-JJ. */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export interface ExpenseForm {
  category: ExpenseCategory;
  amount: string;
  currency: 'USD' | 'CDF';
  spentOn: string;
  note: string;
}
export const emptyExpenseForm = (today = isoDate(new Date())): ExpenseForm => ({ category: 'other', amount: '', currency: 'USD', spentOn: today, note: '' });

export type ExpenseError = 'amount' | 'date' | 'note';

export function buildExpense(f: ExpenseForm): { ok: CreateExpenseRequest } | { error: ExpenseError } {
  const amountMinor = parseCostToMinor(f.amount, f.currency);
  if (amountMinor === null || amountMinor < 1) return { error: 'amount' };
  if (!isValidDate(f.spentOn.trim())) return { error: 'date' };
  const note = f.note.trim();
  if (note.length > 200) return { error: 'note' };
  return { ok: { category: f.category, amountMinor, currency: f.currency, spentOn: f.spentOn.trim(), ...(note ? { note } : {}) } };
}

export { EXPENSE_CATEGORIES };

// ---- périodes et rentabilité -----------------------------------------------------------------

export const PERIOD_PRESETS = ['month', 'd30', 'd90', 'year'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** Période incluse [from, to] : mois en cours, 30 ou 90 derniers jours, année en cours (au plus 366 jours). */
export function periodFor(preset: PeriodPreset, today: Date): { from: string; to: string } {
  const to = isoDate(today);
  const back = (days: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1));
  switch (preset) {
    case 'month':
      return { from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, to };
    case 'd30':
      return { from: back(30), to };
    case 'd90':
      return { from: back(90), to };
    case 'year':
      return { from: `${today.getFullYear()}-01-01`, to };
  }
}

/** Largeur (0-100) de chaque barre, proportionnelle au plus grand montant ; un montant non nul garde au moins 2 %. */
export function barWidths(amounts: readonly number[]): number[] {
  const max = Math.max(0, ...amounts);
  if (max <= 0) return amounts.map(() => 0);
  return amounts.map((a) => (a <= 0 ? 0 : Math.max(2, Math.round((a / max) * 100))));
}

/** Marge brute en % du chiffre d'affaires, une décimale ; null sans chiffre d'affaires. Peut être négative. */
export function marginPercent(marginMinor: number, revenueMinor: number): number | null {
  if (revenueMinor <= 0) return null;
  return Math.round((marginMinor * 1000) / revenueMinor) / 10;
}

/** Nom de fichier proposé pour un export. */
export const exportFileName = (kind: 'sales' | 'expenses' | 'purchases', from: string, to: string): string => `${kind}-${from}-${to}.csv`;

// ---- fournisseurs ----------------------------------------------------------------------------

export interface SupplierForm {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}
export const emptySupplierForm = (): SupplierForm => ({ name: '', contactName: '', phone: '', email: '', address: '', notes: '' });

export type SupplierError = 'name' | 'phone' | 'email';

/** Formulaire fournisseur → requête ; les champs vides sont omis. */
export function buildSupplier(f: SupplierForm): { ok: CreateSupplierRequest } | { error: SupplierError } {
  const name = f.name.trim();
  if (name.length < 1 || name.length > 120) return { error: 'name' };
  const phone = f.phone.trim().replace(/[\s.-]/g, '');
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) return { error: 'phone' };
  const email = f.email.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'email' };
  const opt = (v: string, max: number) => {
    const s = v.trim().slice(0, max);
    return s ? s : undefined;
  };
  const contactName = opt(f.contactName, 120);
  const address = opt(f.address, 300);
  const notes = opt(f.notes, 500);
  return {
    ok: { name, ...(contactName ? { contactName } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}), ...(address ? { address } : {}), ...(notes ? { notes } : {}) },
  };
}
