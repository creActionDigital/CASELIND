export type SocialTarget =
  | { pathname: '/post/[postId]'; params: { postId: string } }
  | { pathname: '/user/[userId]'; params: { userId: string } };

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Destination d'une notification `social` d'après son `data` : la publication si elle y figure, sinon le profil de l'acteur. */
export function socialTarget(data: unknown): SocialTarget | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const postId = str(d.postId);
  if (postId) return { pathname: '/post/[postId]', params: { postId } };
  const actorId = str(d.actorId);
  if (actorId) return { pathname: '/user/[userId]', params: { userId: actorId } };
  return null;
}
