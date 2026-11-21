import type { Locale } from '../i18n';
import type { Post, PostAuthor, PostVisibility, ReactionCounts, ReactionType } from './types';

export const REACTION_TYPES: ReactionType[] = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

/** Publication telle que le cache la porte : une publication en cours d'envoi garde ses médias locaux. */
export type CachedPost = Post & {
  local?: 'sending' | 'failed';
  /** Avancement de l'envoi des médias, 0..1. */
  progress?: number;
  localMedia?: { uri: string; mime: string }[];
};

export interface PostPages {
  pages: { items: CachedPost[]; nextCursor: string | null }[];
  pageParams: unknown[];
}

// ---- date relative ---------------------------------------------------------------------------

/** « à l'instant », « 5 min », « 3 h », « 2 j », puis la date courte au-delà de 7 jours. */
export function formatRelativeTime(iso: string, locale: Locale, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Math.max(0, now.getTime() - d.getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return locale === 'fr' ? "à l'instant" : 'now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return locale === 'fr' ? `${days} j` : `${days} d`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- réactions -------------------------------------------------------------------------------

export function totalReactions(r: ReactionCounts): number {
  return r.like + r.love + r.haha + r.wow + r.sad + r.angry;
}

/** Nouvelle réaction après un appui : retaper la même réaction la retire. */
export function nextReaction(current: ReactionType | null, tapped: ReactionType): ReactionType | null {
  return current === tapped ? null : tapped;
}

/** Applique `next` comme réaction de l'utilisateur : retire l'ancienne du compteur, ajoute la nouvelle. */
export function withMyReaction<P extends Pick<Post, 'reactions' | 'myReaction'>>(post: P, next: ReactionType | null): P {
  if (post.myReaction === next) return post;
  const reactions = { ...post.reactions };
  if (post.myReaction) reactions[post.myReaction] = Math.max(0, reactions[post.myReaction] - 1);
  if (next) reactions[next] += 1;
  return { ...post, reactions, myReaction: next };
}

// ---- cache des listes de publications --------------------------------------------------------

export function mapPosts(data: PostPages | undefined, fn: (p: CachedPost) => CachedPost): PostPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map(fn) })) };
}

export function updatePost(data: PostPages | undefined, id: string, fn: (p: CachedPost) => CachedPost): PostPages | undefined {
  return mapPosts(data, (p) => (p.id === id ? fn(p) : p));
}

export function removePost(data: PostPages | undefined, id: string): PostPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.filter((p) => p.id !== id) })) };
}

/** Insère en tête de la première page, sans doublon (même id). */
export function prependPost(data: PostPages | undefined, post: CachedPost): PostPages | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  const items = [post, ...first.items.filter((p) => p.id !== post.id)];
  return { ...data, pages: [{ ...first, items }, ...rest.map((pg) => ({ ...pg, items: pg.items.filter((p) => p.id !== post.id) }))] };
}

export interface OptimisticInput {
  clientId: string;
  author: PostAuthor;
  body: string | null;
  visibility: PostVisibility;
  media: { uri: string; mime: string }[];
  now?: Date;
}

/** Publication provisoire : l'id est le `clientId`, remplacé par la réponse du serveur. */
export function buildOptimisticPost(i: OptimisticInput): CachedPost {
  const iso = (i.now ?? new Date()).toISOString();
  const video = i.media.some((m) => m.mime.startsWith('video/'));
  return {
    id: i.clientId,
    author: i.author,
    kind: i.media.length === 0 ? 'text' : video ? 'video' : 'media',
    body: i.body,
    visibility: i.visibility,
    media: [],
    reactions: { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 },
    myReaction: null,
    commentsCount: 0,
    moderation: 'visible',
    createdAt: iso,
    updatedAt: iso,
    local: 'sending',
    progress: 0,
    localMedia: i.media,
  };
}

/**
 * Remplace la publication provisoire (`clientId`) par celle du serveur. Si elle est absente (liste
 * rechargée entre-temps) la réponse est insérée en tête ; un doublon de l'id serveur est supprimé.
 */
export function mergeServerPost(data: PostPages | undefined, clientId: string, server: Post): PostPages | undefined {
  if (!data || data.pages.length === 0) return data;
  const has = data.pages.some((pg) => pg.items.some((p) => p.id === clientId));
  if (!has) return prependPost(data, server);
  let placed = false;
  const pages = data.pages.map((pg) => ({
    ...pg,
    items: pg.items.flatMap((p) => {
      if (p.id === clientId) {
        placed = true;
        return [server];
      }
      return p.id === server.id ? [] : [p];
    }),
  }));
  return placed ? { ...data, pages } : data;
}

// ---- commentaires ----------------------------------------------------------------------------

export interface CommentThread<C extends { id: string; replyToId: string | null }> {
  comment: C;
  replies: C[];
}

/**
 * Regroupe les commentaires chargés (plus anciens d'abord) en fils : un commentaire de premier niveau
 * puis ses réponses. Une réponse dont le parent n'est pas encore chargé est affichée en premier niveau.
 */
export function groupComments<C extends { id: string; replyToId: string | null }>(items: C[]): CommentThread<C>[] {
  const ids = new Set(items.map((c) => c.id));
  const threads = new Map<string, CommentThread<C>>();
  const order: CommentThread<C>[] = [];
  for (const c of items) {
    if (c.replyToId && ids.has(c.replyToId)) continue;
    const th = { comment: c, replies: [] as C[] };
    threads.set(c.id, th);
    order.push(th);
  }
  for (const c of items) {
    if (c.replyToId) threads.get(c.replyToId)?.replies.push(c);
  }
  return order;
}

/** Pourcentage entier d'un choix de sondage (0 sans vote). */
export const pollPercent = (votes: number, total: number): number => (total === 0 ? 0 : Math.round((votes / total) * 100));
