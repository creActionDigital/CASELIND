import type { CreateDocumentRequest, DocumentKind, DocumentStatus } from '@caselind/contracts';
import { parseDecimalToMinor } from './money';

export interface LineDraft {
  description: string;
  quantity: string;
  price: string;
}
export interface DocumentDraft {
  kind: DocumentKind;
  customerName: string;
  customerContact: string;
  currency: 'USD' | 'CDF';
  lines: LineDraft[];
}

export const emptyLine = (): LineDraft => ({ description: '', quantity: '1', price: '' });

/** Converts the form to the API request; null when something is missing or invalid (the server checks again). */
export function toDocumentRequest(d: DocumentDraft): CreateDocumentRequest | null {
  if (!d.customerName.trim()) return null;
  const lines = [];
  for (const l of d.lines) {
    const quantity = Number(l.quantity);
    const unitPriceMinor = parseDecimalToMinor(l.price, d.currency);
    if (!l.description.trim() || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000 || unitPriceMinor === null) return null;
    lines.push({ description: l.description.trim(), quantity, unitPriceMinor });
  }
  if (lines.length === 0 || lines.length > 50) return null;
  return { kind: d.kind, customerName: d.customerName.trim(), customerContact: d.customerContact.trim(), currency: d.currency, lines };
}

/** The next steps a seller may take, mirroring the server (which has the final say). */
export function nextStatuses(kind: DocumentKind, status: DocumentStatus): Exclude<DocumentStatus, 'draft'>[] {
  if (status === 'draft') return ['sent', 'cancelled'];
  if (status === 'sent') return [kind === 'quote' ? 'accepted' : 'paid', 'cancelled'];
  return [];
}
