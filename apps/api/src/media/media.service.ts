import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, type Writable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateUploadRequest,
  type CreateUploadResponse,
  ErrorCodes,
  type MediaAsset,
  type MediaAssetPublic,
  type MediaKind,
  type MediaMime,
  MEDIA_PURPOSE_MAX_BYTES,
  mediaKindOf,
  mediaMimeSchema,
  type Me,
} from '@caselind/contracts';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { HealthCrypto } from '../health/health-crypto.js';
import type { RequestMeta } from '../common/request-meta.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { type MediaAssetRow, mediaAssets, users } from '../db/schema.js';
import type { AuthUser } from '../security/auth.guard.js';
import { UsersService } from '../users/users.service.js';
import { StoryAccessService } from '../stories/story-access.js';
import { canReadAsync } from './access.js';
import { matchesDeclared, SNIFF_HEAD_BYTES, sniffMime } from './sniff.js';
import { MediaStorage } from './storage.js';
import { signUploadToken, UPLOAD_TOKEN_TTL_MS, verifyUploadToken } from './upload-token.js';

/** Unfinished uploads (pending or rejected) and orphan staging files are purged after this delay. */
export const STALE_UPLOAD_MS = 24 * 3_600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Purposes whose bytes are sealed at rest (AES-256-GCM, whole file in memory: both are capped at 20 MB). */
const SEALED_PURPOSES: ReadonlySet<string> = new Set(['health_result', 'kyc_document']);

export const contentUrlOf = (id: string) => `/v1/media/${id}/content`;

const EXTENSIONS: Record<MediaMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

export type RejectReason = 'unsupported_type' | 'type_mismatch' | 'too_large';

/** The raw request body of an upload, as Express hands it over (no body parser consumed it). */
export interface UploadSource extends Readable {
  headers: Record<string, string | string[] | undefined>;
}

function toDto(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    ownerId: row.ownerUserId,
    purpose: row.purpose,
    status: row.status,
    declaredMime: row.declaredMime as MediaMime,
    mime: (row.mime as MediaMime | null) ?? null,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    contentUrl: row.status === 'ready' ? contentUrlOf(row.id) : null,
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
  };
}

/** What non-owners may see of a ready asset they can read: nothing about the owner or the upload. */
function toPublicDto(row: MediaAssetRow): MediaAssetPublic {
  return {
    id: row.id,
    purpose: row.purpose,
    mime: (row.mime as MediaMime | null) ?? null,
    sizeBytes: row.sizeBytes,
    contentUrl: row.status === 'ready' ? contentUrlOf(row.id) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Releases the file handle (required before deleting the file on Windows). */
async function closeQuietly(out: Writable): Promise<void> {
  if (out.closed) return;
  const closed = once(out, 'close').catch(() => undefined);
  out.destroy();
  await closed;
}

/**
 * Two-step uploads (announce, then send the bytes) with server-side type detection, size limits,
 * checksum and atomic storage; read access policy in ./access.ts.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly stagingDir: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: MediaStorage,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly storyAccess: StoryAccessService,
    private readonly crypto: HealthCrypto,
  ) {
    this.stagingDir = join(env.MEDIA_STORAGE_DIR, 'tmp');
  }

  maxBytesFor(kind: MediaKind): number {
    switch (kind) {
      case 'image':
        return this.env.MEDIA_MAX_IMAGE_BYTES;
      case 'video':
        return this.env.MEDIA_MAX_VIDEO_BYTES;
      case 'audio':
        return this.env.MEDIA_MAX_AUDIO_BYTES;
      case 'document':
        return this.env.MEDIA_MAX_DOCUMENT_BYTES;
    }
  }

  async createUpload(auth: AuthUser, body: CreateUploadRequest, now = new Date()): Promise<CreateUploadResponse> {
    const maxBytes = Math.min(this.maxBytesFor(mediaKindOf(body.mime)), MEDIA_PURPOSE_MAX_BYTES[body.purpose] ?? Infinity);
    if (body.sizeBytes > maxBytes) {
      throw new AppError(400, ErrorCodes.validationFailed, 'File too large for this type', [
        { path: 'sizeBytes', message: `must be at most ${maxBytes} bytes`, maxBytes },
      ]);
    }
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      // Serialises the announces of one user so concurrent ones cannot all pass the quota check.
      // FOR NO KEY UPDATE, not FOR UPDATE: the insert below takes FOR KEY SHARE on this row (foreign
      // key), which FOR UPDATE held by another transaction would block and FOR NO KEY UPDATE does not.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, auth.userId)).for('no key update');
      const [usage] = await tx
        .select({
          unfinished: sql<number>`count(*) filter (where ${mediaAssets.status} <> 'ready')`.mapWith(Number),
          bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}) filter (where ${mediaAssets.status} <> 'rejected'), 0)`.mapWith(Number),
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.ownerUserId, auth.userId));
      // Rejected uploads count as unfinished (rows until the 24 h purge) but hold no bytes.
      const pendingLimit = this.env.MEDIA_MAX_PENDING_PER_USER;
      if (usage!.unfinished >= pendingLimit) {
        throw AppError.conflict('Too many unfinished uploads: finish or delete some first', {
          reason: 'quota_exceeded',
          quota: 'pending_uploads',
          limit: pendingLimit,
        });
      }
      // Pending uploads count for their declared size: their content may never exceed it.
      const bytesLimit = this.env.MEDIA_QUOTA_BYTES_PER_USER;
      if (usage!.bytes + body.sizeBytes > bytesLimit) {
        throw AppError.conflict('Storage quota exceeded: delete some media first', {
          reason: 'quota_exceeded',
          quota: 'bytes',
          limit: bytesLimit,
        });
      }
      await tx.insert(mediaAssets).values({
        id,
        ownerUserId: auth.userId,
        purpose: body.purpose,
        declaredMime: body.mime,
        sizeBytes: body.sizeBytes,
        // Opaque, never derived from user input; two hex characters spread files over 256 directories.
        storageKey: `media/${id.slice(0, 2)}/${id}`,
      });
    });
    return this.issueUploadToken(id, auth.userId, Math.min(maxBytes, body.sizeBytes), now);
  }

  /** A new upload token for a pending upload of the caller (the previous one expired or was lost). */
  async reissueUploadToken(auth: AuthUser, id: string, now = new Date()): Promise<CreateUploadResponse> {
    const asset = await this.findOwned(auth.userId, id);
    if (asset.status !== 'pending') throw AppError.conflict(`This upload is already ${asset.status}`);
    return this.issueUploadToken(asset.id, auth.userId, this.contentLimitOf(asset), now);
  }

  private issueUploadToken(id: string, ownerId: string, maxBytes: number, now: Date): CreateUploadResponse {
    const expiresAt = new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS);
    return {
      assetId: id,
      uploadUrl: `/v1/media/uploads/${id}/content`,
      uploadToken: signUploadToken(this.env.MEDIA_SIGNING_SECRET, id, ownerId, expiresAt),
      expiresAt: expiresAt.toISOString(),
      maxBytes,
    };
  }

  /**
   * At most the announced size (the quota counts pending uploads for it, so sending more would
   * bypass it), and never more than the current limit for the declared kind.
   */
  private contentLimitOf(asset: MediaAssetRow): number {
    return Math.min(this.maxBytesFor(mediaKindOf(asset.declaredMime as MediaMime)), asset.sizeBytes);
  }

  /**
   * Receives the bytes of a pending upload. The body is streamed to a staging file while counting
   * (never buffered whole): past maxBytes the upload stops with 413. The type is then detected from
   * the first bytes; a refused file is deleted and the asset marked rejected (415). Accepted files
   * are moved atomically into storage and the asset becomes ready.
   */
  async receiveContent(
    auth: AuthUser,
    id: string,
    token: string | undefined,
    source: UploadSource,
    meta: RequestMeta,
  ): Promise<MediaAsset> {
    const asset = await this.findOwned(auth.userId, id);
    if (!verifyUploadToken(this.env.MEDIA_SIGNING_SECRET, token, asset.id, auth.userId)) {
      throw AppError.forbidden('Invalid or expired upload token');
    }
    if (asset.status !== 'pending') throw AppError.conflict(`This upload is already ${asset.status}`);

    // Only raw bodies: JSON / form bodies would already have been consumed by Express's parsers.
    const contentType = String(source.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType !== 'application/octet-stream' && !mediaMimeSchema.safeParse(contentType).success) {
      throw new AppError(415, ErrorCodes.unsupportedMediaType, 'Send the raw file as application/octet-stream', {
        reason: 'unsupported_content_type',
      });
    }

    const declared = asset.declaredMime as MediaMime;
    const maxBytes = this.contentLimitOf(asset);
    const announced = Number(source.headers['content-length']);
    if (Number.isFinite(announced) && announced > maxBytes) {
      await this.reject(auth, asset, 'too_large', meta);
      throw this.tooLarge(maxBytes);
    }

    await mkdir(this.stagingDir, { recursive: true });
    const tempPath = join(this.stagingDir, `${asset.id}.${randomUUID()}.part`);
    let received: { size: number; sha256: string; head: Buffer };
    try {
      received = await this.stageBody(source, tempPath, maxBytes);
    } catch (err) {
      await rm(tempPath, { force: true, maxRetries: 3 });
      if (err instanceof PayloadTooLarge) {
        await this.reject(auth, asset, 'too_large', meta);
        throw this.tooLarge(maxBytes);
      }
      throw err;
    }

    const detected = sniffMime(received.head);
    const reason: RejectReason | null = !detected
      ? 'unsupported_type'
      : !matchesDeclared(detected, declared)
        ? 'type_mismatch'
        : null;
    if (reason) {
      await rm(tempPath, { force: true, maxRetries: 3 });
      await this.reject(auth, asset, reason, meta, detected);
      throw new AppError(415, ErrorCodes.unsupportedMediaType, 'This file type is not accepted', {
        reason,
        detectedMime: detected,
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        // Serialises concurrent uploads to the same asset: only the first one stores its file.
        const [row] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)).for('update');
        if (!row) throw AppError.notFound('Media not found');
        if (row.status !== 'pending') throw AppError.conflict(`This upload is already ${row.status}`);
        let toStore = tempPath;
        if (SEALED_PURPOSES.has(row.purpose)) {
          toStore = `${tempPath}.sealed`;
          await writeFile(toStore, this.crypto.sealBytes(row.id, await readFile(tempPath)));
        }
        await this.storage.putFile(row.storageKey, toStore);
        const [ready] = await tx
          .update(mediaAssets)
          .set({
            status: 'ready',
            // Declared audio/mp4 detected as generic MP4 keeps the declared (audio) type.
            mime: declared,
            sizeBytes: received.size,
            sha256: received.sha256,
            uploadedAt: new Date(),
          })
          .where(eq(mediaAssets.id, row.id))
          .returning();
        await this.audit.record(
          {
            action: 'media.uploaded',
            actorUserId: auth.userId,
            sessionId: auth.sessionId,
            meta,
            metadata: { assetId: row.id, purpose: row.purpose, mime: declared, sizeBytes: received.size },
          },
          tx,
        );
        return toDto(ready!);
      });
    } finally {
      // Already moved on success; removes the staging file when another request won the race.
      await rm(tempPath, { force: true, maxRetries: 3 });
      await rm(`${tempPath}.sealed`, { force: true, maxRetries: 3 });
    }
  }

  /** Metadata: the owner sees every state, others only ready assets they may read. */
  async get(viewerId: string, id: string): Promise<MediaAsset | MediaAssetPublic> {
    const row = await this.findById(id);
    if (!row) throw AppError.notFound('Media not found');
    if (row.ownerUserId === viewerId) return toDto(row);
    if (row.status !== 'ready' || !(await canReadAsync(this.db, viewerId, row, this.storyAccess))) throw AppError.notFound('Media not found');
    // Non-owners get a reduced view (no owner id, checksum, declared type or upload details).
    return toPublicDto(row);
  }

  /** The bytes of a ready asset the viewer may read (404 otherwise, owner included while unfinished). */
  async openContent(viewerId: string, id: string): Promise<{ asset: MediaAsset; stream: Readable; filename: string }> {
    const row = await this.findById(id);
    if (!row || row.status !== 'ready' || !(await canReadAsync(this.db, viewerId, row, this.storyAccess))) throw AppError.notFound('Media not found');
    let stream: Readable;
    try {
      stream = await this.storage.openRead(row.storageKey);
    } catch (err) {
      this.logger.error({ err, assetId: row.id }, 'stored media is missing');
      throw AppError.notFound('Media not found');
    }
    if (SEALED_PURPOSES.has(row.purpose)) stream = await this.unseal(row.id, stream);
    return { asset: toDto(row), stream, filename: `${row.id}.${EXTENSIONS[row.mime as MediaMime]}` };
  }

  /** Decrypts a sealed file in memory; a legacy clear file (no magic prefix) passes through unchanged. */
  private async unseal(id: string, stream: Readable): Promise<Readable> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    try {
      return Readable.from([this.crypto.openBytes(id, Buffer.concat(chunks))]);
    } catch (err) {
      this.logger.error({ err, assetId: id }, 'stored media could not be decrypted');
      throw AppError.notFound('Media not found');
    }
  }

  /**
   * Anonymous read: only a ready `product` image attached to a published, non-hidden product of an active, public
   * organisation. Everything else (any other purpose, draft or archived product, private org...) is a 404.
   */
  async openPublicProductContent(id: string): Promise<{ asset: MediaAsset; stream: Readable; filename: string }> {
    const row = UUID.test(id) ? await this.findById(id) : undefined;
    if (!row || row.status !== 'ready' || row.purpose !== 'product') throw AppError.notFound('Media not found');
    const res = await this.db.execute(sql`
      SELECT 1 FROM product_media pm
      JOIN products p ON p.id = pm.product_id
      JOIN organizations o ON o.id = p.org_id
      WHERE pm.media_id = ${row.id}::uuid AND p.status = 'published' AND NOT p.hidden
        AND o.status = 'active' AND o.visibility = 'public'
      LIMIT 1`);
    if (res.rows.length === 0) throw AppError.notFound('Media not found');
    let stream: Readable;
    try {
      stream = await this.storage.openRead(row.storageKey);
    } catch (err) {
      this.logger.error({ err, assetId: row.id }, 'stored media is missing');
      throw AppError.notFound('Media not found');
    }
    return { asset: toDto(row), stream, filename: `${row.id}.${EXTENSIONS[row.mime as MediaMime]}` };
  }

  /** Deletes an asset of the caller (any state) and its file; clears the avatar that used it. */
  async delete(auth: AuthUser, id: string, meta: RequestMeta): Promise<void> {
    const asset = await this.findOwned(auth.userId, id);
    await this.db.transaction(async (tx) => {
      const deleted = await tx.delete(mediaAssets).where(eq(mediaAssets.id, asset.id)).returning({ id: mediaAssets.id });
      if (deleted.length === 0) throw AppError.notFound('Media not found');
      await tx
        .update(users)
        .set({ avatarUrl: null })
        .where(and(eq(users.id, auth.userId), eq(users.avatarUrl, contentUrlOf(asset.id))));
      await this.audit.record(
        {
          action: 'media.deleted',
          actorUserId: auth.userId,
          sessionId: auth.sessionId,
          meta,
          metadata: { assetId: asset.id, purpose: asset.purpose, status: asset.status },
        },
        tx,
      );
    });
    await this.deleteObject(asset.storageKey);
  }

  /** PATCH /v1/me/avatar: a ready `avatar` asset of the caller, or null to remove the avatar. */
  async setAvatar(auth: AuthUser, assetId: string | null, meta: RequestMeta): Promise<Me> {
    await this.db.transaction(async (tx) => {
      let avatarUrl: string | null = null;
      if (assetId !== null) {
        // FOR SHARE: a concurrent DELETE of this asset either commits first (then it is not found
        // here) or waits for this transaction and then clears the avatar set here.
        const [asset] = UUID.test(assetId)
          ? await tx
              .select()
              .from(mediaAssets)
              .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, auth.userId)))
              .for('share')
          : [];
        if (!asset) throw AppError.notFound('Media not found');
        if (asset.purpose !== 'avatar' || asset.status !== 'ready') {
          throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [
            { path: 'assetId', message: 'must be a ready upload with purpose "avatar"' },
          ]);
        }
        avatarUrl = contentUrlOf(asset.id);
      }
      await tx.update(users).set({ avatarUrl }).where(eq(users.id, auth.userId));
      await this.audit.record(
        { action: 'user.avatar_updated', actorUserId: auth.userId, sessionId: auth.sessionId, meta, metadata: { assetId } },
        tx,
      );
    });
    return this.users.me(auth.userId);
  }

  /**
   * Maintenance: deletes uploads never completed (pending) or refused (rejected) for more than
   * STALE_UPLOAD_MS, any object stored for them, and staging files that are theirs or older than
   * that delay (left behind by a crash). Returns the number of assets deleted.
   */
  async purgeStaleUploads(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_UPLOAD_MS);
    const stale = await this.db
      .delete(mediaAssets)
      .where(and(ne(mediaAssets.status, 'ready'), lt(mediaAssets.createdAt, cutoff)))
      .returning({ id: mediaAssets.id, storageKey: mediaAssets.storageKey });
    for (const asset of stale) await this.deleteObject(asset.storageKey);

    const staleIds = new Set(stale.map((a) => a.id));
    let entries: string[] = [];
    try {
      entries = await readdir(this.stagingDir);
    } catch {
      // No staging directory yet: nothing was ever uploaded on this instance.
    }
    for (const name of entries) {
      const path = join(this.stagingDir, name);
      try {
        if (staleIds.has(name.split('.')[0]!) || (await stat(path)).mtime < cutoff) {
          await rm(path, { force: true, maxRetries: 3 });
        }
      } catch (err) {
        this.logger.warn({ err, path }, 'could not remove a staging file');
      }
    }
    return stale.length;
  }

  /** Opens the staging file (exclusive create). A separate method so tests can inject a failing stream. */
  protected openStagingFile(path: string): Writable {
    return createWriteStream(path, { flags: 'wx' });
  }

  /**
   * Streams the request body to `tempPath`, counting, hashing and keeping the first bytes for type
   * detection. Throws PayloadTooLarge past `maxBytes` without destroying the request (so a 413 can
   * still be answered), and the file stream's error as soon as it happens (open failure, ENOSPC,
   * EIO...), even while waiting for the client's next chunk. The caller removes the file.
   */
  private async stageBody(
    source: Readable,
    tempPath: string,
    maxBytes: number,
  ): Promise<{ size: number; sha256: string; head: Buffer }> {
    const out = this.openStagingFile(tempPath);
    // An 'error' with no listener would crash the process: this listener lives as long as the stream,
    // and `failed` turns the first error into a rejection raced against every wait below.
    let failure: Error | undefined;
    const failed = new Promise<never>((_, reject) => {
      out.on('error', (err) => {
        if (failure) return this.logger.debug({ err, tempPath }, 'further staging file error');
        failure = err;
        reject(err);
      });
    });
    failed.catch(() => undefined);

    const hash = createHash('sha256');
    const headChunks: Buffer[] = [];
    let headLength = 0;
    let size = 0;
    // destroyOnReturn: false keeps the socket alive when we stop early, so the 413 can be sent.
    const chunks = (source.iterator({ destroyOnReturn: false }) as AsyncIterableIterator<Buffer>)[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await Promise.race([chunks.next(), failed]);
        if (next.done) break;
        const chunk = next.value;
        size += chunk.length;
        if (size > maxBytes) throw new PayloadTooLarge();
        hash.update(chunk);
        if (headLength < SNIFF_HEAD_BYTES) {
          headChunks.push(chunk.subarray(0, SNIFF_HEAD_BYTES - headLength));
          headLength += Math.min(chunk.length, SNIFF_HEAD_BYTES - headLength);
        }
        if (!out.write(chunk)) await Promise.race([once(out, 'drain'), failed]);
        if (failure) throw failure;
      }
      out.end();
      await Promise.race([once(out, 'close'), failed]);
      if (failure) throw failure;
    } catch (err) {
      // Stops reading without destroying the request, and without waiting for a chunk that may never come.
      chunks.return?.().catch(() => undefined);
      await closeQuietly(out);
      throw err;
    }
    return { size, sha256: hash.digest('hex'), head: Buffer.concat(headChunks) };
  }

  private async reject(
    auth: AuthUser,
    asset: MediaAssetRow,
    reason: RejectReason,
    meta: RequestMeta,
    detectedMime: MediaMime | null = null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(mediaAssets)
        .set({ status: 'rejected', rejectedReason: reason, mime: null })
        .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.status, 'pending')))
        .returning({ id: mediaAssets.id });
      if (updated.length === 0) return;
      await this.audit.record(
        {
          action: 'media.rejected',
          actorUserId: auth.userId,
          sessionId: auth.sessionId,
          meta,
          metadata: { assetId: asset.id, purpose: asset.purpose, declaredMime: asset.declaredMime, detectedMime, reason },
        },
        tx,
      );
    });
  }

  private tooLarge(maxBytes: number): AppError {
    return new AppError(413, ErrorCodes.payloadTooLarge, `The file exceeds ${maxBytes} bytes`, { maxBytes });
  }

  private async findById(id: string): Promise<MediaAssetRow | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
    return row;
  }

  /** Someone else's asset is indistinguishable from a missing one. */
  private async findOwned(userId: string, id: string): Promise<MediaAssetRow> {
    const row = await this.findById(id);
    if (!row || row.ownerUserId !== userId) throw AppError.notFound('Media not found');
    return row;
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      // The row is gone: an orphan object is harmless and unreachable. Log it for a manual sweep.
      this.logger.error({ err, key }, 'could not delete a stored media object');
    }
  }
}

class PayloadTooLarge extends Error {}
