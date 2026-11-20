import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Gestion d'entreprise, première partie (CDC §8) : fournisseurs, bons de commande d'achat, dépenses, rentabilité, exports.
 * Miroir des migrations 0082 et 0083. Ce sont des enregistrements de gestion : aucun argent ne transite.
 * Les montants sont des entiers en unité mineure ; les totaux sont toujours recalculés par le serveur.
 */

export const SUPPLIERS_PER_ORG_MAX = 500;
export const PURCHASE_ORDER_LINES_MAX = 100;
export const EXPENSES_PAGE_MAX = 1000;
export const REPORT_MAX_DAYS = 366;
export const EXPORT_MAX_ROWS = 10_000;

export const businessCurrencySchema = z.enum(['USD', 'CDF']);
export type BusinessCurrency = z.infer<typeof businessCurrencySchema>;

const MS_DAY = 86_400_000;
/** Date civile AAAA-MM-JJ valide (le 31 février est refusé). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, 'invalid calendar date');

const minorSchema = z.number().int().min(0).max(1_000_000_000_000);
const phoneE164 = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'phone must be in E.164 format (e.g. +243812345678)');
const optText = (max: number) => z.string().trim().max(max).nullish();

// ---- fournisseurs -------------------------------------------------------------------------

export const supplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const createSupplierRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: optText(120),
  phone: phoneE164.nullish(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullish(),
  address: optText(300),
  notes: optText(500),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

/** `null` efface un champ facultatif ; `active: false` désactive le fournisseur (plus de nouveau bon de commande). */
export const updateSupplierRequestSchema = createSupplierRequestSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const supplierListQuerySchema = pageQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export const supplierListSchema = z.object({ items: z.array(supplierSchema), nextCursor: z.string().nullable() });
export type SupplierList = z.infer<typeof supplierListSchema>;

/** DELETE : supprimé, ou désactivé quand des achats ou des dépenses y font référence. */
export const deleteSupplierResponseSchema = z.object({ outcome: z.enum(['deleted', 'deactivated']) });
export type DeleteSupplierResponse = z.infer<typeof deleteSupplierResponseSchema>;

// ---- bons de commande d'achat -------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'] as const;
export const purchaseOrderStatusSchema = z.enum(PURCHASE_ORDER_STATUSES);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

/** Une ligne vise un article du catalogue (`variantId`) ou porte une description libre. */
export const purchaseOrderLineInputSchema = z
  .object({
    variantId: z.uuid().nullish(),
    description: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitCostMinor: minorSchema,
  })
  .refine((l) => !!l.variantId || !!l.description, { message: 'a catalogue variant or a description is required', path: ['description'] });
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

export const createPurchaseOrderRequestSchema = z.object({
  supplierId: z.uuid(),
  currency: businessCurrencySchema,
  expectedOn: isoDateSchema.nullish(),
  note: optText(500),
  lines: z.array(purchaseOrderLineInputSchema).min(1).max(PURCHASE_ORDER_LINES_MAX),
});
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;

/** Brouillon seulement. `lines`, si présent, remplace toutes les lignes. */
export const updatePurchaseOrderRequestSchema = createPurchaseOrderRequestSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderRequestSchema>;

export const receivePurchaseOrderRequestSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: z.uuid(), quantity: z.number().int().min(1).max(1_000_000) }))
      .min(1)
      .max(PURCHASE_ORDER_LINES_MAX),
  })
  .refine((b) => new Set(b.lines.map((l) => l.lineId.toLowerCase())).size === b.lines.length, { message: 'duplicate line', path: ['lines'] });
export type ReceivePurchaseOrderRequest = z.infer<typeof receivePurchaseOrderRequestSchema>;

export const purchaseOrderLineSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid().nullable(),
  description: z.string(),
  quantityOrdered: z.number().int(),
  quantityReceived: z.number().int(),
  unitCostMinor: z.number().int(),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  /** `PO-0001`, séquentiel par organisation. */
  number: z.string(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  status: purchaseOrderStatusSchema,
  currency: businessCurrencySchema,
  expectedOn: z.string().nullable(),
  note: z.string().nullable(),
  totalMinor: z.number().int(),
  lines: z.array(purchaseOrderLineSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderListQuerySchema = pageQuerySchema.extend({
  status: purchaseOrderStatusSchema.optional(),
  supplierId: z.uuid().optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;
export const purchaseOrderListSchema = z.object({ items: z.array(purchaseOrderSchema), nextCursor: z.string().nullable() });
export type PurchaseOrderList = z.infer<typeof purchaseOrderListSchema>;

// ---- dépenses -----------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = ['rent', 'salaries', 'transport', 'utilities', 'marketing', 'supplies', 'taxes', 'other'] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const createExpenseRequestSchema = z.object({
  category: expenseCategorySchema,
  amountMinor: minorSchema.min(1),
  currency: businessCurrencySchema,
  spentOn: isoDateSchema,
  supplierId: z.uuid().nullish(),
  note: optText(200),
});
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

export const updateExpenseRequestSchema = createExpenseRequestSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'at least one field');
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequestSchema>;

export const expenseSchema = z.object({
  id: z.uuid(),
  category: expenseCategorySchema,
  amountMinor: z.number().int(),
  currency: businessCurrencySchema,
  spentOn: z.string(),
  supplierId: z.uuid().nullable(),
  supplierName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof expenseSchema>;

export const expenseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(EXPENSES_PAGE_MAX).default(100),
  cursor: z.string().max(200).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  category: expenseCategorySchema.optional(),
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export const expenseListSchema = z.object({ items: z.array(expenseSchema), nextCursor: z.string().nullable() });
export type ExpenseList = z.infer<typeof expenseListSchema>;

// ---- rentabilité et exports ---------------------------------------------------------------

/** Nombre de jours calendaires d'une période from..to incluse (0 si invalide). */
export function periodDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? 0 : Math.round((b - a) / MS_DAY) + 1;
}

const periodShape = { from: isoDateSchema, to: isoDateSchema };
const checkPeriod = (b: { from: string; to: string }, ctx: z.core.$RefinementCtx): void => {
  const days = periodDays(b.from, b.to);
  if (days === 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
  else if (days > REPORT_MAX_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `the period is at most ${REPORT_MAX_DAYS} days` });
};

export const periodQuerySchema = z.object(periodShape).superRefine(checkPeriod);
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export const profitabilityQuerySchema = z.object({ ...periodShape, currency: businessCurrencySchema.optional() }).superRefine(checkPeriod);
export type ProfitabilityQuery = z.infer<typeof profitabilityQuerySchema>;

export const profitabilityCurrencySchema = z.object({
  currency: businessCurrencySchema,
  /** Chiffre d'affaires de marchandises : commandes livrées (hors frais de livraison) + ventes de caisse non annulées. */
  revenueMinor: z.number().int(),
  ordersRevenueMinor: z.number().int(),
  posRevenueMinor: z.number().int(),
  /** Quantités vendues × coût moyen COURANT de la variante (approximation : le coût n'est pas figé à la vente). */
  cogsMinor: z.number().int(),
  /** Lignes vendues dont le coût est inconnu : valorisées à 0 dans le coût, comptées à part. */
  unknownCostLines: z.number().int(),
  unknownCostRevenueMinor: z.number().int(),
  grossMarginMinor: z.number().int(),
  expensesMinor: z.number().int(),
  expensesByCategory: z.array(z.object({ category: expenseCategorySchema, amountMinor: z.number().int() })),
  estimatedResultMinor: z.number().int(),
  topProducts: z.array(
    z.object({ productId: z.uuid(), title: z.string(), quantity: z.number().int(), revenueMinor: z.number().int(), costMinor: z.number().int(), marginMinor: z.number().int() }),
  ),
});
export type ProfitabilityCurrency = z.infer<typeof profitabilityCurrencySchema>;

export const profitabilitySchema = z.object({ from: z.string(), to: z.string(), currencies: z.array(profitabilityCurrencySchema) });
export type Profitability = z.infer<typeof profitabilitySchema>;
