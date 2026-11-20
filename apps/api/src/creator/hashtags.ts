import { HASHTAG_MAX_LENGTH, HASHTAGS_PER_POST_MAX } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../commerce/catalog.port.js';

// A tag starts after a space or punctuation (not after a letter, `/`, `&` or `#`), is made of letters (any script),
// digits and `_`, and is not followed by another word character: a tag longer than 40 characters is ignored.
const TAG_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_/&#])#([\p{L}\p{N}_]{1,${HASHTAG_MAX_LENGTH}})(?![\p{L}\p{N}_#])`, 'gu');

/** Distinct lowercase tags of a text, in order of appearance, at most 10; a tag with no letter (`#123`) is not a tag. */
export function parseHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const tags: string[] = [];
  for (const m of text.normalize('NFC').matchAll(TAG_RE)) {
    const tag = m[1]!.toLowerCase();
    if (!/\p{L}/u.test(tag) || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= HASHTAGS_PER_POST_MAX) break;
  }
  return tags;
}

/** Replaces the tags of a post by those of its text (call inside the transaction that writes the post). */
export async function replacePostHashtags(ex: DbExecutor, postId: string, body: string | null | undefined): Promise<void> {
  const tags = parseHashtags(body);
  await ex.execute(sql`DELETE FROM post_hashtags WHERE post_id = ${postId}::uuid`);
  if (tags.length === 0) return;
  await ex.execute(sql`
    INSERT INTO post_hashtags (post_id, tag) VALUES ${sql.join(tags.map((t) => sql`(${postId}::uuid, ${t})`), sql`, `)}
    ON CONFLICT DO NOTHING`);
}
