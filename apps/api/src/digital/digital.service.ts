import { Inject, Injectable } from '@nestjs/common';
import type { DownloadList, ProductFiles } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { deleteObjects, filesByKey, PRODUCT_FILES, replaceFiles } from '../media/attachments.js';
import { MediaStorage } from '../media/storage.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Produits numeriques : un produit qui porte des fichiers ; telechargement apres livraison de la commande (aucun paiement en ligne). */
@Injectable()
export class DigitalProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: MediaStorage,
  ) {}

  async getFiles(orgId: string, productId: string): Promise<ProductFiles> {
    await this.assertOwn(orgId, productId);
    return { items: (await filesByKey(this.db, PRODUCT_FILES, [productId])).get(productId) ?? [] };
  }

  /** Replaces the files (ready `digital_file` uploads of the caller); dropped files are deleted. */
  async setFiles(orgId: string, userId: string, productId: string, assetIds: string[], meta: RequestMeta): Promise<ProductFiles> {
    const keys = await this.db.transaction(async (tx) => {
      const own = await tx.execute(sql`SELECT 1 FROM products WHERE id = ${productId}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`);
      if (own.rows.length === 0 || !UUID_RE.test(productId)) throw AppError.notFound('Product not found');
      const removed = await replaceFiles(tx, PRODUCT_FILES, userId, 'digital_file', productId, assetIds);
      await this.audit.record({ action: 'catalog.product_files_set', actorUserId: userId, meta, metadata: { orgId, productId, count: assetIds.length } }, tx);
      return removed;
    });
    await deleteObjects(this.storage, keys);
    return this.getFiles(orgId, productId);
  }

  /** The caller's delivered orders that contain digital products, newest first (100 at most). */
  async downloads(buyerId: string): Promise<DownloadList> {
    const { rows } = await this.db.execute<{ order_id: string; product_id: string; title: string; delivered_at: Date | string }>(sql`
      SELECT DISTINCT ON (o.id, oi.product_id) o.id AS order_id, oi.product_id, p.title, o.updated_at AS delivered_at
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.buyer_id = ${buyerId}::uuid AND o.status = 'delivered'
        AND EXISTS (SELECT 1 FROM product_files pf WHERE pf.product_id = oi.product_id)
      ORDER BY o.id, oi.product_id, o.updated_at DESC
      LIMIT 100`);
    const files = await filesByKey(this.db, PRODUCT_FILES, [...new Set(rows.map((r) => r.product_id))]);
    return {
      items: rows
        .map((r) => ({ orderId: r.order_id, productId: r.product_id, title: r.title, deliveredAt: new Date(r.delivered_at).toISOString(), files: files.get(r.product_id) ?? [] }))
        .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt)),
    };
  }

  private async assertOwn(orgId: string, productId: string): Promise<void> {
    if (!UUID_RE.test(productId)) throw AppError.notFound('Product not found');
    const own = await this.db.execute(sql`SELECT 1 FROM products WHERE id = ${productId}::uuid AND org_id = ${orgId}::uuid`);
    if (own.rows.length === 0) throw AppError.notFound('Product not found');
  }
}
