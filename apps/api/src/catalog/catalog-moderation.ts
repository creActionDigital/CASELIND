import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { products } from '../db/schema.js';
import { ModerationRegistry } from '../moderation/moderation-registry.js';
import { buyerVisibleSql, UUID_RE } from './catalog.shared.js';

/** Registers the `product` moderation target: a hidden product disappears for buyers (staff still see it). */
@Injectable()
export class CatalogModerationTarget implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ModerationRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('product', {
      visibleTo: async (viewerId, id) => {
        if (!UUID_RE.test(id)) return false;
        const res = await this.db.execute(sql`
          SELECT 1 FROM products p JOIN organizations o ON o.id = p.org_id
          WHERE p.id = ${id}::uuid AND ${buyerVisibleSql(viewerId)} LIMIT 1`);
        return res.rows.length > 0;
      },
      authorOf: async (id) => {
        if (!UUID_RE.test(id)) return null;
        const [r] = await this.db.select({ a: products.createdBy }).from(products).where(eq(products.id, id)).limit(1);
        return r?.a ?? null;
      },
      setHidden: async (id, hidden) => {
        if (!UUID_RE.test(id)) return;
        await this.db.update(products).set({ hidden }).where(eq(products.id, id));
      },
    });
  }
}
