import { Inject, Injectable } from '@nestjs/common';
import type { CreateExpenseRequest, Expense, ExpenseCategory, ExpenseList, ExpenseListQuery, UpdateExpenseRequest } from '@caselind/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../catalog/catalog.shared.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

type Row = {
  id: string;
  category: ExpenseCategory;
  amount_minor: string | number;
  currency: 'USD' | 'CDF';
  spent_on: string;
  supplier_id: string | null;
  supplier_name: string | null;
  note: string | null;
  created_at: Date;
};

const COLS = sql`e.id, e.category, e.amount_minor, e.currency::text AS currency, e.spent_on::text AS spent_on, e.supplier_id, s.name AS supplier_name, e.note, e.created_at`;
const FROM = sql`FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id`;
const toExpense = (r: Row): Expense => ({
  id: r.id,
  category: r.category,
  amountMinor: Number(r.amount_minor),
  currency: r.currency,
  spentOn: r.spent_on,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  note: r.note,
  createdAt: new Date(r.created_at).toISOString(),
});
const notFound = () => AppError.notFound('Expense not found');

/** Dépenses de l'organisation. L'audit ne garde ni la note ni le fournisseur : catégorie, montant et devise seulement. */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, q: ExpenseListQuery): Promise<ExpenseList> {
    const filters: SQL[] = [sql`e.org_id = ${orgId}::uuid`];
    if (q.from) filters.push(sql`e.spent_on >= ${q.from}::date`);
    if (q.to) filters.push(sql`e.spent_on <= ${q.to}::date`);
    if (q.category) filters.push(sql`e.category = ${q.category}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor, 'time');
      filters.push(sql`(e.spent_on, e.id) < (${c.key}::date, ${c.id}::uuid)`);
    }
    const res = await this.db.execute<Row>(sql`
      SELECT ${COLS} ${FROM} WHERE ${sql.join(filters, sql` AND `)} ORDER BY e.spent_on DESC, e.id DESC LIMIT ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map(toExpense), nextCursor: res.rows.length > q.limit && last ? encodeCursor(last.spent_on, last.id) : null };
  }

  private async one(orgId: string, id: string): Promise<Expense> {
    if (!UUID_RE.test(id)) throw notFound();
    const r = await this.db.execute<Row>(sql`SELECT ${COLS} ${FROM} WHERE e.id = ${id}::uuid AND e.org_id = ${orgId}::uuid`);
    if (!r.rows[0]) throw notFound();
    return toExpense(r.rows[0]);
  }

  async create(orgId: string, userId: string, b: CreateExpenseRequest, meta: RequestMeta): Promise<Expense> {
    const id = await this.db.transaction(async (tx) => {
      if (b.supplierId) await this.assertSupplier(tx, orgId, b.supplierId);
      const r = await tx.execute<{ id: string }>(sql`
        INSERT INTO expenses (org_id, category, amount_minor, currency, spent_on, supplier_id, note, created_by)
        VALUES (${orgId}::uuid, ${b.category}, ${b.amountMinor}, ${b.currency}, ${b.spentOn}::date, ${b.supplierId ?? null}::uuid, ${b.note ?? null}, ${userId}::uuid)
        RETURNING id`);
      const newId = r.rows[0]!.id;
      await this.audit.record(
        { action: 'business.expense_created', actorUserId: userId, meta, metadata: { orgId, expenseId: newId, category: b.category, amountMinor: b.amountMinor, currency: b.currency } },
        tx,
      );
      return newId;
    });
    return this.one(orgId, id);
  }

  async update(orgId: string, userId: string, id: string, b: UpdateExpenseRequest, meta: RequestMeta): Promise<Expense> {
    if (!UUID_RE.test(id)) throw notFound();
    await this.db.transaction(async (tx) => {
      const cur = (
        await tx.execute<Row>(sql`SELECT e.id, e.category, e.amount_minor, e.currency::text AS currency, e.spent_on::text AS spent_on, e.supplier_id, NULL AS supplier_name, e.note, e.created_at
          FROM expenses e WHERE e.id = ${id}::uuid AND e.org_id = ${orgId}::uuid FOR UPDATE`)
      ).rows[0];
      if (!cur) throw notFound();
      if (b.supplierId) await this.assertSupplier(tx, orgId, b.supplierId);
      await tx.execute(sql`
        UPDATE expenses SET category = ${b.category ?? cur.category}, amount_minor = ${b.amountMinor ?? Number(cur.amount_minor)}, currency = ${b.currency ?? cur.currency},
          spent_on = ${b.spentOn ?? cur.spent_on}::date, supplier_id = ${b.supplierId === undefined ? cur.supplier_id : b.supplierId}::uuid,
          note = ${b.note === undefined ? cur.note : b.note}
        WHERE id = ${id}::uuid`);
      await this.audit.record(
        { action: 'business.expense_changed', actorUserId: userId, meta, metadata: { orgId, expenseId: id, fields: Object.keys(b) } },
        tx,
      );
    });
    return this.one(orgId, id);
  }

  async remove(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound();
    await this.db.transaction(async (tx) => {
      const r = await tx.execute(sql`DELETE FROM expenses WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid RETURNING id`);
      if (r.rows.length === 0) throw notFound();
      await this.audit.record({ action: 'business.expense_deleted', actorUserId: userId, meta, metadata: { orgId, expenseId: id } }, tx);
    });
  }

  private async assertSupplier(tx: Pick<Db, 'execute'>, orgId: string, supplierId: string): Promise<void> {
    const r = await tx.execute(sql`SELECT 1 FROM suppliers WHERE id = ${supplierId}::uuid AND org_id = ${orgId}::uuid`);
    if (r.rows.length === 0) throw AppError.notFound('Supplier not found');
  }
}
