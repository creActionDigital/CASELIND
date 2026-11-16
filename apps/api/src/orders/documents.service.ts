import { Inject, Injectable } from '@nestjs/common';
import {
  type BusinessDocument,
  type BusinessDocumentList,
  type CreateDocumentRequest,
  type DocumentKind,
  type DocumentListQuery,
  type DocumentLine,
  type DocumentStatus,
} from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { UUID_RE } from './orders.shared.js';

type Row = {
  id: string;
  kind: DocumentKind;
  number: string;
  customer_name: string;
  customer_contact: string;
  currency: string;
  lines: DocumentLine[];
  total_minor: string;
  status: DocumentStatus;
  source_quote_id: string | null;
  created_at: Date;
};
const COLS = sql`id, kind, number, customer_name, customer_contact, currency::text AS currency, lines, total_minor::text AS total_minor, status, source_quote_id, created_at`;
const toDoc = (r: Row): BusinessDocument => ({
  id: r.id,
  kind: r.kind,
  number: r.number,
  customerName: r.customer_name,
  customerContact: r.customer_contact,
  currency: r.currency,
  lines: r.lines,
  totalMinor: Number(r.total_minor),
  status: r.status,
  sourceQuoteId: r.source_quote_id,
  createdAt: new Date(r.created_at).toISOString(),
});
const PREFIX: Record<DocumentKind, string> = { quote: 'DEV', invoice: 'FAC' };
// What a seller may do next. "paid" only records that the customer paid; nothing is charged here.
const NEXT: Record<DocumentKind, Partial<Record<DocumentStatus, DocumentStatus[]>>> = {
  quote: { draft: ['sent', 'cancelled'], sent: ['accepted', 'cancelled'] },
  invoice: { draft: ['sent', 'cancelled'], sent: ['paid', 'cancelled'] },
};
const totalOf = (lines: DocumentLine[]) => lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);

/** Quotes and invoices of an organisation. Customer details never go into the audit trail. */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async create(orgId: string, userId: string, body: CreateDocumentRequest, meta: RequestMeta, sourceQuoteId: string | null = null): Promise<BusinessDocument> {
    const total = totalOf(body.lines);
    if (!Number.isSafeInteger(total) || total > 1_000_000_000_000) {
      throw new AppError(400, 'validation_failed', 'Request validation failed', [{ path: 'lines', message: 'total is too large' }]);
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`); // serialises the numbering
      const n = await tx.execute<{ n: number }>(sql`SELECT count(*)::int + 1 AS n FROM business_documents WHERE org_id = ${orgId}::uuid AND kind = ${body.kind}`);
      const number = `${PREFIX[body.kind]}-${new Date().getUTCFullYear()}-${String(n.rows[0]!.n).padStart(4, '0')}`;
      const res = await tx.execute<Row>(sql`
        INSERT INTO business_documents (org_id, kind, number, customer_name, customer_contact, currency, lines, total_minor, created_by, source_quote_id)
        VALUES (${orgId}::uuid, ${body.kind}, ${number}, ${body.customerName}, ${body.customerContact}, ${body.currency}, ${JSON.stringify(body.lines)}::jsonb, ${total}, ${userId}::uuid, ${sourceQuoteId}::uuid)
        RETURNING ${COLS}`);
      const doc = toDoc(res.rows[0]!);
      await this.audit.record({ action: 'commerce.document_created', actorUserId: userId, meta, metadata: { orgId, documentId: doc.id, kind: doc.kind, number: doc.number } }, tx);
      return doc;
    });
  }

  async list(orgId: string, q: DocumentListQuery): Promise<BusinessDocumentList> {
    const kind = q.kind ? sql`AND kind = ${q.kind}` : sql``;
    const res = await this.db.execute<Row>(sql`SELECT ${COLS} FROM business_documents WHERE org_id = ${orgId}::uuid ${kind} ORDER BY created_at DESC, id DESC LIMIT 100`);
    return { items: res.rows.map(toDoc) };
  }

  async get(orgId: string, id: string): Promise<BusinessDocument> {
    if (!UUID_RE.test(id)) throw AppError.notFound('Document not found');
    const res = await this.db.execute<Row>(sql`SELECT ${COLS} FROM business_documents WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid`);
    if (!res.rows[0]) throw AppError.notFound('Document not found');
    return toDoc(res.rows[0]);
  }

  async setStatus(orgId: string, userId: string, id: string, status: DocumentStatus, meta: RequestMeta): Promise<BusinessDocument> {
    const cur = await this.get(orgId, id);
    if (!NEXT[cur.kind][cur.status]?.includes(status)) {
      throw AppError.conflict(`A ${cur.kind} cannot go from ${cur.status} to ${status}`, { reason: 'invalid_transition', from: cur.status, to: status });
    }
    const res = await this.db.execute<Row>(sql`UPDATE business_documents SET status = ${status} WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND status = ${cur.status} RETURNING ${COLS}`);
    if (!res.rows[0]) throw AppError.conflict('The document changed meanwhile', { reason: 'changed' });
    await this.audit.record({ action: 'commerce.document_status', actorUserId: userId, meta, metadata: { orgId, documentId: id, from: cur.status, to: status } });
    return toDoc(res.rows[0]);
  }

  /** An accepted quote becomes one draft invoice with the same customer and lines. */
  async convert(orgId: string, userId: string, id: string, meta: RequestMeta): Promise<BusinessDocument> {
    const q = await this.get(orgId, id);
    if (q.kind !== 'quote' || q.status !== 'accepted') throw AppError.conflict('Only an accepted quote can become an invoice', { reason: 'not_accepted' });
    try {
      return await this.create(orgId, userId, { kind: 'invoice', customerName: q.customerName, customerContact: q.customerContact, currency: q.currency as 'USD' | 'CDF', lines: q.lines }, meta, q.id);
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23505') throw AppError.conflict('This quote already became an invoice', { reason: 'already_converted' });
      throw e;
    }
  }
}
