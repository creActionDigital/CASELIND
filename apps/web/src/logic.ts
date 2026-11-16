export type Route = { name: 'home' } | { name: 'shop'; slug: string } | { name: 'notfound' };

/** `/` is the landing page, `/s/<slug>` a public business page; anything else is not found. */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return { name: 'home' };
  const m = /^\/s\/([a-z0-9][a-z0-9-]{0,62})$/.exec(clean);
  return m ? { name: 'shop', slug: m[1]! } : { name: 'notfound' };
}

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

/** "08:00–12:00, 14:00–18:00", or null when the day has no interval (closed). */
export function formatDay(intervals: { open: string; close: string }[] | undefined): string | null {
  return intervals && intervals.length > 0 ? intervals.map((i) => `${i.open}–${i.close}`).join(', ') : null;
}

/** Only https links are ever rendered as links (the API already enforces it; this is the second lock). */
export const safeHttps = (url: string | null): string | null => (url && /^https:\/\//i.test(url) ? url : null);
