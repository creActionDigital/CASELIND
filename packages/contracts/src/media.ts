import { z } from 'zod';

/** What an uploaded file is for. It drives the accepted types and who may read it. */
export const mediaPurposeSchema = z.enum([
  'avatar',
  'post',
  'message',
  'story',
  'org_logo',
  'org_banner',
  'product',
  'document',
  /** Identity documents (lot 6B): readable by the owner and admins only. */
  'kyc_document',
  /** Classified-ad photos (lot 15): readable by any signed-in user. */
  'listing',
  /** Lot 19m: the PDF of a CV (owner + organisations applied to), delivery files of a freelance milestone (both parties), lesson files (enrolled learners + author). */
  'cv',
  'delivery',
  'lesson',
  /** Storefront gallery (CDC §5): photos and videos, readable by any signed-in user like product images. */
  'org_gallery',
]);
export type MediaPurpose = z.infer<typeof mediaPurposeSchema>;

/**
 * Every type the API accepts. The server detects the real type from the file's first bytes and
 * refuses anything else (SVG, HTML, executables...), whatever the client declares.
 */
export const mediaMimeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'application/pdf',
]);
export type MediaMime = z.infer<typeof mediaMimeSchema>;

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** image/video/audio by top-level type; application/pdf is a document. Size limits are per kind. */
export function mediaKindOf(mime: MediaMime): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const VIDEOS = ['video/mp4', 'video/webm'] as const;
const AUDIO = ['audio/mp4', 'audio/ogg', 'audio/mpeg'] as const;

/** Accepted types per purpose (CDC §6, §29). */
export const MEDIA_ALLOWED_MIMES: Readonly<Record<MediaPurpose, readonly MediaMime[]>> = {
  avatar: IMAGES,
  org_logo: IMAGES,
  org_banner: IMAGES,
  product: IMAGES,
  listing: IMAGES,
  post: [...IMAGES, ...VIDEOS],
  story: [...IMAGES, ...VIDEOS],
  message: [...IMAGES, ...VIDEOS, ...AUDIO, 'application/pdf'],
  document: ['application/pdf'],
  kyc_document: [...IMAGES, 'application/pdf'],
  cv: ['application/pdf'],
  delivery: [...IMAGES, 'application/pdf'],
  lesson: [...IMAGES, ...VIDEOS, 'application/pdf'],
  org_gallery: [...IMAGES, ...VIDEOS],
};

/** Per-purpose size cap in bytes (on top of the per-kind server limit); the lowest applies. */
export const MEDIA_PURPOSE_MAX_BYTES: Readonly<Partial<Record<MediaPurpose, number>>> = { cv: 5 * 1024 * 1024, delivery: 10 * 1024 * 1024 };

/** A file attached to a CV application, a milestone delivery or a lesson; fetch the bytes with GET contentUrl (bearer token). */
export const attachedFileSchema = z.object({ id: z.uuid(), mime: mediaMimeSchema, sizeBytes: z.number().int().nonnegative(), contentUrl: z.string() });
export type AttachedFile = z.infer<typeof attachedFileSchema>;
/** PUT .../files: replaces the attached files by these ready uploads of the caller (at most 3; an empty list removes them). Removed files are deleted. */
export const setFilesRequestSchema = z.object({ assetIds: z.array(z.uuid()).max(3) });
export type SetFilesRequest = z.infer<typeof setFilesRequestSchema>;

export function isMimeAllowedFor(purpose: MediaPurpose, mime: MediaMime): boolean {
  return MEDIA_ALLOWED_MIMES[purpose].includes(mime);
}

/**
 * POST /v1/media/uploads: announce a file before sending its bytes. `mime` is what the client
 * believes the file is; it must be allowed for the purpose and must match the detected type later.
 * The size limit per kind is server configuration: a larger `sizeBytes` is a 400.
 */
export const createUploadRequestSchema = z
  .object({
    purpose: mediaPurposeSchema,
    mime: mediaMimeSchema,
    sizeBytes: z.number().int().positive(),
  })
  .refine((v) => isMimeAllowedFor(v.purpose, v.mime), {
    path: ['mime'],
    message: 'this type is not accepted for this purpose',
  });
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/**
 * 201 answer. Send the raw bytes with `PUT {uploadUrl}`, the bearer token AND the header
 * `X-Upload-Token: {uploadToken}`, with `Content-Type: application/octet-stream` (or the file's
 * type), before `expiresAt`. At most `maxBytes` bytes are accepted (413 beyond): the announced
 * `sizeBytes`, so a file larger than announced is refused. An expired token is re-issued by
 * `POST /v1/media/uploads/{assetId}/token` while the upload is still pending (same shape).
 *
 * Per-user quotas (server configuration) make the announce a 409 `conflict` with
 * `details: {reason: 'quota_exceeded', quota: 'pending_uploads' | 'bytes', limit}`.
 */
export const createUploadResponseSchema = z.object({
  assetId: z.uuid(),
  uploadUrl: z.string(),
  uploadToken: z.string(),
  expiresAt: z.iso.datetime(),
  maxBytes: z.number().int().positive(),
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const mediaStatusSchema = z.enum(['pending', 'ready', 'rejected']);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

/** Metadata of an uploaded file. Non-owners only ever see `ready` assets. */
export const mediaAssetSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  purpose: mediaPurposeSchema,
  status: mediaStatusSchema,
  declaredMime: mediaMimeSchema,
  /** Detected from the content; null until the content has been accepted. */
  mime: mediaMimeSchema.nullable(),
  /** Declared size while pending, real size once ready. */
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
  /** GET this URL (with the bearer token) for the bytes; null unless ready. */
  contentUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  uploadedAt: z.iso.datetime().nullable(),
  /** Why the content was refused (owner only): unsupported_type, type_mismatch, too_large. */
  rejectedReason: z.string().nullable(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/**
 * What GET /v1/media/{id} returns to someone other than the owner (ready assets they may read):
 * no owner, checksum, declared type or upload details.
 */
export const mediaAssetPublicSchema = mediaAssetSchema.pick({
  id: true,
  purpose: true,
  mime: true,
  sizeBytes: true,
  contentUrl: true,
  createdAt: true,
});
export type MediaAssetPublic = z.infer<typeof mediaAssetPublicSchema>;

/** PATCH /v1/me/avatar: a ready `avatar` asset of the caller, or null to remove the avatar. */
export const setAvatarRequestSchema = z.object({
  assetId: z.uuid().nullable(),
});
export type SetAvatarRequest = z.infer<typeof setAvatarRequestSchema>;
