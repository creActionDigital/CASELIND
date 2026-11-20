import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { Tx } from '../orgs/orgs.service.js';

/**
 * Applies one signed stock delta to a variant of `orgId` inside the caller's transaction: row lock on the variant, stock never
 * negative, one typed `stock_movements` row (same rules as `CatalogService.adjustStock`). Used by batches (`restock`) and
 * physical inventory (`adjustment`). Re-entrant: the lock is simply held again when the variant is already locked.
 */
export async function applyStockDelta(
  tx: Tx,
  p: { orgId: string; variantId: string; delta: number; reason: 'restock' | 'adjustment'; actorUserId: string },
): Promise<number> {
  const v = (await tx.execute<{ stock: number; track_stock: boolean }>(sql`
    SELECT stock, track_stock FROM product_variants WHERE id = ${p.variantId}::uuid AND org_id = ${p.orgId}::uuid FOR UPDATE`)).rows[0];
  if (!v) throw AppError.notFound('Variant not found');
  if (!v.track_stock) throw AppError.conflict('Stock is not tracked for this variant', { reason: 'stock_not_tracked', variantId: p.variantId });
  const next = v.stock + p.delta;
  if (next < 0) throw AppError.conflict('Stock cannot become negative', { reason: 'stock_negative', variantId: p.variantId });
  await tx.execute(sql`UPDATE product_variants SET stock = ${next} WHERE id = ${p.variantId}::uuid`);
  await tx.execute(sql`
    INSERT INTO stock_movements (variant_id, org_id, delta, stock_after, reason, actor_user_id)
    VALUES (${p.variantId}::uuid, ${p.orgId}::uuid, ${p.delta}, ${next}, ${p.reason}, ${p.actorUserId}::uuid)`);
  return next;
}
