import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCodes,
  type PlatformRole,
  type SearchOrgHit,
  type SearchPostHit,
  type SearchProductHit,
  type SearchQuery,
  type SearchResult,
  type SearchScope,
  type SearchUserHit,
} from '@caselind/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { buyerVisibleSql, escapeLike } from '../catalog/catalog.shared.js';
import { DB, type Db } from '../db/db.module.js';
import { contentUrlOf } from '../media/media.service.js';
import { orgOwnerNotBlockedSql } from '../places/places.service.js';
import { postVisibleSql } from '../social/post-visibility.js';
import { SearchHistoryService } from './search-history.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hits per category when `scope=all`. */
export const ALL_SCOPE_LIMIT = 5;

const badCursor = () =>
  new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'cursor', message: 'invalid cursor' }]);

interface Cursor {
  rank: number;
  key: string;
  id: string;
}
const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify([c.rank, c.key, c.id])).toString('base64url');
function decodeCursor(cursor: string, keyIsTime: boolean): Cursor {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      Number.isInteger(v[0]) &&
      typeof v[1] === 'string' &&
      typeof v[2] === 'string' &&
      UUID_RE.test(v[2]) &&
      (!keyIsTime || !Number.isNaN(Date.parse(v[1])))
    ) {
      return { rank: v[0] as number, key: v[1], id: v[2] };
    }
  } catch {
    // fall through
  }
  throw badCursor();
}

/** Normalised query: lower-case, with the LIKE patterns for prefix and contains. */
interface Needle {
  exact: string;
  prefix: string;
  contains: string;
}
function needleOf(text: string): Needle {
  const lower = text.toLowerCase();
  const esc = escapeLike(lower);
  return { exact: lower, prefix: `${esc}%`, contains: `%${esc}%` };
}

/** 0 = exact, 1 = prefix, 2 = contains, over one or several lower-cased text expressions. */
function rankSql(n: Needle, exprs: SQL[]): SQL {
  const any = (f: (e: SQL) => SQL) => sql.join(exprs.map(f), sql` OR `);
  return sql`CASE WHEN ${any((e) => sql`${e} = ${n.exact}`)} THEN 0 WHEN ${any((e) => sql`${e} LIKE ${n.prefix}`)} THEN 1 ELSE 2 END`;
}
const matchSql = (n: Needle, exprs: SQL[]): SQL => sql`(${sql.join(exprs.map((e) => sql`${e} LIKE ${n.contains}`), sql` OR `)})`;

interface Ranked {
  rank: number;
  sk: string;
  id: string;
}

/**
 * Universal search (C-09). Ranking is the same everywhere and documented in the contract: exact
 * match first, then prefix, then contains; ties by name (users, organisations, products) or by
 * newest (posts). Matching is a case-insensitive LIKE over lower(column) so the optional
 * `pg_trgm` indexes (migration 0016) serve it; without the extension it is a sequential scan.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly history: SearchHistoryService,
  ) {}

  async search(viewerId: string, roles: readonly PlatformRole[], q: SearchQuery): Promise<SearchResult> {
    if (q.scope === 'all' && q.cursor) throw badCursor();
    const limit = q.scope === 'all' ? ALL_SCOPE_LIMIT : q.limit;
    const scopes: Exclude<SearchScope, 'all'>[] = q.scope === 'all' ? ['users', 'orgs', 'products', 'posts'] : [q.scope];
    const out: SearchResult = { scope: q.scope };
    await Promise.all(
      scopes.map(async (s) => {
        if (s === 'users') out.users = await this.users(viewerId, q.q, limit, q.cursor);
        else if (s === 'orgs') out.orgs = await this.orgs(viewerId, q.q, limit, q.cursor);
        else if (s === 'products') out.products = await this.products(viewerId, q.q, limit, q.cursor);
        else out.posts = await this.posts(viewerId, roles, q.q, limit, q.cursor);
      }),
    );
    // Only the first page of a search is remembered (never the pages that follow it).
    if (!q.cursor) await this.history.record(viewerId, q.q, q.scope);
    return out;
  }

  // ---- categories ------------------------------------------------------------------------------

  private async users(viewerId: string, raw: string, limit: number, cursor?: string) {
    const handleOnly = raw.startsWith('@');
    const term = handleOnly ? raw.slice(1).trim() : raw;
    if (term.length === 0) return { items: [], nextCursor: null };
    const n = needleOf(term);
    const textCols = handleOnly ? [sql`lower(u.handle::text)`] : [sql`lower(u.handle::text)`, sql`lower(u.display_name)`];
    // Phone and e-mail are never searched by fragment: only an exact identifier of a user who allows it.
    const identifierHit = handleOnly
      ? sql`false`
      : sql`((u.discoverable_by_phone AND u.phone = ${raw}) OR (u.discoverable_by_email AND u.email = ${raw}::citext))`;
    const inner = sql`
      SELECT u.id, u.handle::text AS handle, u.display_name, u.avatar_url,
             CASE WHEN ${identifierHit} THEN 0 ELSE ${rankSql(n, textCols)} END AS rank,
             lower(u.handle::text) AS sk
      FROM users u
      WHERE u.status = 'active' AND u.id <> ${viewerId}::uuid
        AND (${matchSql(n, textCols)} OR ${identifierHit})
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}::uuid))`;
    const { rows, nextCursor } = await this.page<Ranked & { handle: string; display_name: string; avatar_url: string | null }>(
      inner, limit, cursor, { time: false, newestFirst: false },
    );
    const items: SearchUserHit[] = rows.map((r) => ({ id: r.id, handle: r.handle, displayName: r.display_name, avatarUrl: r.avatar_url }));
    return { items, nextCursor };
  }

  private async orgs(viewerId: string, raw: string, limit: number, cursor?: string) {
    const n = needleOf(raw);
    const nameCols = [sql`lower(o.name)`, sql`lower(o.slug::text)`];
    const inner = sql`
      SELECT o.id, o.slug::text AS slug, o.name, o.kind, o.logo_url, o.city, (o.verification_status = 'verified') AS verified,
             ${rankSql(n, nameCols)} AS rank, lower(o.name) AS sk
      FROM organizations o
      WHERE o.status = 'active' AND o.visibility = 'public'
        AND (${matchSql(n, [...nameCols, sql`lower(o.city)`])})
        AND ${orgOwnerNotBlockedSql(viewerId)}`;
    const { rows, nextCursor } = await this.page<
      Ranked & { slug: string; name: string; kind: SearchOrgHit['kind']; logo_url: string | null; city: string | null; verified: boolean }
    >(inner, limit, cursor, { time: false, newestFirst: false });
    const items: SearchOrgHit[] = rows.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, kind: r.kind, logoUrl: r.logo_url, city: r.city, verified: r.verified,
    }));
    return { items, nextCursor };
  }

  /** Same visibility as the storefront (published, not hidden, active public org, seller not blocked). */
  private async products(viewerId: string, raw: string, limit: number, cursor?: string) {
    const n = needleOf(raw);
    const title = [sql`lower(p.title)`];
    const inner = sql`
      SELECT p.id, p.title, s.min_price, s.currency,
             (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS cover,
             o.id AS org_id, o.slug::text AS org_slug, o.name AS org_name,
             CASE WHEN lower(p.title) = ${n.exact} THEN 0 WHEN lower(p.title) LIKE ${n.prefix} THEN 1
                  WHEN lower(p.title) LIKE ${n.contains} THEN 2 ELSE 3 END AS rank,
             lower(p.title) AS sk
      FROM products p
      JOIN organizations o ON o.id = p.org_id
      JOIN LATERAL (
        SELECT (array_agg(v.price_minor ORDER BY v.price_minor, v.id))[1] AS min_price,
               (array_agg(v.currency ORDER BY v.price_minor, v.id))[1] AS currency
        FROM product_variants v WHERE v.product_id = p.id AND v.active
      ) s ON s.min_price IS NOT NULL
      WHERE ${buyerVisibleSql(viewerId)}
        AND (${matchSql(n, [...title, sql`lower(p.description)`])})`;
    const { rows, nextCursor } = await this.page<
      Ranked & { title: string; min_price: string | number; currency: string; cover: string | null; org_id: string; org_slug: string; org_name: string }
    >(inner, limit, cursor, { time: false, newestFirst: false });
    const items: SearchProductHit[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      coverUrl: r.cover ? contentUrlOf(r.cover) : null,
      minPriceMinor: Number(r.min_price),
      currency: r.currency,
      org: { id: r.org_id, slug: r.org_slug, name: r.org_name },
    }));
    return { items, nextCursor };
  }

  /** Only posts the caller may see (the feed's visibility matrix: `postVisibleSql`). */
  private async posts(viewerId: string, roles: readonly PlatformRole[], raw: string, limit: number, cursor?: string) {
    const n = needleOf(raw);
    const body = [sql`lower(posts.body)`];
    const inner = sql`
      SELECT posts.id, posts.author_id, users.handle::text AS author_handle, users.display_name AS author_display_name,
             left(posts.body, 200) AS snippet,
             ${rankSql(n, body)} AS rank, posts.created_at::text AS sk, posts.created_at::text AS created_at
      FROM posts JOIN users ON users.id = posts.author_id
      WHERE posts.body IS NOT NULL AND ${matchSql(n, body)} AND ${postVisibleSql(viewerId, roles)}`;
    const { rows, nextCursor } = await this.page<
      Ranked & { author_id: string; author_handle: string; author_display_name: string; snippet: string; created_at: string }
    >(inner, limit, cursor, { time: true, newestFirst: true });
    const items: SearchPostHit[] = rows.map((r) => ({
      id: r.id,
      authorId: r.author_id,
      authorHandle: r.author_handle,
      authorDisplayName: r.author_display_name,
      snippet: r.snippet,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return { items, nextCursor };
  }

  /**
   * Keyset pagination over (rank asc, sort key, id). `inner` must select `rank`, `sk` and `id`.
   * The sort key is text (lower-cased name) or, for posts, a timestamp compared as such.
   */
  private async page<T extends Ranked>(
    inner: SQL,
    limit: number,
    cursor: string | undefined,
    opts: { time: boolean; newestFirst: boolean },
  ): Promise<{ rows: T[]; nextCursor: string | null }> {
    const cast = opts.time ? sql`timestamptz` : sql`text`;
    const op = opts.newestFirst ? sql`<` : sql`>`;
    let cursorSql = sql``;
    if (cursor) {
      const c = decodeCursor(cursor, opts.time);
      cursorSql = sql`WHERE (t.rank > ${c.rank}
        OR (t.rank = ${c.rank} AND (t.sk::${cast} ${op} ${c.key}::${cast}
             OR (t.sk::${cast} = ${c.key}::${cast} AND t.id ${op} ${c.id}::uuid))))`;
    }
    const dir = opts.newestFirst ? sql`DESC` : sql`ASC`;
    const res = await this.db.execute(sql`
      SELECT * FROM (${inner}) t ${cursorSql}
      ORDER BY t.rank ASC, t.sk::${cast} ${dir}, t.id ${dir}
      LIMIT ${limit + 1}`);
    const rows = res.rows as unknown as T[];
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    return {
      rows: pageRows,
      nextCursor: rows.length > limit && last ? encodeCursor({ rank: Number(last.rank), key: last.sk, id: last.id }) : null,
    };
  }
}
