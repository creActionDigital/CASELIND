/** Header names that carry a secret and must never reach the logs (in addition to authorization and cookies). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-qr-session-secret"]',
  'res.headers["set-cookie"]',
];

/** Routes whose query string holds a user's position, typed search or AI assistant text (defence in depth: bodies are never logged): it is dropped from request logs. */
const PRIVATE_QUERY_ROUTES = /^\/(?:v\d+\/)?(?:places|search|ai|me\/ai-settings)(?:\/|$)/;

export function scrubLogUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const at = url.indexOf('?');
  if (at < 0) return url;
  return PRIVATE_QUERY_ROUTES.test(url.slice(0, at)) ? `${url.slice(0, at)}?[redacted]` : url;
}

/** pino-http request serializer wrapper: same object, with the private query string removed. */
export function scrubLoggedRequest<T extends { url?: string; query?: unknown }>(req: T): T {
  const url = scrubLogUrl(req.url);
  if (url === req.url) return req;
  const { query: _query, ...rest } = req;
  return { ...rest, url } as T;
}
