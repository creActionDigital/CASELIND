import { z } from 'zod';
import { storefrontProductSchema } from './catalog.js';

/** Wishlist (migrations/0077). Over the cap: 409 `details.reason = 'wishlist_full'`. */
export const WISHLIST_MAX = 200;

/** `product` is null (and `available` false) when the product is no longer visible to the caller. */
export const wishlistItemSchema = z.object({
  productId: z.string().uuid(),
  addedAt: z.string(),
  available: z.boolean(),
  product: storefrontProductSchema.nullable(),
});
export type WishlistItem = z.infer<typeof wishlistItemSchema>;
export const wishlistListSchema = z.object({ items: z.array(wishlistItemSchema), nextCursor: z.string().nullable() });
export type WishlistList = z.infer<typeof wishlistListSchema>;

export const exportedWishlistItemSchema = z.object({ productId: z.string().uuid(), addedAt: z.iso.datetime() });
export type ExportedWishlistItem = z.infer<typeof exportedWishlistItemSchema>;
