import type { MediaAssetRow } from '../db/schema.js';

/**
 * Who may read a READY asset's metadata and content. The single place for the media read policy.
 *
 * - Profile and catalogue images, posts and stories: any signed-in user (their visibility rules,
 *   e.g. blocks or private posts, belong to the lots that publish them).
 * - Message attachments and documents: the owner only for now. The messaging lot extends this
 *   with "participant of a conversation the asset was sent in" (it will then need a lookup).
 */
export function canRead(viewerId: string, asset: Pick<MediaAssetRow, 'ownerUserId' | 'purpose'>): boolean {
  if (asset.ownerUserId === viewerId) return true;
  switch (asset.purpose) {
    case 'avatar':
    case 'org_logo':
    case 'org_banner':
    case 'product':
    case 'post':
    case 'story':
      return true;
    case 'message':
    case 'document':
      return false;
  }
}
