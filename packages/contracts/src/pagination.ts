import { z } from 'zod';

/** Cursor pagination: `cursor` is opaque; pass `nextCursor` back to get the next page. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
