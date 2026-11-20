/**
 * CASELIND mini-app starter (one file, Node 20+, no framework).
 *
 * What the platform does FOR you: consent screen, PKCE check, exact redirect_uri match, scopes, quotas, token rotation,
 * PIN confirmation of payments, signed events, notification limits. What you write: the handlers below.
 *
 * Set CASELIND_API, CLIENT_ID, CLIENT_SECRET, PUBLIC_URL (https; register PUBLIC_URL + "/callback" as redirect URI)
 * and WEBHOOK_SECRET.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { CaselindClient, CaselindWebhookError, type PendingAuthorization, type Tokens, verifyWebhook } from '@caselind/sdk';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const PUBLIC_URL = env('PUBLIC_URL');

// Demo storage: replace with your database. Key everything on `sub` (your private id of the user), never on a name.
const pending = new Map<string, PendingAuthorization>(); // state -> PKCE verifier
const sessions = new Map<string, Tokens>(); // your own session id -> CASELIND tokens

const newClient = (tokens?: Tokens): CaselindClient => {
  const client = new CaselindClient({
    baseUrl: env('CASELIND_API'),
    clientId: env('CLIENT_ID'),
    clientSecret: env('CLIENT_SECRET'), // server side only
    redirectUri: `${PUBLIC_URL}/callback`,
    // Native consent screen of the CASELIND app (deep link opened on the user's phone).
    authorizeUrl: 'caselind://miniapps/consent',
    // Refresh tokens rotate: always persist the latest ones.
    onTokens: (t) => void sessions.set('demo', t),
  });
  if (tokens) client.setTokens(tokens);
  return client;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  try {
    // 1. Send the user to the native consent screen.
    if (url.pathname === '/login') {
      const p = await newClient().beginAuthorization(['profile.basic', 'wallet.pay', 'notify']);
      pending.set(p.state, p);
      res.writeHead(302, { location: p.url }).end();
      return;
    }
    // 2. Callback: the platform redirects here with ?code&state (or ?error=access_denied when the user refuses).
    if (url.pathname === '/callback') {
      const p = pending.get(url.searchParams.get('state') ?? '');
      if (!p) return void res.writeHead(400).end('unknown state');
      pending.delete(p.state);
      await newClient().completeAuthorization(url.toString(), p); // checks the state, exchanges the code (PKCE)
      res.writeHead(302, { location: '/me' }).end();
      return;
    }
    // 3. A profile call: `id` is YOUR identifier for this user (stable, different in every app).
    if (url.pathname === '/me') {
      const client = newClient(sessions.get('demo'));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await client.me()));
      return;
    }
    // 4. A payment: the user confirms with their PIN inside CASELIND; you only learn the outcome.
    if (url.pathname === '/pay') {
      const client = newClient(sessions.get('demo'));
      const out = await client.requestPayment({ amountMinor: 1500, currency: 'USD', description: 'Commande' }, { onPending: () => console.log('waiting for the PIN') });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: out.status }));
      return;
    }
    // 5. Events from CASELIND. ALWAYS verify first: signature + clock tolerance. Answer 2xx only once handled.
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      const event = await verifyWebhook(raw, req.headers, env('WEBHOOK_SECRET'));
      switch (event.event) {
        case 'authorization.revoked':
        case 'user.data_deletion_requested':
          // The user withdrew access or is erasing their account: delete everything you hold about event.data.sub.
          console.log('purge', event.data.sub);
          break;
        case 'payment.confirmed':
          console.log('paid', event.data.clientRef, event.data.amountMinor);
          break;
        default:
          break;
      }
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end();
  } catch (err) {
    if (err instanceof CaselindWebhookError) return void res.writeHead(400).end('bad signature');
    console.error(err);
    res.writeHead(500).end('error');
  }
}).listen(Number(process.env.PORT ?? 3000));
