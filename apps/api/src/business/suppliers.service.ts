import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateSupplierRequest,
  type DeleteSupplierResponse,
  SUPPLIERS_PER_ORG_MAX,
  type Supplier,
  type SupplierList,
  type SupplierListQuery,
  type UpdateSupplierRequest,
} from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

type Row = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: Date;
};

const COLS = sql`id, name, contact_name, phone, email, address, notes, active, created_at`;
const toSupplier = (r: Row): Supplier => ({
  id: r.id,
  name: r.name,
  contactName: r.contact_name,
  phone: r.phone,
  email: r.email,
  address: r.address,
  notes: r.notes,
  active: r.active,
  createdAt: new Date(r.created_at).toISOString(),
});
const notFound = () => AppError.notFound('Supplier not found');

/** Fournisseurs d'une organisation (≤ 500). L'audit ne contient que des identifiants : jamais nom, téléphone ni e-mail. */
@Injectable()
export class SuppliersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, q: SupplierListQuery): Promise<SupplierList> {
    const filters: SQL[] = [sql`org_id = ${orgId}::uuid`];
    if (q.active) filters.push(sql`active = ${q.active === 'true'}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor, 'time');
      filters.push(sql`(created_at, id) < (${c.key}::timestamptz, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row & { ts: string }>(sql`
      SELECT ${COLS}, created_at::text AS ts FROM suppliers WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map(toSupplier), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null };
  }

  async get(orgId: string, id: string): Promise<Supplier> {
    if (!UUID_RE.test(id)) throw notFound();
    const res = await this.db.execute<Row>(sql`SELECT ${COLS} FROM suppliers WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid`);
    if (!res.rows[0]) throw notFound();
    return toSupplier(res.rows[0]);
  }

  async create(orgId: string, userId: string, b: CreateSupplierRequest, meta: RequestMeta): Promise<Supplier> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier:${orgId}`}, 0))`);
      const n = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM suppliers WHERE org_id = ${orgId}::uuid`)).rows[0]!.n;
      if (n >= SUPPLIERS_PER_ORG_MAX) throw AppError.conflict(`At most ${SUPPLIERS_PER_ORG_MAX} suppliers per organization`, { reason: 'supplier_limit' });
      await this.assertNameFree(tx, orgId, b.name);
      const r = await tx.execute<Row>(sql`
        INSERT INTO suppliers (org_id, name, contact_name, phone, email, address, notes)
        VALUES (${orgId}::uuid, ${b.name}, ${b.contactName ?? null}, ${b.phone ?? null}, ${b.email ?? null}, ${b.address ?? null}, ${b.notes ?? null})
        RETURNING ${COLS}`);
      const s = toSupplier(r.rows[0]!);
      await this.audit.record({ action: 'business.supplier_created', actorUserId: userId, meta, metadata: { orgId, supplierId: s.id } }, tx);
      return s;
    });
  }

  async update(orgId: string, userId: string, id: string, b: UpdateSupplierRequest, meta: RequestMeta): Promise<Supplier> {
    if (!UUID_RE.test(id)) throw notFound();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier:${orgId}`}, 0))`);
      const cur = (await tx.execute<Row>(sql`SELECT ${COLS} FROM suppliers WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw notFound();
      if (b.name !== undefined && b.name.toLowerCase() !== cur.name.toLowerCase()) await this.assertNameFree(tx, orgId, b.name, id);
      const pick = <T>(v: T | null | undefined, old: T | null): T | null => (v === undefined ? old : v);
      const r = await tx.execute<Row>(sql`
        UPDATE suppliers SET name = ${b.name ?? cur.name}, contact_name = ${pick(b.contactName, cur.contact_name)}, phone = ${pick(b.phone, cur.phone)},
          email = ${pick(b.email, cur.email)}, address = ${pick(b.address, cur.address)}, notes = ${pick(b.notes, cur.notes)}, active = ${b.active ?? cur.active}
        WHERE id = ${id}::uuid RETURNING ${COLS}`);
      await this.audit.record(
        { action: 'business.supplier_changed', actorUserId: userId, meta, metadata: { orgId, supplierId: id, fields: Object.keys(b) } },
        tx,
      );
      return toSupplier(r.rows[0]!);
    });
  }

  /** Supprime, ou désactive quand un bon de commande ou une dépense y fait référence (l'historique reste lisible). */
  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<DeleteSupplierResponse> {
    if (!UUID_RE.test(id)) throw notFound();
    return this.db.transaction(async (tx) => {
      const cur = (await tx.execute(sql`SELECT 1 FROM suppliers WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`)).rows[0];
      if (!cur) throw notFound();
      const used = (
        await tx.execute(sql`
          SELECT 1 WHERE EXISTS (SELECT 1 FROM purchase_orders WHERE supplier_id = ${id}::uuid)
                      OR EXISTS (SELECT 1 FROM expenses WHERE supplier_id = ${id}::uuid)`)
      ).rows.length > 0;
      if (used) await tx.execute(sql`UPDATE suppliers SET active = false WHERE id = ${id}::uuid`);
      else await tx.execute(sql`DELETE FROM suppliers WHERE id = ${id}::uuid`);
      await this.audit.record(
        { action: used ? 'business.supplier_changed' : 'business.supplier_deleted', actorUserId: userId, meta, metadata: { orgId, supplierId: id, ...(used ? { fields: ['active'] } : {}) } },
        tx,
      );
      return { outcome: used ? 'deactivated' : 'deleted' };
    });
  }

  private async assertNameFree(tx: Pick<Db, 'execute'>, orgId: string, name: string, exceptId?: string): Promise<void> {
    const r = await tx.execute(sql`
      SELECT 1 FROM suppliers WHERE org_id = ${orgId}::uuid AND lower(name) = lower(${name}) ${exceptId ? sql`AND id <> ${exceptId}::uuid` : sql``} LIMIT 1`);
    if (r.rows.length > 0) throw AppError.conflict('A supplier with this name already exists', { reason: 'supplier_name_taken', field: 'name' });
  }
}
