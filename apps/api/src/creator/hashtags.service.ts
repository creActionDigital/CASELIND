import { Inject, Injectable } from '@nestjs/common';
import { HASHTAG_MAX_LENGTH, type HashtagCount, type HashtagList, type PlatformRole, type PopularCreatorList, type PostList, type SocialPageQuery } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { posts } from '../db/schema.js';
import { PostsService } from '../social/posts.service.js';
import { validationError } from '../social/social.shared.js';

const TRENDING_MAX = 20;
const SUGGEST_MAX = 10;
const TAG_PARAM_RE = new RegExp(String.raw`^[\p{L}\p{N}_]{1,${HASHTAG_MAX_LENGTH}}$`, 'u');

/** Counted posts: public, not hidden, not deleted, by an active author the viewer has no block with. */
const publicVisible = (viewerId: string) => sql`(
  p.visibility = 'public' AND NOT p.hidden AND p.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id AND u.status = 'active')
  AND NOT EXISTS (SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = ${viewerId}::uuid)))`;

/** Trending tags, tag suggestions and the posts of a tag. */
@Injectable()
export class HashtagsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly posts: PostsService,
  ) {}

  async trending(viewerId: string, hours: number): Promise<HashtagList> {
    const res = await this.db.execute<{ tag: string; n: number }>(sql`
      SELECT h.tag, count(*)::int AS n FROM post_hashtags h JOIN posts p ON p.id = h.post_id
      WHERE p.created_at > now() - (${hours} * interval '1 hour') AND ${publicVisible(viewerId)}
      GROUP BY h.tag ORDER BY n DESC, h.tag LIMIT ${TRENDING_MAX}`);
    return { hours, items: res.rows.map((r): HashtagCount => ({ tag: r.tag, postsCount: r.n })) };
  }

  /** Les 20 comptes actifs les plus suivis qui ont publie ; ni moi, ni un compte bloque dans un sens ou dans l'autre. */
  async popularCreators(viewerId: string): Promise<PopularCreatorList> {
    const res = await this.db.execute<{ id: string; handle: string; display_name: string; avatar_url: string | null; f: number; p: number }>(sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.avatar_url,
             (SELECT count(*)::int FROM follows f WHERE f.followee_id = u.id) AS f,
             (SELECT count(*)::int FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public' AND NOT p.hidden AND p.deleted_at IS NULL) AS p
      FROM users u
      WHERE u.status = 'active' AND u.id <> ${viewerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}::uuid))
        AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public' AND NOT p.hidden AND p.deleted_at IS NULL)
      ORDER BY f DESC, p DESC, u.id LIMIT 20`);
    return { items: res.rows.map((r) => ({ userId: r.id, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url, followersCount: r.f, postsCount: r.p })) };
  }

  /** Tags starting with the typed text (a leading # is ignored), most used first. */
  async suggest(viewerId: string, q: string): Promise<HashtagList> {
    const prefix = q.replace(/^#/, '').toLowerCase().normalize('NFC');
    if (!TAG_PARAM_RE.test(prefix)) return { hours: 0, items: [] };
    const like = `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
    const res = await this.db.execute<{ tag: string; n: number }>(sql`
      SELECT h.tag, count(*)::int AS n FROM post_hashtags h JOIN posts p ON p.id = h.post_id
      WHERE h.tag LIKE ${like} AND ${publicVisible(viewerId)}
      GROUP BY h.tag ORDER BY n DESC, h.tag LIMIT ${SUGGEST_MAX}`);
    return { hours: 0, items: res.rows.map((r): HashtagCount => ({ tag: r.tag, postsCount: r.n })) };
  }

  /** Posts carrying the tag that the viewer may see, newest first. */
  tagPosts(viewerId: string, roles: readonly PlatformRole[], rawTag: string, q: SocialPageQuery): Promise<PostList> {
    const tag = rawTag.replace(/^#/, '').toLowerCase().normalize('NFC');
    if (!TAG_PARAM_RE.test(tag)) throw validationError('tag', 'invalid hashtag');
    return this.posts.page(viewerId, roles, q, sql`${posts.id} IN (SELECT post_id FROM post_hashtags WHERE tag = ${tag})`);
  }
}
