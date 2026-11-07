import { orgSlugSchema } from '@caselind/contracts';

/** « Chez Mama Léa ! » -> « chez-mama-lea » (proposition de slug, 40 caractères au plus). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export type ShopErrors = { name?: 'required'; slug?: 'invalid'; phone?: 'invalid' };

const E164 = /^\+[1-9][0-9]{6,14}$/;

export function validateShop(f: { name: string; slug: string; phone: string }): ShopErrors {
  const e: ShopErrors = {};
  if (!f.name.trim() || f.name.trim().length > 120) e.name = 'required';
  if (!orgSlugSchema.safeParse(f.slug).success) e.slug = 'invalid';
  const phone = f.phone.trim().replace(/[\s.-]/g, '');
  if (phone && !E164.test(phone)) e.phone = 'invalid';
  return e;
}

/** Numéro saisi (espaces tolérés) -> E.164, ou undefined si vide. */
export const normalizePhone = (p: string): string | undefined => p.trim().replace(/[\s.-]/g, '') || undefined;
