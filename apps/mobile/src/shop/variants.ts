import type { StorefrontVariant } from '@caselind/contracts';

export type Selection = Record<string, string>;

/** Axes d'options (ordre d'apparition) avec leurs valeurs distinctes. */
export function optionAxes(variants: StorefrontVariant[]): { name: string; values: string[] }[] {
  const axes = new Map<string, string[]>();
  for (const v of variants) {
    for (const [name, value] of Object.entries(v.options)) {
      const list = axes.get(name) ?? [];
      if (!list.includes(value)) list.push(value);
      axes.set(name, list);
    }
  }
  return [...axes].map(([name, values]) => ({ name, values }));
}

const matches = (v: StorefrontVariant, sel: Selection) => Object.entries(sel).every(([k, val]) => v.options[k] === val);

/** La variante qui correspond exactement à une sélection complète (toutes les options choisies). */
export function findVariant(variants: StorefrontVariant[], sel: Selection): StorefrontVariant | null {
  const axes = optionAxes(variants);
  if (axes.some((a) => sel[a.name] === undefined)) return null;
  return variants.find((v) => Object.keys(v.options).length === axes.length && matches(v, sel)) ?? null;
}

/** Une valeur est proposée si une variante en stock la combine avec le reste de la sélection (hors son propre axe). */
export function isValueAvailable(variants: StorefrontVariant[], sel: Selection, axis: string, value: string): boolean {
  const rest: Selection = { ...sel };
  delete rest[axis];
  return variants.some((v) => v.inStock && v.options[axis] === value && matches(v, rest));
}

/** Sélection initiale : la variante la moins chère en stock (sinon la moins chère), ou {} sans option. */
export function defaultSelection(variants: StorefrontVariant[]): Selection {
  const sorted = [...variants].sort((a, b) => a.priceMinor - b.priceMinor);
  const pick = sorted.find((v) => v.inStock) ?? sorted[0];
  return pick ? { ...pick.options } : {};
}

/** Choisit une valeur ; si la combinaison n'existe pas, adopte la variante (en stock d'abord) la plus proche contenant ce choix. */
export function selectValue(variants: StorefrontVariant[], sel: Selection, axis: string, value: string): Selection {
  const next = { ...sel, [axis]: value };
  if (findVariant(variants, next)) return next;
  const candidates = variants.filter((v) => v.options[axis] === value);
  const score = (v: StorefrontVariant) => Object.entries(sel).filter(([k, val]) => k !== axis && v.options[k] === val).length;
  const best = [...candidates].sort((a, b) => Number(b.inStock) - Number(a.inStock) || score(b) - score(a))[0];
  return best ? { ...best.options } : next;
}
