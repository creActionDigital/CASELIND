import { describe, expect, it } from 'vitest';
import { DigitalProductsService } from './digital.service.js';
import { replaceFiles, PRODUCT_FILES } from '../media/attachments.js';

describe('digital', () => {
  it('setFiles teste l’UUID avant toute requête SQL', async () => {
    const db = { transaction: async () => { throw new Error('db touched'); } };
    const svc = new DigitalProductsService(db as never, {} as never, {} as never);
    await expect(svc.setFiles('o', 'u', 'pas-un-uuid', [], {} as never)).rejects.toMatchObject({ status: 404 });
  });

  it('replaceFiles garde (lié) un fichier d’un produit déjà livré', async () => {
    const sqls: string[] = [];
    const tx = {
      execute: async (q: { queryChunks?: unknown[] }) => {
        const text = JSON.stringify(q.queryChunks);
        sqls.push(text);
        if (text.includes('order_items')) return { rows: [{}] };
        if (text.includes('ORDER BY position')) return { rows: [{ media_id: 'old' }] };
        return { rows: [] };
      },
    };
    const gone = await replaceFiles(tx as never, PRODUCT_FILES, 'u', 'digital_file', '00000000-0000-0000-0000-000000000000', []);
    expect(gone).toEqual([]);
    expect(sqls.some((t) => t.includes('DELETE FROM media_assets'))).toBe(false);
    expect(sqls.some((t) => t.includes('INSERT INTO'))).toBe(true);
  });
});
