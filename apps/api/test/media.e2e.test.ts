import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENV, type Env } from '../src/config/env.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { MediaService } from '../src/media/media.service.js';
import { signUploadToken } from '../src/media/upload-token.js';
import { bearer, createTestContext, signUp, type TestContext } from './helpers.js';

const SECRET = randomBytes(32).toString('hex');
const IMAGE_LIMIT = 1024;

let ctx: TestContext;
let env: Env;

beforeAll(async () => {
  ctx = await createTestContext({
    MEDIA_SIGNING_SECRET: SECRET,
    MEDIA_MAX_IMAGE_BYTES: String(IMAGE_LIMIT),
    MEDIA_MAX_DOCUMENT_BYTES: '4096',
  });
  env = ctx.app.get(ENV);
});
afterAll(async () => {
  await ctx.close();
});

/** A real 1x1 PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
const HTML = Buffer.from('<!DOCTYPE html><html><body><script>alert(document.cookie)</script></body></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>');

async function user() {
  const { tokens } = await signUp(ctx);
  const me = await ctx.http.get('/v1/me').set(bearer(tokens.accessToken)).expect(200);
  return { token: tokens.accessToken, id: me.body.id as string };
}

type Upload = { assetId: string; uploadUrl: string; uploadToken: string; expiresAt: string; maxBytes: number };

async function announce(token: string, body: { purpose: string; mime: string; sizeBytes: number }): Promise<Upload> {
  const res = await ctx.http.post('/v1/media/uploads').set(bearer(token)).send(body).expect(201);
  return res.body as Upload;
}

function sendContent(token: string, up: Upload, content: Buffer, uploadToken = up.uploadToken) {
  return ctx.http
    .put(up.uploadUrl)
    .set(bearer(token))
    .set('X-Upload-Token', uploadToken)
    .set('Content-Type', 'application/octet-stream')
    .send(content);
}

/** Announces and uploads in one go; returns the ready asset. */
async function upload(token: string, purpose: string, mime: string, content: Buffer) {
  const up = await announce(token, { purpose, mime, sizeBytes: content.length });
  const res = await sendContent(token, up, content).expect(200);
  return res.body as { id: string; status: string; contentUrl: string };
}

/** Base URL of the app's HTTP server (ephemeral port) for raw fetch() calls with streamed bodies. */
async function baseUrl(): Promise<string> {
  const server = ctx.app.getHttpServer();
  if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stagingFiles(): Promise<string[]> {
  const dir = join(env.MEDIA_STORAGE_DIR, 'tmp');
  return existsSync(dir) ? readdir(dir) : [];
}

const objectPath = (id: string) => join(env.MEDIA_STORAGE_DIR, 'objects', 'media', id.slice(0, 2), id);

async function auditCount(action: string, assetId: string): Promise<number> {
  const { rows } = await ctx.sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_events WHERE action = $1 AND metadata->>'assetId' = $2`,
    [action, assetId],
  );
  return Number(rows[0]!.n);
}

describe('media uploads', () => {
  it('stores a PNG and serves it back byte for byte with safe headers', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    expect(up.uploadUrl).toBe(`/v1/media/uploads/${up.assetId}/content`);
    // Never more than announced (nor than the kind's limit).
    expect(up.maxBytes).toBe(TINY_PNG.length);
    expect(new Date(up.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    const pending = await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(alice.token)).expect(200);
    expect(pending.body).toMatchObject({ status: 'pending', mime: null, contentUrl: null });

    const sha256 = createHash('sha256').update(TINY_PNG).digest('hex');
    const done = await sendContent(alice.token, up, TINY_PNG).expect(200);
    expect(done.body).toMatchObject({
      id: up.assetId,
      ownerId: alice.id,
      purpose: 'post',
      status: 'ready',
      declaredMime: 'image/png',
      mime: 'image/png',
      sizeBytes: TINY_PNG.length,
      sha256,
      contentUrl: `/v1/media/${up.assetId}/content`,
      rejectedReason: null,
    });
    expect(existsSync(objectPath(up.assetId))).toBe(true);
    expect(await stagingFiles()).toEqual([]);
    expect(await auditCount('media.uploaded', up.assetId)).toBe(1);

    const content = await ctx.http
      .get(done.body.contentUrl)
      .set(bearer(alice.token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(content.body as Buffer, TINY_PNG)).toBe(0);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['content-length']).toBe(String(TINY_PNG.length));
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['content-disposition']).toBe(`inline; filename="${up.assetId}.png"`);
    expect(content.headers['cache-control']).toMatch(/^private/);
    expect(content.headers['etag']).toBe(`"${sha256}"`);
    expect(content.headers['content-security-policy']).toContain('sandbox');

    // Once ready, the upload cannot be replaced.
    const again = await sendContent(alice.token, up, TINY_PNG).expect(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('serves PDF documents as attachments', async () => {
    const alice = await user();
    const doc = await upload(alice.token, 'document', 'application/pdf', TINY_PDF);
    const res = await ctx.http.get(doc.contentUrl).set(bearer(alice.token)).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${doc.id}.pdf"`);
  });

  it.each([
    ['HTML', HTML],
    ['SVG', SVG],
  ])('rejects %s bytes declared as an image (415), deletes them and audits it', async (_, bytes) => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'avatar', mime: 'image/png', sizeBytes: bytes.length });
    const res = await sendContent(alice.token, up, bytes).expect(415);
    expect(res.body.error).toMatchObject({
      code: 'unsupported_media_type',
      details: { reason: 'unsupported_type', detectedMime: null },
    });
    const meta = await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(alice.token)).expect(200);
    expect(meta.body).toMatchObject({ status: 'rejected', rejectedReason: 'unsupported_type', contentUrl: null });
    expect(existsSync(objectPath(up.assetId))).toBe(false);
    expect(await stagingFiles()).toEqual([]);
    expect(await auditCount('media.rejected', up.assetId)).toBe(1);
    await ctx.http.get(`/v1/media/${up.assetId}/content`).set(bearer(alice.token)).expect(404);
    await sendContent(alice.token, up, TINY_PNG).expect(409);
  });

  it('rejects content that does not match the declared type', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/jpeg', sizeBytes: TINY_PNG.length });
    const res = await sendContent(alice.token, up, TINY_PNG).expect(415);
    expect(res.body.error.details).toEqual({ reason: 'type_mismatch', detectedMime: 'image/png' });
  });

  it('refuses a JSON body without touching the upload', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    const res = await ctx.http
      .put(up.uploadUrl)
      .set(bearer(alice.token))
      .set('X-Upload-Token', up.uploadToken)
      .send({ not: 'a file' })
      .expect(415);
    expect(res.body.error.details).toEqual({ reason: 'unsupported_content_type' });
    // Still pending: the right request succeeds.
    await sendContent(alice.token, up, TINY_PNG).expect(200);
  });

  it('validates purpose, type and size when the upload is announced', async () => {
    const alice = await user();
    const post = (body: object) => ctx.http.post('/v1/media/uploads').set(bearer(alice.token)).send(body);

    const tooBig = await post({ purpose: 'avatar', mime: 'image/png', sizeBytes: IMAGE_LIMIT + 1 }).expect(400);
    expect(tooBig.body.error.code).toBe('validation_failed');
    expect(tooBig.body.error.details[0]).toMatchObject({ path: 'sizeBytes', maxBytes: IMAGE_LIMIT });

    const wrongType = await post({ purpose: 'avatar', mime: 'application/pdf', sizeBytes: 10 }).expect(400);
    expect(wrongType.body.error.details[0].path).toBe('mime');
    await post({ purpose: 'avatar', mime: 'image/svg+xml', sizeBytes: 10 }).expect(400);
    await post({ purpose: 'banner', mime: 'image/png', sizeBytes: 10 }).expect(400);
    await post({ purpose: 'post', mime: 'image/png', sizeBytes: 0 }).expect(400);
    await ctx.http.post('/v1/media/uploads').send({ purpose: 'post', mime: 'image/png', sizeBytes: 1 }).expect(401);
  });

  it('answers 413 when the announced Content-Length exceeds the limit', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 100 });
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(IMAGE_LIMIT)]);
    const res = await sendContent(alice.token, up, big).expect(413);
    expect(res.body.error).toMatchObject({ code: 'payload_too_large', details: { maxBytes: 100 } });
    const meta = await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(alice.token)).expect(200);
    expect(meta.body).toMatchObject({ status: 'rejected', rejectedReason: 'too_large' });
  });

  it('stops a chunked upload with 413 as soon as it exceeds the limit', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 100 });
    // No Content-Length: the size is only known while streaming.
    const chunk = Buffer.alloc(512, 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(TINY_PNG);
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await fetch(`${await baseUrl()}${up.uploadUrl}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${alice.token}`,
        'X-Upload-Token': up.uploadToken,
        'Content-Type': 'application/octet-stream',
      },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');
    expect(await stagingFiles()).toEqual([]);
    const meta = await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(alice.token)).expect(200);
    expect(meta.body).toMatchObject({ status: 'rejected', rejectedReason: 'too_large' });
  });

  it('refuses content larger than announced (413), even below the kind limit', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    const res = await sendContent(alice.token, up, Buffer.concat([TINY_PNG, Buffer.alloc(10)])).expect(413);
    expect(res.body.error).toMatchObject({ code: 'payload_too_large', details: { maxBytes: TINY_PNG.length } });
    expect(await stagingFiles()).toEqual([]);
    // Smaller than announced is fine; the real size is recorded.
    const up2 = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 500 });
    const done = await sendContent(alice.token, up2, TINY_PNG).expect(200);
    expect(done.body.sizeBytes).toBe(TINY_PNG.length);
  });

  it('answers 500 when the staging file fails mid-upload, cleans up and keeps serving', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 600 });
    const service = ctx.app.get(MediaService) as unknown as { openStagingFile(path: string): Writable };
    // A real staging file whose stream fails (disk full) after the first write, while the server
    // waits for the client's next chunk: with no listener, this 'error' used to crash the process.
    const spy = vi.spyOn(service, 'openStagingFile').mockImplementationOnce((path: string) => {
      const out = createWriteStream(path, { flags: 'wx' });
      const write = out.write.bind(out) as (chunk: Buffer) => boolean;
      out.write = ((chunk: Buffer) => {
        const ok = write(chunk);
        setTimeout(() => out.destroy(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })), 20);
        return ok;
      }) as typeof out.write;
      return out;
    });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (pulls++ === 0) return controller.enqueue(TINY_PNG);
        await new Promise((resolve) => setTimeout(resolve, 300));
        controller.enqueue(Buffer.alloc(100, 1));
        controller.close();
      },
    });
    const res = await fetch(`${await baseUrl()}${up.uploadUrl}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${alice.token}`,
        'X-Upload-Token': up.uploadToken,
        'Content-Type': 'application/octet-stream',
      },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal_error');
    expect(await stagingFiles()).toEqual([]);

    // The process is alive and the upload, still pending, can be retried.
    const meta = await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(alice.token)).expect(200);
    expect(meta.body.status).toBe('pending');
    await sendContent(alice.token, up, TINY_PNG).expect(200);
  });

  it('re-issues an upload token for a pending upload of the caller only', async () => {
    const alice = await user();
    const bob = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    const reissue = (token: string, id = up.assetId) => ctx.http.post(`/v1/media/uploads/${id}/token`).set(bearer(token));

    const fresh = await reissue(alice.token).expect(200);
    expect(fresh.body).toMatchObject({ assetId: up.assetId, uploadUrl: up.uploadUrl, maxBytes: TINY_PNG.length });
    expect(new Date(fresh.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    await reissue(bob.token).expect(404);
    await reissue(alice.token, 'not-a-uuid').expect(404);
    await ctx.http.post(`/v1/media/uploads/${up.assetId}/token`).expect(401);

    await sendContent(alice.token, up, TINY_PNG, fresh.body.uploadToken).expect(200);
    const done = await reissue(alice.token).expect(409);
    expect(done.body.error.code).toBe('conflict');
  });

  it('requires a valid, unexpired upload token for that asset (403)', async () => {
    const alice = await user();
    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    const other = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });

    const missing = await ctx.http
      .put(up.uploadUrl)
      .set(bearer(alice.token))
      .set('Content-Type', 'application/octet-stream')
      .send(TINY_PNG)
      .expect(403);
    expect(missing.body.error.code).toBe('forbidden');
    await sendContent(alice.token, up, TINY_PNG, 'garbage').expect(403);
    await sendContent(alice.token, up, TINY_PNG, other.uploadToken).expect(403);
    const expired = signUploadToken(SECRET, up.assetId, alice.id, new Date(Date.now() - 1000));
    await sendContent(alice.token, up, TINY_PNG, expired).expect(403);
    // A correctly signed, still valid token is accepted (same secret as the server's).
    const fresh = signUploadToken(SECRET, up.assetId, alice.id, new Date(Date.now() + 60_000));
    await sendContent(alice.token, up, TINY_PNG, fresh).expect(200);
  });

  it('keeps other users out of uploads, message attachments and documents, but shares avatars', async () => {
    const alice = await user();
    const bob = await user();

    const up = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: TINY_PNG.length });
    // Even with Alice's upload token, Bob cannot write to her asset.
    await sendContent(bob.token, up, TINY_PNG).expect(404);
    // Nor see it while pending.
    await ctx.http.get(`/v1/media/${up.assetId}`).set(bearer(bob.token)).expect(404);

    const attachment = await upload(alice.token, 'message', 'image/png', TINY_PNG);
    await ctx.http.get(`/v1/media/${attachment.id}`).set(bearer(bob.token)).expect(404);
    await ctx.http.get(attachment.contentUrl).set(bearer(bob.token)).expect(404);
    await ctx.http.get(attachment.contentUrl).set(bearer(alice.token)).expect(200);

    const doc = await upload(alice.token, 'document', 'application/pdf', TINY_PDF);
    await ctx.http.get(doc.contentUrl).set(bearer(bob.token)).expect(404);

    const avatar = await upload(alice.token, 'avatar', 'image/png', TINY_PNG);
    // Non-owners get a reduced view: nothing about the owner or the upload.
    const meta = await ctx.http.get(`/v1/media/${avatar.id}`).set(bearer(bob.token)).expect(200);
    expect(Object.keys(meta.body).sort()).toEqual(['contentUrl', 'createdAt', 'id', 'mime', 'purpose', 'sizeBytes']);
    expect(meta.body).toMatchObject({ id: avatar.id, purpose: 'avatar', mime: 'image/png', contentUrl: avatar.contentUrl });
    const own = await ctx.http.get(`/v1/media/${avatar.id}`).set(bearer(alice.token)).expect(200);
    expect(own.body).toMatchObject({ ownerId: alice.id, status: 'ready' });
    expect(own.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    await ctx.http.get(avatar.contentUrl).set(bearer(bob.token)).expect(200);
    await ctx.http.get(avatar.contentUrl).expect(401);

    await ctx.http.delete(`/v1/media/${avatar.id}`).set(bearer(bob.token)).expect(404);
    await ctx.http.get('/v1/media/not-a-uuid').set(bearer(alice.token)).expect(404);
  });

  it('sets, shows and clears the avatar', async () => {
    const alice = await user();
    const bob = await user();
    const avatar = await upload(alice.token, 'avatar', 'image/png', TINY_PNG);

    const set = await ctx.http
      .patch('/v1/me/avatar')
      .set(bearer(alice.token))
      .send({ assetId: avatar.id })
      .expect(200);
    expect(set.body.avatarUrl).toBe(`/v1/media/${avatar.id}/content`);
    const me = await ctx.http.get('/v1/me').set(bearer(alice.token)).expect(200);
    expect(me.body.avatarUrl).toBe(`/v1/media/${avatar.id}/content`);
    expect(await auditCount('user.avatar_updated', avatar.id)).toBe(1);

    // Only a ready avatar upload of the caller.
    const post = await upload(alice.token, 'post', 'image/png', TINY_PNG);
    const wrongPurpose = await ctx.http.patch('/v1/me/avatar').set(bearer(alice.token)).send({ assetId: post.id }).expect(400);
    expect(wrongPurpose.body.error.details[0].path).toBe('assetId');
    const pending = await announce(alice.token, { purpose: 'avatar', mime: 'image/png', sizeBytes: 10 });
    await ctx.http.patch('/v1/me/avatar').set(bearer(alice.token)).send({ assetId: pending.assetId }).expect(400);
    await ctx.http.patch('/v1/me/avatar').set(bearer(bob.token)).send({ assetId: avatar.id }).expect(404);
    await ctx.http.patch('/v1/me/avatar').set(bearer(alice.token)).send({}).expect(400);

    const cleared = await ctx.http.patch('/v1/me/avatar').set(bearer(alice.token)).send({ assetId: null }).expect(200);
    expect(cleared.body.avatarUrl).toBeNull();
  });

  it('deletes a media and its file, and clears the avatar that used it', async () => {
    const alice = await user();
    const avatar = await upload(alice.token, 'avatar', 'image/png', TINY_PNG);
    await ctx.http.patch('/v1/me/avatar').set(bearer(alice.token)).send({ assetId: avatar.id }).expect(200);
    expect(existsSync(objectPath(avatar.id))).toBe(true);

    await ctx.http.delete(`/v1/media/${avatar.id}`).set(bearer(alice.token)).expect(204);
    expect(existsSync(objectPath(avatar.id))).toBe(false);
    await ctx.http.get(`/v1/media/${avatar.id}`).set(bearer(alice.token)).expect(404);
    await ctx.http.get(avatar.contentUrl).set(bearer(alice.token)).expect(404);
    await ctx.http.delete(`/v1/media/${avatar.id}`).set(bearer(alice.token)).expect(404);
    const me = await ctx.http.get('/v1/me').set(bearer(alice.token)).expect(200);
    expect(me.body.avatarUrl).toBeNull();
    expect(await auditCount('media.deleted', avatar.id)).toBe(1);
  });

  it('maintenance purges stale unfinished uploads and their staging files', async () => {
    const alice = await user();
    const stale = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 10 });
    const fresh = await announce(alice.token, { purpose: 'post', mime: 'image/png', sizeBytes: 10 });
    const ready = await upload(alice.token, 'post', 'image/png', TINY_PNG);
    await ctx.sql.query(`UPDATE media_assets SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`, [
      [stale.assetId, ready.id],
    ]);

    // Leftovers of interrupted uploads: one of the stale asset, one orphan from a crash, one in progress.
    const staging = join(env.MEDIA_STORAGE_DIR, 'tmp');
    await mkdir(staging, { recursive: true });
    const staleFile = join(staging, `${stale.assetId}.x.part`);
    const orphanFile = join(staging, `${randomBytes(4).toString('hex')}.y.part`);
    const liveFile = join(staging, `${fresh.assetId}.z.part`);
    for (const file of [staleFile, orphanFile, liveFile]) await writeFile(file, 'partial');
    const old = new Date(Date.now() - 25 * 3_600_000);
    await utimes(orphanFile, old, old);

    const result = await ctx.app.get(MaintenanceService).runOnce();
    expect(result.staleUploads).toBe(1);

    const { rows } = await ctx.sql.query<{ id: string }>('SELECT id FROM media_assets WHERE id = ANY($1)', [
      [stale.assetId, fresh.assetId, ready.id],
    ]);
    expect(rows.map((r) => r.id).sort()).toEqual([fresh.assetId, ready.id].sort());
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(orphanFile)).toBe(false);
    expect(existsSync(liveFile)).toBe(true);
    // Ready assets are never purged, however old.
    expect(existsSync(objectPath(ready.id))).toBe(true);

    expect((await ctx.app.get(MaintenanceService).runOnce()).staleUploads).toBe(0);
  });
});

describe('media quotas', () => {
  let qctx: TestContext;
  const PENDING_LIMIT = 2;
  const BYTES_LIMIT = 1000;

  beforeAll(async () => {
    qctx = await createTestContext({
      MEDIA_MAX_PENDING_PER_USER: String(PENDING_LIMIT),
      MEDIA_QUOTA_BYTES_PER_USER: String(BYTES_LIMIT),
    });
  });
  afterAll(async () => {
    await qctx.close();
  });

  const quser = async () => (await signUp(qctx)).tokens.accessToken;
  const post = (token: string, sizeBytes: number) =>
    qctx.http.post('/v1/media/uploads').set(bearer(token)).send({ purpose: 'post', mime: 'image/png', sizeBytes });

  it('caps unfinished uploads per user (409 quota_exceeded), freed by deleting one', async () => {
    const token = await quser();
    const first = await post(token, 10).expect(201);
    await post(token, 10).expect(201);
    const refused = await post(token, 10).expect(409);
    expect(refused.body.error).toMatchObject({
      code: 'conflict',
      details: { reason: 'quota_exceeded', quota: 'pending_uploads', limit: PENDING_LIMIT },
    });
    // Other users are not affected.
    await post(await quser(), 10).expect(201);
    await qctx.http.delete(`/v1/media/${first.body.assetId}`).set(bearer(token)).expect(204);
    await post(token, 10).expect(201);
  });

  it('caps the bytes held per user, counting ready sizes and announced pending sizes', async () => {
    const token = await quser();
    const up = (await post(token, TINY_PNG.length).expect(201)).body as Upload;
    await qctx.http
      .put(up.uploadUrl)
      .set(bearer(token))
      .set('X-Upload-Token', up.uploadToken)
      .set('Content-Type', 'application/octet-stream')
      .send(TINY_PNG)
      .expect(200);
    const left = BYTES_LIMIT - TINY_PNG.length;
    const refused = await post(token, left + 1).expect(409);
    expect(refused.body.error.details).toEqual({ reason: 'quota_exceeded', quota: 'bytes', limit: BYTES_LIMIT });
    await post(token, left).expect(201);
    // The pending announce now holds the rest of the quota.
    expect((await post(token, 1).expect(409)).body.error.details.quota).toBe('bytes');
  });

  it('holds under concurrent announces (per-user lock)', async () => {
    const token = await quser();
    const results = await Promise.all(Array.from({ length: 6 }, () => post(token, 10)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409, 409, 409, 409]);
  });
});

describe('media rate limit', () => {
  let rctx: TestContext;

  beforeAll(async () => {
    rctx = await createTestContext({ MEDIA_RATE_LIMIT_PER_MINUTE: '3' });
  });
  afterAll(async () => {
    await rctx.close();
  });

  // @nestjs/throttler counts per client AND per route: each throttled endpoint has its own budget.
  it('throttles upload announces, content and token re-issues, but not reads', async () => {
    const token = (await signUp(rctx)).tokens.accessToken;
    const post = () =>
      rctx.http.post('/v1/media/uploads').set(bearer(token)).send({ purpose: 'post', mime: 'image/png', sizeBytes: 10 });
    const first = await post().expect(201);
    await post().expect(201);
    await post().expect(201);
    expect((await post().expect(429)).body.error.code).toBe('rate_limited');

    const reissue = () => rctx.http.post(`/v1/media/uploads/${first.body.assetId}/token`).set(bearer(token));
    for (let i = 0; i < 3; i++) await reissue().expect(200);
    await reissue().expect(429);

    const put = () =>
      rctx.http
        .put(first.body.uploadUrl)
        .set(bearer(token))
        .set('X-Upload-Token', first.body.uploadToken)
        .set('Content-Type', 'application/json')
        .send({});
    // Refused bodies (415) still count.
    for (let i = 0; i < 3; i++) await put().expect(415);
    await put().expect(429);

    for (let i = 0; i < 5; i++) await rctx.http.get(`/v1/media/${first.body.assetId}`).set(bearer(token)).expect(200);
  });
});
