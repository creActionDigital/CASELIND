import { Inject, Injectable } from '@nestjs/common';
import { type DeliveryProof, type DeliveryProofFile, type DeliveryProofKind, type MediaMime, type SetDeliveryProofRequest } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { assertOwnReady, deleteObjects, invalidAsset } from '../media/attachments.js';
import { contentUrlOf } from '../media/media.service.js';
import { MediaStorage } from '../media/storage.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import type { OrgRole } from '@caselind/contracts';
import { deliveryNotFound, UUID_RE } from './delivery.shared.js';

/** A proof can be attached while the goods are on the way or just handed over. */
const PROOF_STATUSES = ['picked_up', 'in_transit', 'delivered'];
const KINDS: { kind: DeliveryProofKind; key: 'photoAssetId' | 'signatureAssetId' }[] = [
  { kind: 'photo', key: 'photoAssetId' },
  { kind: 'signature', key: 'signatureAssetId' },
];

type Row = { org_id: string; buyer_id: string; courier_id: string | null; status: string };

/** Proof of delivery by photo and/or signature (audit G5): a complement to the proof code, never a condition of it. */
@Injectable()
export class DeliveryProofService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: MediaStorage,
  ) {}

  /** The assigned courier sets or removes the photo and/or the signature. Replaced files are deleted. */
  async set(userId: string, deliveryId: string, body: SetDeliveryProofRequest, meta: RequestMeta): Promise<DeliveryProof> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const keys = await this.db.transaction(async (tx) => {
      const res = await tx.execute<Row>(sql`SELECT org_id, buyer_id, courier_id, status FROM deliveries WHERE id = ${deliveryId}::uuid AND courier_id = ${userId}::uuid FOR UPDATE`);
      const d = res.rows[0];
      if (!d) throw deliveryNotFound();
      if (!PROOF_STATUSES.includes(d.status)) throw AppError.conflict('A proof can only be attached once the goods are picked up', { reason: 'invalid_transition' });
      const member = await tx.execute<{ role: string }>(sql`SELECT role FROM org_members WHERE org_id = ${d.org_id}::uuid AND user_id = ${userId}::uuid AND status = 'active'`);
      const role = member.rows[0]?.role as OrgRole | undefined;
      if (!role || !(roleHasPermission(role, 'delivery.tasks') || roleHasPermission(role, 'orders.manage'))) {
        throw AppError.forbidden('You can no longer carry deliveries for this organisation');
      }
      if (body.photoAssetId && body.photoAssetId === body.signatureAssetId) throw invalidAsset('signatureAssetId', 'duplicate file');

      const removedKeys: string[] = [];
      const changes: { kind: DeliveryProofKind; action: 'set' | 'removed' }[] = [];
      for (const { kind, key } of KINDS) {
        const next = body[key];
        if (next === undefined) continue;
        const cur = (await tx.execute<{ media_id: string }>(sql`SELECT media_id FROM delivery_proofs WHERE delivery_id = ${deliveryId}::uuid AND kind = ${kind}`)).rows[0]?.media_id;
        if (next === cur) continue;
        if (next) {
          await assertOwnReady(tx, userId, 'delivery_proof', [next], key);
          const used = await tx.execute(sql`SELECT 1 FROM delivery_proofs WHERE media_id = ${next}::uuid LIMIT 1`);
          if (used.rows.length > 0) throw invalidAsset(key, 'file already attached elsewhere');
        }
        if (cur) {
          const gone = await tx.execute<{ storage_key: string }>(sql`DELETE FROM media_assets WHERE id = ${cur}::uuid RETURNING storage_key`);
          removedKeys.push(...gone.rows.map((r) => r.storage_key));
        }
        if (next) await tx.execute(sql`INSERT INTO delivery_proofs (delivery_id, kind, media_id, taken_by) VALUES (${deliveryId}::uuid, ${kind}, ${next}::uuid, ${userId}::uuid)`);
        changes.push({ kind, action: next ? 'set' : 'removed' });
      }
      if (changes.length > 0) {
        await this.audit.record({ action: 'delivery.proof_set', actorUserId: userId, subjectUserId: d.buyer_id, meta, metadata: { orgId: d.org_id, deliveryId, changes } }, tx);
      }
      return removedKeys;
    });
    await deleteObjects(this.storage, keys);
    return this.get(userId, deliveryId);
  }

  /** The buyer, the courier, and the members of the selling organisation who may view orders; anyone else: 404. */
  async get(userId: string, deliveryId: string): Promise<DeliveryProof> {
    if (!UUID_RE.test(deliveryId)) throw deliveryNotFound();
    const res = await this.db.execute<Row & { role: string | null }>(sql`
      SELECT d.org_id, d.buyer_id, d.courier_id, d.status, om.role FROM deliveries d
      LEFT JOIN org_members om ON om.org_id = d.org_id AND om.user_id = ${userId}::uuid AND om.status = 'active'
      WHERE d.id = ${deliveryId}::uuid`);
    const d = res.rows[0];
    if (!d || !(d.buyer_id === userId || d.courier_id === userId || (d.role !== null && roleHasPermission(d.role as OrgRole, 'orders.view')))) throw deliveryNotFound();
    const files = await this.db.execute<{ kind: DeliveryProofKind; id: string; mime: string | null; size_bytes: string | number; taken_at: Date | string }>(sql`
      SELECT p.kind, m.id, m.mime, m.size_bytes, p.taken_at FROM delivery_proofs p JOIN media_assets m ON m.id = p.media_id
      WHERE p.delivery_id = ${deliveryId}::uuid AND m.status = 'ready'`);
    const pick = (kind: DeliveryProofKind): DeliveryProofFile | null => {
      const r = files.rows.find((f) => f.kind === kind);
      return r ? { id: r.id, mime: r.mime as MediaMime, sizeBytes: Number(r.size_bytes), contentUrl: contentUrlOf(r.id), takenAt: new Date(r.taken_at).toISOString() } : null;
    };
    return { deliveryId, photo: pick('photo'), signature: pick('signature') };
  }
}
