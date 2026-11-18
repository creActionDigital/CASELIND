import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export interface WebhookPostRequest {
  url: URL;
  /** Already verified address to connect to: no second resolution happens. */
  address: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

/** Network side of the webhooks; replaced in tests (nothing in the suite ever touches the network). */
export interface WebhookTransport {
  lookup(host: string): Promise<string[]>;
  post(req: WebhookPostRequest): Promise<{ status: number }>;
}

/** Thrown by `post` implementations on a timeout, so the journal can tell it from other network errors. */
export class WebhookTimeoutError extends Error {}

export class NodeWebhookTransport implements WebhookTransport {
  async lookup(host: string): Promise<string[]> {
    // shortcut: the OS lookup keeps its thread until it answers; the race only frees this caller. Use a dns.Resolver with a timeout if it ever matters.
    const rows = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new WebhookTimeoutError('dns lookup timed out')), 3000).unref()),
    ]);
    return rows.map((r) => r.address);
  }

  /**
   * Connects to `address` (SNI and Host keep the hostname so the certificate is still checked against it). Redirects are
   * never followed, the response is not read: the status line is enough and the socket is destroyed.
   */
  post({ url, address, headers, body, timeoutMs }: WebhookPostRequest): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const secure = url.protocol === 'https:';
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const req = (secure ? https : http).request(
        {
          host: address,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          agent: false,
          servername: secure && !isIP(host) ? host : undefined,
          headers: { ...headers, Host: url.host, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'User-Agent': 'Caselind-Webhooks/1' },
        },
        (res) => {
          clearTimeout(timer);
          res.destroy();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      const timer = setTimeout(() => req.destroy(new WebhookTimeoutError('timeout')), timeoutMs);
      req.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end(body);
    });
  }
}
