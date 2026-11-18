import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeCatalog, installFakeCatalog } from './fake-catalog.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { bearer, createTestContext, PASSWORD, signUp, type TestContext } from './helpers.js';
import { TINY_PDF, TINY_PNG, uploadAsset } from './upload.js';

let ctx: TestContext;
const fake = new FakeCatalog();

beforeAll(async () => {
  ctx = await createTestContext();
  installFakeCatalog(ctx, fake);
  await ctx.sql.query(`INSERT INTO feature_flags (key, description, enabled) VALUES ('commerce', 'test', true) ON CONFLICT (key) DO UPDATE SET enabled = true`);
});
afterAll(async () => {
  await ctx.close();
});

interface TU {
  token: string;
  id: string;
  handle: string;
}
async function user(): Promise<TU> {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id, handle: me.body.handle };
}
async function addMember(orgId: string, inviter: TU, invitee: TU, role: string): Promise<void> {
  await ctx.http.post(`/v1/orgs/${orgId}/invitations`).set(bearer(inviter.token)).send({ handle: invitee.handle, role }).expect(201);
  await ctx.http.post(`/v1/me/org-invitations/${orgId}/accept`).set(bearer(invitee.token)).expect(200);
}

const ADDRESS = { name: 'Awa Diallo', phone: '+243810000000', city: 'Kinshasa', line1: '12 avenue de la Paix', line2: 'Gombe' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from([0xff, 0xd9])]);

interface Setup {
  owner: TU;
  courier: TU;
  other: TU; // a second courier of the same organisation
  buyer: TU;
  stranger: TU;
  orgId: string;
  deliveryId: string;
  proofCode: string;
}

/** A delivery assigned to `courier`, still in `assigned`. */
async function setup(): Promise<Setup> {
  const [owner, courier, other, buyer, stranger] = [await user(), await user(), await user(), await user(), await user()];
  const org = await ctx.http.post('/v1/orgs').set(bearer(owner.token)).send({ slug: `proof-${randomUUID().slice(0, 8)}`, name: 'Boutique Preuve', kind: 'shop' }).expect(201);
  const orgId = org.body.id as string;
  await addMember(orgId, owner, courier, 'delivery');
  await addMember(orgId, owner, other, 'delivery');
  const variant = fake.add({ orgId, currency: 'CDF', price: 10_000, stock: 100 });
  await ctx.http.put(`/v1/cart/items/${variant}`).set(bearer(buyer.token)).send({ quantity: 1 }).expect(200);
  const checkout = await ctx.http.post('/v1/orders/checkout').set(bearer(buyer.token)).send({ clientId: randomUUID(), address: ADDRESS, paymentMethod: 'cash_on_delivery' }).expect(201);
  const orderId = checkout.body.orders[0].id as string;
  const detail = (await ctx.http.get(`/v1/orders/${orderId}`).set(bearer(buyer.token)).expect(200)).body;
  const deliveryId = detail.delivery.id as string;
  for (const status of ['confirmed', 'preparing']) await ctx.http.post(`/v1/orgs/${orgId}/orders/${orderId}/status`).set(bearer(owner.token)).send({ status }).expect(200);
  await ctx.http.post(`/v1/orgs/${orgId}/deliveries/${deliveryId}/assign`).set(bearer(owner.token)).send({ courierUserId: courier.id }).expect(200);
  return { owner, courier, other, buyer, stranger, orgId, deliveryId, proofCode: detail.delivery.proofCode };
}

const put = (u: TU, id: string, body: Record<string, unknown>) => ctx.http.put(`/v1/deliveries/${id}/proof`).set(bearer(u.token)).send(body);
const get = (u: TU, id: string) => ctx.http.get(`/v1/deliveries/${id}/proof`).set(bearer(u.token));
const read = (u: TU, id: string) => ctx.http.get(`/v1/media/${id}/content`).set(bearer(u.token));
const courierStatus = (u: TU, id: string, body: Record<string, unknown>) => ctx.http.post(`/v1/me/deliveries/${id}/status`).set(bearer(u.token)).send(body);
const photoOf = (u: TU, content = TINY_PNG, mime = 'image/png') => uploadAsset(ctx, u.token, 'delivery_proof', mime, content);

describe('delivery proof by photo and signature (audit G5)', () => {
  it('the assigned courier attaches a photo and a signature once the goods are picked up', async () => {
    const s = await setup();
    const photo = await photoOf(s.courier, JPEG, 'image/jpeg');
    const sig = await photoOf(s.courier);
    // Not yet picked up: refused. Only the assigned courier may attach.
    expect((await put(s.courier, s.deliveryId, { photoAssetId: photo }).expect(409)).body.error.details.reason).toBe('invalid_transition');
    await courierStatus(s.courier, s.deliveryId, { status: 'picked_up' }).expect(200);
    await put(s.other, s.deliveryId, { photoAssetId: photo }).expect(404);
    await put(s.owner, s.deliveryId, { photoAssetId: photo }).expect(404);
    await put(s.buyer, s.deliveryId, { photoAssetId: photo }).expect(404);
    await put(s.courier, s.deliveryId, {}).expect(400);
    await put(s.courier, s.deliveryId, { photoAssetId: 'nope' }).expect(400);
    await put(s.courier, 'not-a-uuid', { photoAssetId: photo }).expect(404);
    await put(s.courier, s.deliveryId, { photoAssetId: photo, signatureAssetId: photo }).expect(400);

    const done = await put(s.courier, s.deliveryId, { photoAssetId: photo, signatureAssetId: sig }).expect(200);
    expect(done.body.photo).toMatchObject({ id: photo, mime: 'image/jpeg', contentUrl: expect.stringContaining(photo) });
    expect(done.body.signature).toMatchObject({ id: sig, mime: 'image/png' });
    expect(new Date(done.body.photo.takenAt).getTime()).toBeGreaterThan(0);

    // Readers: courier, buyer, seller members with orders.view. Strangers and other couriers: 404 (the other courier has no orders.view? delivery role: see below).
    for (const id of [photo, sig]) {
      await read(s.courier, id).expect(200);
      await read(s.buyer, id).expect(200);
      await read(s.owner, id).expect(200);
      await read(s.stranger, id).expect(404);
    }
    expect((await get(s.buyer, s.deliveryId).expect(200)).body.photo.id).toBe(photo);
    expect((await get(s.owner, s.deliveryId).expect(200)).body.signature.id).toBe(sig);
    expect((await get(s.courier, s.deliveryId).expect(200)).body.deliveryId).toBe(s.deliveryId);
    await get(s.stranger, s.deliveryId).expect(404);
    await get(s.stranger, 'not-a-uuid').expect(404);

    // The code stays the rule: the proof is a complement, delivered still needs the code, and the proof survives it.
    await courierStatus(s.courier, s.deliveryId, { status: 'in_transit' }).expect(200);
    await courierStatus(s.courier, s.deliveryId, { status: 'delivered', code: s.proofCode }).expect(200);
    const sig2 = await photoOf(s.courier);
    await put(s.courier, s.deliveryId, { signatureAssetId: sig2 }).expect(200); // still allowed once delivered
    const after = (await get(s.buyer, s.deliveryId).expect(200)).body;
    expect(after.photo.id).toBe(photo);
    expect(after.signature.id).toBe(sig2);
    await read(s.courier, sig).expect(404); // replaced signature is gone

    const audit = await ctx.sql.query(`SELECT metadata FROM audit_events WHERE action = 'delivery.proof_set' AND actor_user_id = $1 ORDER BY id`, [s.courier.id]);
    expect(audit.rows).toHaveLength(2);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('png');
    expect(audit.rows[0].metadata.changes).toEqual([{ kind: 'photo', action: 'set' }, { kind: 'signature', action: 'set' }]);
  });

  it('refuses a wrong purpose, a foreign file, a pending upload and a reused file', async () => {
    const s = await setup();
    await courierStatus(s.courier, s.deliveryId, { status: 'picked_up' }).expect(200);
    const wrongPurpose = await uploadAsset(ctx, s.courier.token, 'delivery', 'image/png', TINY_PNG);
    await put(s.courier, s.deliveryId, { photoAssetId: wrongPurpose }).expect(400);
    const foreign = await photoOf(s.other);
    await put(s.courier, s.deliveryId, { photoAssetId: foreign }).expect(400);
    const pending = (await ctx.http.post('/v1/media/uploads').set(bearer(s.courier.token)).send({ purpose: 'delivery_proof', mime: 'image/png', sizeBytes: 10 }).expect(201)).body.assetId;
    await put(s.courier, s.deliveryId, { photoAssetId: pending }).expect(400);
    // A PDF or a video, and a file above 5 MB, are not accepted for this purpose.
    await ctx.http.post('/v1/media/uploads').set(bearer(s.courier.token)).send({ purpose: 'delivery_proof', mime: 'application/pdf', sizeBytes: TINY_PDF.length }).expect(400);
    await ctx.http.post('/v1/media/uploads').set(bearer(s.courier.token)).send({ purpose: 'delivery_proof', mime: 'video/mp4', sizeBytes: 10 }).expect(400);
    await ctx.http.post('/v1/media/uploads').set(bearer(s.courier.token)).send({ purpose: 'delivery_proof', mime: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }).expect(400);

    // The same upload cannot serve two deliveries.
    const ok = await photoOf(s.courier);
    await put(s.courier, s.deliveryId, { photoAssetId: ok }).expect(200);
    const s2 = await setup();
    await courierStatus(s2.courier, s2.deliveryId, { status: 'picked_up' }).expect(200);
    await put(s2.courier, s2.deliveryId, { photoAssetId: ok }).expect(400);
    // An unattached proof upload is readable by its author only.
    const loose = await photoOf(s.courier);
    await read(s.courier, loose).expect(200);
    await read(s.buyer, loose).expect(404);
  });

  it('replaces and removes: the old file is deleted, null clears, an absent key leaves it', async () => {
    const s = await setup();
    await courierStatus(s.courier, s.deliveryId, { status: 'picked_up' }).expect(200);
    const a = await photoOf(s.courier);
    const b = await photoOf(s.courier);
    await put(s.courier, s.deliveryId, { photoAssetId: a }).expect(200);
    const swapped = await put(s.courier, s.deliveryId, { photoAssetId: b }).expect(200);
    expect(swapped.body.photo.id).toBe(b);
    await read(s.courier, a).expect(404);
    const same = await put(s.courier, s.deliveryId, { photoAssetId: b }).expect(200); // idempotent, not deleted
    expect(same.body.photo.id).toBe(b);
    await read(s.courier, b).expect(200);
    const sig = await photoOf(s.courier);
    await put(s.courier, s.deliveryId, { signatureAssetId: sig }).expect(200);
    const cleared = await put(s.courier, s.deliveryId, { photoAssetId: null }).expect(200);
    expect(cleared.body.photo).toBeNull();
    expect(cleared.body.signature.id).toBe(sig);
    await read(s.courier, b).expect(404);
    // Frozen after a failure: the proof only exists for deliveries on the way or handed over.
    await courierStatus(s.courier, s.deliveryId, { status: 'failed', reason: 'client absent' }).expect(200);
    await put(s.courier, s.deliveryId, { photoAssetId: null }).expect(409);
  });

  it('is exported as existence only, and purged with the deleted buyer', async () => {
    const s = await setup();
    await courierStatus(s.courier, s.deliveryId, { status: 'picked_up' }).expect(200);
    const photo = await photoOf(s.courier);
    await put(s.courier, s.deliveryId, { photoAssetId: photo }).expect(200);
    for (const u of [s.buyer, s.courier]) {
      const exp = (await ctx.http.get('/v1/me/export').set(bearer(u.token)).expect(200)).body;
      expect(exp.deliveries[0].proofs).toEqual([{ kind: 'photo', sizeBytes: TINY_PNG.length, takenAt: expect.any(String) }]);
      expect(JSON.stringify(exp.deliveries)).not.toContain(photo);
    }
    const other = (await ctx.http.get('/v1/me/export').set(bearer(s.owner.token)).expect(200)).body;
    expect(other.deliveries).toEqual([]);

    // Buyer account deleted: the proof row and its file go (the purge removes the media, the link cascades).
    await ctx.http.post('/v1/me/deletion-request').set(bearer(s.buyer.token)).send({ password: PASSWORD }).expect(202);
    await ctx.sql.query(`UPDATE users SET deletion_requested_at = now() - interval '31 days' WHERE id = $1`, [s.buyer.id]);
    await ctx.app.get(MaintenanceService).runOnce();
    expect((await ctx.sql.query(`SELECT 1 FROM delivery_proofs WHERE delivery_id = $1`, [s.deliveryId])).rows).toHaveLength(0);
    await read(s.courier, photo).expect(404);
  });
});
