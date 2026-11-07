import { parseDecimalToMinor } from './money';

/** Brouillon de variante tel que saisi dans l'éditeur (chaînes). */
export interface VariantDraft {
  key: string; // identifiant local stable
  id?: string; // variante existante
  sku: string;
  options: { name: string; value: string }[];
  price: string; // décimal
  currency: string;
  stock: string; // stock initial (création seulement)
  trackStock: boolean;
  active: boolean;
}

export type VariantErrorCode =
  | 'sku_required'
  | 'sku_duplicate'
  | 'price_invalid'
  | 'stock_invalid'
  | 'option_incomplete'
  | 'option_duplicate'
  | 'option_too_many';
export interface VariantErrors {
  sku?: VariantErrorCode;
  price?: VariantErrorCode;
  stock?: VariantErrorCode;
  options?: VariantErrorCode;
}

export const MAX_VARIANTS = 50;
export const MAX_OPTIONS = 10;
export const MAX_PHOTOS = 10;

/** Erreurs par variante (index = position) ; objets vides si tout est valide. */
export function validateVariants(variants: readonly VariantDraft[]): VariantErrors[] {
  const first = new Map<string, number>();
  variants.forEach((v, i) => {
    const k = v.sku.trim().toLowerCase();
    if (k && !first.has(k)) first.set(k, i);
  });
  return variants.map((v, i) => {
    const e: VariantErrors = {};
    const sku = v.sku.trim();
    if (!sku || sku.length > 64) e.sku = 'sku_required';
    else if (first.get(sku.toLowerCase()) !== i) e.sku = 'sku_duplicate';
    if (parseDecimalToMinor(v.price, v.currency) === null) e.price = 'price_invalid';
    if (!v.id && !/^\d{1,9}$/.test(v.stock.trim() || '0')) e.stock = 'stock_invalid';
    if (v.options.length > MAX_OPTIONS) e.options = 'option_too_many';
    else {
      const names = new Set<string>();
      for (const o of v.options) {
        const n = o.name.trim().toLowerCase();
        if (!n || !o.value.trim() || o.name.trim().length > 40 || o.value.trim().length > 80) {
          e.options = 'option_incomplete';
          break;
        }
        if (names.has(n)) {
          e.options = 'option_duplicate';
          break;
        }
        names.add(n);
      }
    }
    return e;
  });
}

export const hasErrors = (errors: readonly VariantErrors[]): boolean => errors.some((e) => Object.keys(e).length > 0);

/** `[{name, value}]` -> objet `{nom: valeur}` attendu par l'API (lignes vides ignorées). */
export function optionsToRecord(options: readonly { name: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of options) {
    const n = o.name.trim();
    const v = o.value.trim();
    if (n && v) out[n] = v;
  }
  return out;
}

/** Corps de variante pour POST/PATCH ; null si le prix est invalide. Le stock initial n'est envoyé qu'à la création. */
export function toVariantInput(v: VariantDraft) {
  const priceMinor = parseDecimalToMinor(v.price, v.currency);
  if (priceMinor === null) return null;
  return {
    ...(v.id ? { id: v.id } : {}),
    sku: v.sku.trim(),
    options: optionsToRecord(v.options),
    priceMinor,
    currency: v.currency,
    ...(v.id ? {} : { stock: Number(v.stock.trim() || '0') }),
    trackStock: v.trackStock,
    active: v.active,
  };
}

/** Déplace un élément (réordonnancement des photos) ; renvoie une copie. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const copy = [...list];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}
