import { type AttachedFile, ErrorCodes, type MediaMime, type MediaPurpose } from '@caselind/contracts';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { Db } from '../db/db.module.js';
import { contentUrlOf } from './media.service.js';
import type { MediaStorage } from './storage.js';

const logger = new Logger('MediaStorage');
type Exec = Pick<Db, 'execute'>;
/** A link table between one object (milestone, lesson) and its attached media (lot 19m). Names are constants, never user input. */
export type FileLink = { table: 'milestone_files' | 'lesson_files' | 'org_gallery_files'; col: 'milestone_id' | 'lesson_id' | 'org_id' };
export const MILESTONE_FILES: FileLink = { table: 'milestone_files', col: 'milestone_id' };
export const LESSON_FILES: FileLink = { table: 'lesson_files', col: 'lesson_id' };
export const ORG_GALLERY: FileLink = { table: 'org_gallery_files', col: 'org_id' };

export const invalidAsset = (path: string, message: string) => new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path, message }]);
const uuids = (ids: string[]) => sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]`;

/** The ids must be distinct ready uploads of the caller with this purpose. */
export async function assertOwnReady(db: Exec, userId: string, purpose: MediaPurpose, ids: string[], path = 'assetIds'): Promise<void> {
  if (ids.length === 0) return;
  if (new Set(ids).size !== ids.length) throw invalidAsset(path, 'duplicate file');
  const res = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM media_assets WHERE id = ANY(${uuids(ids)}) AND owner_user_id = ${userId}::uuid AND purpose = ${purpose} AND status = 'ready'`);
  if ((res.rows[0]?.n ?? 0) !== ids.length) throw invalidAsset(path, `must be your own ready uploads with purpose "${purpose}"`);
}

const toFile = (r: { id: string; mime: string | null; size_bytes: string | number }): AttachedFile => ({ id: r.id, mime: r.mime as MediaMime, sizeBytes: Number(r.size_bytes), contentUrl: contentUrlOf(r.id) });

export async function fileOf(db: Exec, mediaId: string | null): Promise<AttachedFile | null> {
  if (!mediaId) return null;
  const res = await db.execute<{ id: string; mime: string | null; size_bytes: string }>(sql`SELECT id, mime, size_bytes FROM media_assets WHERE id = ${mediaId}::uuid AND status = 'ready'`);
  return res.rows[0] ? toFile(res.rows[0]) : null;
}

/** Attached files per object key, in order. */
export async function filesByKey(db: Exec, link: FileLink, keys: string[]): Promise<Map<string, AttachedFile[]>> {
  const out = new Map<string, AttachedFile[]>();
  if (keys.length === 0) return out;
  const res = await db.execute<{ k: string; id: string; mime: string | null; size_bytes: string }>(sql`
    SELECT f.${sql.identifier(link.col)} AS k, m.id, m.mime, m.size_bytes FROM ${sql.identifier(link.table)} f JOIN media_assets m ON m.id = f.media_id
    WHERE f.${sql.identifier(link.col)} = ANY(${uuids(keys)}) AND m.status = 'ready' ORDER BY f.${sql.identifier(link.col)}, f.position`);
  for (const r of res.rows) out.set(r.k, [...(out.get(r.k) ?? []), toFile(r)]);
  return out;
}

/**
 * Replaces the files of one object: the new ones are linked in order, the dropped ones are deleted
 * (rows now, stored objects after commit through `deleteObjects` with the returned keys).
 */
export async function replaceFiles(tx: Exec, link: FileLink, userId: string, purpose: MediaPurpose, key: string, ids: string[]): Promise<string[]> {
  const t = sql.identifier(link.table);
  const c = sql.identifier(link.col);
  // Files already linked to this object keep their owner (a teammate may have uploaded them); only the new ones must be the caller's.
  const linked = ids.length > 0 ? await tx.execute<{ media_id: string }>(sql`SELECT media_id FROM ${t} WHERE ${c} = ${key}::uuid AND media_id = ANY(${uuids(ids)})`) : { rows: [] };
  const kept = new Set(linked.rows.map((r) => r.media_id));
  await assertOwnReady(tx, userId, purpose, ids.filter((id) => !kept.has(id)));
  if (new Set(ids).size !== ids.length) throw invalidAsset('assetIds', 'duplicate file');
  // A file already attached to another object would be deleted with this one: refuse reuse.
  if (ids.length > 0) {
    const used = await tx.execute(sql`SELECT 1 FROM ${t} WHERE media_id = ANY(${uuids(ids)}) AND ${c} <> ${key}::uuid LIMIT 1`);
    if (used.rows.length > 0) throw invalidAsset('assetIds', 'file already attached elsewhere');
  }
  const gone = await tx.execute<{ storage_key: string }>(sql`
    DELETE FROM media_assets WHERE id IN (SELECT media_id FROM ${t} WHERE ${c} = ${key}::uuid ${ids.length > 0 ? sql`AND media_id <> ALL(${uuids(ids)})` : sql``}) RETURNING storage_key`);
  await tx.execute(sql`DELETE FROM ${t} WHERE ${c} = ${key}::uuid`);
  for (const [position, id] of ids.entries()) await tx.execute(sql`INSERT INTO ${t} (${c}, media_id, position) VALUES (${key}::uuid, ${id}::uuid, ${position})`);
  return gone.rows.map((r) => r.storage_key);
}

/** Best effort after commit: a missing object is not an error, a leftover is cleaned with the account. */
export async function deleteObjects(storage: MediaStorage, keys: string[]): Promise<void> {
  const res = await Promise.allSettled(keys.map((k) => storage.delete(k)));
  res.forEach((r, i) => {
    if (r.status === 'rejected') logger.warn(`Storage delete failed for ${keys[i]}: ${String(r.reason)}`);
  });
}
