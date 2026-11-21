#!/usr/bin/env node
/**
 * Jeu de données de démonstration / QA. Passe uniquement par l'API HTTP de dev (http://localhost:3000/v1).
 * SQL uniquement pour : activer les drapeaux réglementés (santé, école, virements) et donner le rôle admin
 * à alice le temps de la validation du professionnel de santé.
 *
 * Usage :
 *   API_LOG=<chemin du journal de l'API> node scripts/seed-demo.mjs          # crée les données (drapeaux laissés ACTIFS pour les tests)
 *   node scripts/seed-demo.mjs --reset-flags                                  # remet les drapeaux réglementés à false et retire le rôle admin
 * Le canal OTP « console » écrit les codes dans le journal de l'API : le script lit API_LOG
 * (démarrer l'API ainsi : `node --env-file=.env dist/main.js > api.log 2>&1`).
 * Idempotent : un compte existant est reconnecté, un contenu déjà créé est repéré par
 * scripts/.seed-demo-state.json (à supprimer si la base est réinitialisée).
 *
 * Comptes (mot de passe TestPass-2026!) :
 *   alice@caselind.test  (existant)  propriétaire boutique « alice-boutique », annonce, offre d'emploi, mission, entreprise
 *   bob@caselind.test    (existant)  client : commandes, réservation, candidature, offre de prix
 *   carla@caselind.test  prestataire de service + freelance + livreuse
 *   david@caselind.test  enseignant (cours, quiz, examen blanc) + demandeur d'emploi
 *   emma@caselind.test   professionnelle de santé (médecin) validée
 *   frank@caselind.test  directeur d'école « ecole-demo » (classe + annonce)
 *   gina@caselind.test   élève / patiente
 *   hugo@caselind.test   conducteur de mobilité APPROUVÉ (KYC niveau 1 + validation admin) + covoiturage + lecteur du fil
 * Aussi : véhicule de location (org « demo-location », alice), mini-app approuvée « Démo Mini-App » (annuaire + consentement de bob).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:3000/v1';
const ORIGIN = new URL(API).origin;
const LOG = process.env.API_LOG;
const PWD = 'TestPass-2026!';
const DB = process.env.DATABASE_URL ?? 'postgres://postgres:caselind-dev-only@localhost:54329/caselind_utf8';
const STATE_FILE = new URL('./.seed-demo-state.json', import.meta.url);
const FLAGS = ['health', 'health.teleconsultation', 'health.prescriptions', 'school', 'wallet.p2p_transfer'];
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

async function sql(q, p = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}

if (process.argv.includes('--reset-flags')) {
  await sql(`UPDATE feature_flags SET enabled=false WHERE key = ANY($1)`, [FLAGS]);
  await sql(`UPDATE users SET roles = ARRAY['user'] WHERE email LIKE '%@caselind.test'`);
  console.log('Drapeaux réglementés remis à false, rôle admin retiré.');
  process.exit(0);
}

const results = [];
async function step(label, fn) {
  try { const r = await fn(); results.push(['OK', label]); return r; }
  catch (e) { results.push(['KO', `${label} -> ${e.message}`]); console.error('KO', label, e.message); return undefined; }
}
async function once(key, fn) {
  if (state[key]) return state[key];
  const v = await fn();
  state[key] = v; save();
  return v;
}
async function http(method, path, token, body, raw) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j?.error ?? j).slice(0, 300)}`);
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const device = { name: 'Seed script', platform: 'web' };

// ---------- comptes ----------
const tokens = {};
async function lastCode(identifier) {
  for (let i = 0; i < 20; i++) {
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes(`:${identifier} -> `));
    const m = lines.at(-1)?.match(/-> (\d{4,8})/);
    if (m) return m[1];
    await sleep(300);
  }
  throw new Error('code OTP introuvable dans API_LOG');
}
async function account(name, displayName) {
  const identifier = `${name}@caselind.test`;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await http('POST', '/auth/login', null, { identifier, password: PWD, device });
      tokens[name] = r.accessToken; return;
    } catch (e) {
      if (!String(e.message).includes(' 429 ')) break; // 429 : limite par minute, on attend
      await sleep(20000);
    }
  }
  if (!LOG) throw new Error('API_LOG requis pour créer les comptes');
  let reg; for (let i = 0; i < 6; i++) { try { reg = await http('POST', '/auth/register', null, { identifier, password: PWD, displayName, locale: 'fr', country: 'CD' }); break; } catch (e) { if (!String(e.message).includes(' 429 ')) throw e; await sleep(20000); } }
  const before = fs.readFileSync(LOG, 'utf8').length; void before;
  const code = await lastCode(identifier);
  const v = await http('POST', '/auth/otp/verify', null, { challengeId: reg.challengeId, code, device });
  tokens[name] = v.accessToken;
}
const T = (n) => tokens[n];
const me = async (n) => (await http('GET', '/me', T(n))).id;

// ---------- images ----------
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c, crcv = ~0; for (const x of buf) { c = (crcv ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return ~crcv >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function upload(name, purpose, color = [79, 70, 229], mime = 'image/png', content) {
  const buf = content ?? png(96, 96, color);
  const a = await http('POST', '/media/uploads', T(name), { purpose, mime, sizeBytes: buf.length });
  const url = a.uploadUrl.startsWith('http') ? a.uploadUrl : ORIGIN + a.uploadUrl;
  const r = await fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${T(name)}`, 'x-upload-token': a.uploadToken, 'content-type': 'application/octet-stream' }, body: buf });
  if (!r.ok) throw new Error(`upload ${r.status} ${await r.text()}`);
  return a.assetId;
}

const tomorrowAt = (h, plusDays = 1) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + plusDays); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

// ================= MAIN =================
await sql(`UPDATE feature_flags SET enabled=true WHERE key = ANY($1)`, [FLAGS]);
// Deux administrateurs (alice, hugo) : la double validation et la revue indépendante des mini-apps en exigent deux.
await sql(`UPDATE users SET roles = ARRAY['user','admin'] WHERE email IN ('alice@caselind.test','hugo@caselind.test')`);

for (const [n, d] of [['alice', 'Alice Mbala'], ['bob', 'Bob Kasongo'], ['carla', 'Carla Ndaye'], ['david', 'David Tshimanga'], ['emma', 'Dr Emma Lukusa'], ['frank', 'Frank Mutombo'], ['gina', 'Gina Kabila'], ['hugo', 'Hugo Banza']]) {
  await step(`compte ${n}`, () => account(n, d));
}
// l'accès admin d'alice et hugo a été donné après son éventuelle connexion : se reconnecter pour que le rôle soit dans le jeton
await step('reconnexion alice et hugo (rôle admin)', async () => {
  for (const n of ['alice', 'hugo']) tokens[n] = (await http('POST', '/auth/login', null, { identifier: `${n}@caselind.test`, password: PWD, device })).accessToken;
});
const id = {};
for (const n of Object.keys(tokens)) id[n] = await me(n);
await step('handles lisibles', async () => {
  for (const [n, h] of [['carla', 'carla_n'], ['david', 'david_t'], ['emma', 'dr_emma'], ['frank', 'frank_m'], ['gina', 'gina_k'], ['hugo', 'hugo_b']]) {
    await http('PATCH', '/me', T(n), { handle: h, bio: `Compte de démonstration ${n}` }).catch(() => {});
  }
  await http('PATCH', '/me', T('alice'), { bio: 'Boutique et petites annonces' }).catch(() => {});
});
const handle = {}; for (const n of Object.keys(tokens)) handle[n] = (await http('GET', '/me', T(n))).handle;

// ---------- avatars ----------
await step('avatars', async () => { for (const [n, c] of [['alice', [79, 70, 229]], ['bob', [16, 185, 129]], ['carla', [244, 114, 182]]]) { if (!state[`avatar_${n}`]) { await http('PATCH', '/me/avatar', T(n), { assetId: await upload(n, 'avatar', c) }); state[`avatar_${n}`] = 1; save(); } } });

// ---------- social ----------
await step('abonnements', async () => { for (const a of ['bob', 'carla', 'david', 'gina']) for (const b of ['alice', 'hugo']) await http('PUT', `/users/${id[b]}/follow`, T(a)).catch(() => {}); await http('PUT', `/users/${id.bob}/follow`, T('alice')).catch(() => {}); await http('PUT', `/users/${id.carla}/follow`, T('alice')).catch(() => {}); });
const posts = await step('publications du fil', () => once('posts', async () => {
  const ids = [];
  const img = await upload('alice', 'post', [250, 204, 21]);
  const data = [['alice', 'Bienvenue sur CASELIND ! Première publication de test.', []], ['alice', 'Photo du jour au marché de Gombe', [img]], ['bob', 'Quelqu\'un connaît un bon plombier à Goma ?', []], ['carla', 'Je propose des services de ménage et de repassage.', []], ['hugo', 'Trajet Goma - Sake demain matin, 2 places.', []], ['david', 'Nouveau cours de mathématiques disponible, venez nombreux !', []]];
  for (const [n, body, mediaIds] of data) ids.push((await http('POST', '/posts', T(n), { clientId: randomUUID(), body, mediaIds, visibility: 'public' })).id);
  return ids;
}));
await step('réactions et commentaires', async () => {
  if (!posts || state.reacted) return;
  await http('PUT', `/posts/${posts[0]}/reaction`, T('bob'), { type: 'like' });
  await http('PUT', `/posts/${posts[0]}/reaction`, T('carla'), { type: 'love' });
  const c = await http('POST', `/posts/${posts[2]}/comments`, T('carla'), { body: 'Essaie Jean, très sérieux.' });
  await http('POST', `/posts/${posts[2]}/comments`, T('bob'), { body: 'Merci Carla !', replyToId: c.id });
  state.reacted = 1; save();
});
await step('statuts (stories)', async () => { if (state.stories) return; for (const [n, cap, col] of [['alice', 'Statut d\'Alice', [79, 70, 229]], ['bob', 'Statut de Bob', [16, 185, 129]], ['hugo', 'En route !', [239, 68, 68]]]) await http('POST', '/stories', T(n), { clientId: randomUUID(), mediaId: await upload(n, 'story', col), caption: cap, visibility: 'followers' }); state.stories = 1; save(); });
await step('signalement', async () => { if (state.report || !posts) return; await http('POST', '/reports', T('gina'), { targetType: 'post', targetId: posts[4], reason: 'spam', details: 'Test de signalement QA' }); state.report = 1; save(); });

// ---------- messagerie ----------
await step('conversations et messages', () => once('convs', async () => {
  const d = await http('POST', '/conversations', T('alice'), { kind: 'direct', userId: id.bob });
  for (const [n, b] of [['alice', 'Salut Bob, ta commande est prête.'], ['bob', 'Super, merci ! Je passe demain.'], ['alice', 'Parfait, à demain 👍']]) await http('POST', `/conversations/${d.id}/messages`, T(n), { clientId: randomUUID(), kind: 'text', body: b });
  const g = await http('POST', '/conversations', T('alice'), { kind: 'group', title: 'Voisins de Gombe', memberIds: [id.bob, id.carla, id.hugo] });
  await http('POST', `/conversations/${g.id}/messages`, T('carla'), { clientId: randomUUID(), kind: 'text', body: 'Bonjour à tous, réunion samedi.' });
  const m = await http('POST', `/conversations/${g.id}/messages`, T('hugo'), { clientId: randomUUID(), kind: 'text', body: 'Je serai là.' });
  await http('PUT', `/messages/${m.id}/reaction`, T('alice'), { emoji: '👍' }).catch(() => {});
  const d2 = await http('POST', '/conversations', T('gina'), { kind: 'direct', userId: id.alice });
  await http('POST', `/conversations/${d2.id}/messages`, T('gina'), { clientId: randomUUID(), kind: 'text', body: 'Bonjour, avez-vous encore le sac bleu ?' });
  return { direct: d.id, group: g.id };
}));

// ---------- boutique + commandes + livraison ----------
const shop = await step('boutique alice', () => once('shop', async () => {
  const org = await http('POST', '/orgs', T('alice'), { slug: 'alice-boutique', name: 'Boutique Alice', kind: 'shop', description: 'Vêtements, sacs et accessoires', country: 'CD', city: 'Kinshasa', address: '12 avenue de la Paix', phone: '+243810000001', visibility: 'public' }).catch(async () => (await http('GET', '/public/orgs/alice-boutique', T('alice'))));
  const orgId = org.id;
  const prods = [];
  const defs = [['T-shirt coton', 'T-shirt 100% coton', [['M', 1500], ['L', 1500]]], ['Sac à dos', 'Sac résistant 20L', [['bleu', 4500], ['noir', 4500]]], ['Casquette', 'Casquette réglable', [['unique', 1200]]], ['Sandales cuir', 'Sandales faites main', [['40', 3000], ['42', 3000], ['44', 3200]]]];
  for (const [t, d, vs] of defs) {
    const mediaIds = [await upload('alice', 'product', [Math.random() * 255, Math.random() * 255, 200].map(Math.floor))];
    const p = await http('POST', `/orgs/${orgId}/products`, T('alice'), { title: t, description: d, status: 'published', mediaIds, variants: vs.map(([o, price], i) => ({ sku: `${t.slice(0, 3).toUpperCase()}-${o}-${Date.now() % 100000}${i}`, options: { option: o }, priceMinor: price, currency: 'USD', stock: 25 })) });
    prods.push(p);
  }
  return { orgId, variantIds: prods.map((p) => p.variants.map((v) => v.id)) };
}));
if (shop) {
  await step('zone de livraison + coupon + fidélité', async () => {
    if (state.zone) return;
    await http('POST', `/orgs/${shop.orgId}/delivery-zones`, T('alice'), { name: 'Kinshasa centre', areas: ['Kinshasa', 'Gombe'], fees: { USD: 300 }, etaMinutes: 90 });
    await http('POST', `/orgs/${shop.orgId}/coupons`, T('alice'), { code: 'BIENVENUE10', kind: 'percent', value: 10 }).catch(() => {});
    await http('PUT', `/orgs/${shop.orgId}/loyalty`, T('alice'), { enabled: true, pointsPerUnit: 1, currency: 'USD', rewardText: '100 points = 1 café offert' }).catch(() => {});
    state.zone = 1; save();
  });
  await step('commandes de bout en bout', async () => {
    if (state.orders) return;
    const addr = { name: 'Bob Kasongo', phone: '+243810000002', city: 'Kinshasa', line1: '5 rue du Lac', notes: 'Sonner deux fois' };
    // commande 1 : livraison, jusqu'à livrée avec code de preuve
    await http('PUT', `/cart/items/${shop.variantIds[0][0]}`, T('bob'), { quantity: 2 });
    await http('PUT', `/cart/items/${shop.variantIds[1][0]}`, T('bob'), { quantity: 1 });
    const zones = (await http('GET', `/delivery/orgs/${shop.orgId}/zones`, T('bob'))).items;
    const c1 = await http('POST', '/orders/checkout', T('bob'), { clientId: randomUUID(), address: addr, paymentMethod: 'cash_on_delivery', fulfillment: 'delivery', zones: zones.length ? [{ orgId: shop.orgId, zoneId: zones[0].id }] : undefined });
    const o1 = c1.orders[0];
    for (const s of ['confirmed', 'preparing', 'shipped']) await http('POST', `/orgs/${shop.orgId}/orders/${o1.id}/status`, T('alice'), { status: s });
    const det = await http('GET', `/orders/${o1.id}`, T('bob'));
    if (det.delivery) {
      await http('POST', `/orgs/${shop.orgId}/deliveries/${det.delivery.id}/assign`, T('alice'), { courierUserId: id.carla }).catch((e) => console.error('assign', e.message));
      for (const s of ['picked_up', 'in_transit']) await http('POST', `/me/deliveries/${det.delivery.id}/status`, T('carla'), { status: s }).catch(() => {});
      await http('POST', `/me/deliveries/${det.delivery.id}/status`, T('carla'), { status: 'delivered', code: det.delivery.proofCode }).catch((e) => console.error('deliver', e.message));
    } else await http('POST', `/orgs/${shop.orgId}/orders/${o1.id}/status`, T('alice'), { status: 'delivered' });
    // commande 2 : en préparation ; commande 3 : annulée par le client
    await http('PUT', `/cart/items/${shop.variantIds[3][1]}`, T('bob'), { quantity: 1 });
    const o2 = (await http('POST', '/orders/checkout', T('bob'), { clientId: randomUUID(), address: addr, paymentMethod: 'cash_on_delivery', fulfillment: 'pickup' })).orders[0];
    await http('POST', `/orgs/${shop.orgId}/orders/${o2.id}/status`, T('alice'), { status: 'confirmed' });
    await http('PUT', `/cart/items/${shop.variantIds[2][0]}`, T('gina'), { quantity: 1 });
    const o3 = (await http('POST', '/orders/checkout', T('gina'), { clientId: randomUUID(), address: { ...addr, name: 'Gina Kabila' }, paymentMethod: 'cash_on_delivery', fulfillment: 'pickup' })).orders[0];
    await http('POST', `/orders/${o3.id}/cancel`, T('gina'), { note: 'Changement d\'avis' });
    // panier laissé rempli pour tester l'écran panier
    await http('PUT', `/cart/items/${shop.variantIds[1][1]}`, T('bob'), { quantity: 1 });
    state.orders = 1; save();
  });
  await step('livreuse : invitation, assignation, livraison', async () => {
    if (state.courier) return;
    await http('POST', `/orgs/${shop.orgId}/invitations`, T('alice'), { handle: handle.carla, role: 'delivery' }).catch((e) => console.error('invit', e.message));
    await http('POST', `/me/org-invitations/${shop.orgId}/accept`, T('carla')).catch((e) => console.error('accept', e.message));
    const del = (await http('GET', `/orgs/${shop.orgId}/deliveries`, T('alice'))).items.find((d) => d.status === 'pending' || d.status === 'assigned');
    if (!del) { state.courier = 1; save(); return; } // déjà traitée
    const full = await http('GET', `/orgs/${shop.orgId}/deliveries/${del.id}`, T('alice'));
    await http('POST', `/orgs/${shop.orgId}/deliveries/${del.id}/assign`, T('alice'), { courierUserId: id.carla });
    for (const s of ['picked_up', 'in_transit']) await http('POST', `/me/deliveries/${del.id}/status`, T('carla'), { status: s });
    let code = null; for (const o of (await http('GET', '/orders', T('bob'))).items) { const d = (await http('GET', `/orders/${o.id}`, T('bob'))).delivery; if (d?.id === del.id) code = d.proofCode; }
    await http('POST', `/me/deliveries/${del.id}/status`, T('carla'), { status: 'delivered', code });
    state.courier = 1; save();
  });
  await step('avis produit', async () => {
    if (state.review) return;
    const orders = (await http('GET', '/orders', T('bob'))).items;
    const done = orders.find((o) => o.status === 'delivered');
    if (done) { await http('POST', `/orders/${done.id}/delivery/rating`, T('bob'), { rating: 5, comment: 'Livraison rapide' }).catch(() => {}); }
    state.review = 1; save();
  });
  await step('documents vendeur (devis)', async () => { if (state.doc) return; await http('POST', `/orgs/${shop.orgId}/documents`, T('alice'), { kind: 'quote', customerName: 'Entreprise Tembo', currency: 'USD', lines: [{ description: 'Uniformes', quantity: 10, unitPriceMinor: 1500 }] }); state.doc = 1; save(); });
  await step('lieu (place) de la boutique', async () => { if (state.loc) return; await http('POST', `/orgs/${shop.orgId}/location`, T('alice'), { lat: -4.3276, lng: 15.3136, label: 'Boutique Alice, Gombe' }); state.loc = 1; save(); });
}

// ---------- service + réservation ----------
await step('profil service + offre + réservation', () => once('service', async () => {
  const cats = (await http('GET', '/service-categories', T('carla'))).items;
  await http('PUT', '/me/service-profile', T('carla'), { displayName: 'Carla Ménage Pro', bio: 'Ménage et repassage', city: 'Goma', skills: ['ménage', 'repassage'] });
  const s = await http('POST', '/me/services', T('carla'), { title: 'Ménage à domicile (2 h)', description: 'Nettoyage complet', categoryId: cats[0].id, priceKind: 'fixed', priceMinor: 2500, currency: 'USD', durationMin: 120, status: 'published', city: 'Goma', lat: -1.6585, lng: 29.2205 });
  await http('PUT', `/me/services/${s.id}/availability`, T('carla'), { rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '18:00' })), exceptions: [] });
  const from = new Date(Date.now() + 86400000).toISOString(); const to = new Date(Date.now() + 3 * 86400000).toISOString();
  const slots = (await http('GET', `/services/${s.id}/slots?from=${from}&to=${to}`, T('bob'))).items;
  const b = await http('POST', `/services/${s.id}/bookings`, T('bob'), { startsAt: slots[0].startsAt, note: 'Appartement 3 pièces' });
  await http('POST', `/bookings/${b.id}/confirm`, T('carla'));
  const b2 = await http('POST', `/services/${s.id}/bookings`, T('gina'), { startsAt: slots[3]?.startsAt ?? slots[1].startsAt });
  return { service: s.id, booking: b.id, pending: b2.id };
}));

// ---------- portefeuille sandbox ----------
await step('portefeuille : code PIN, recharge, transfert', async () => {
  if (state.wallet) return;
  await http('PUT', '/me/payment-pin', T('alice'), { pin: '482916', password: PWD }).catch(() => {});
  await http('POST', '/wallet/sandbox/topup', T('alice'), { clientId: randomUUID(), amountMinor: 8000, currency: 'USD' }).catch((e) => console.error('topup alice', e.message));
  await http('POST', '/wallet/sandbox/topup', T('bob'), { clientId: randomUUID(), amountMinor: 4000, currency: 'USD' }).catch((e) => console.error('topup bob', e.message));
  await http('POST', '/wallet/transfers', T('alice'), { clientId: randomUUID(), toHandle: handle.bob, amountMinor: 2500, currency: 'USD', note: 'Remboursement', pin: '482916' });
  state.wallet = 1; save();
});
await step('budget finance', async () => { await http('PUT', '/finance/budget', T('alice'), { currency: 'USD', limitMinor: 50000 }); });

// ---------- emploi ----------
await step('entreprise, offre, candidature, entretien', () => once('jobs', async () => {
  const org = await http('POST', '/orgs', T('alice'), { slug: 'alice-recrute', name: 'Alice Recrute', kind: 'other', country: 'CD', city: 'Kinshasa' }).catch(async () => http('GET', '/public/orgs/alice-recrute', T('alice')));
  const job = await http('POST', `/orgs/${org.id}/jobs`, T('alice'), { title: 'Comptable junior', description: 'Tenue de la comptabilité, 2 ans d\'expérience.', city: 'Kinshasa', contractType: 'full_time', salaryMinMinor: 40000, salaryMaxMinor: 60000, currency: 'USD' });
  await http('PUT', '/me/job-profile', T('bob'), { headline: 'Comptable', summary: 'Trois ans en cabinet', skills: ['Excel', 'Sage'], city: 'Kinshasa', experience: '3 ans', education: 'Licence en comptabilité' });
  await http('PUT', '/me/job-profile/cv', T('bob'), { assetId: await upload('bob', 'cv', null, 'application/pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')) }).catch((e) => console.error('cv', e.message));
  const app = await http('POST', `/jobs/${job.id}/applications`, T('bob'), { message: 'Candidature spontanée, disponible immédiatement.' });
  await http('POST', `/orgs/${org.id}/job-applications/${app.id}/status`, T('alice'), { status: 'shortlisted' });
  await http('POST', `/orgs/${org.id}/job-applications/${app.id}/interviews`, T('alice'), { startsAt: tomorrowAt(9, 3), durationMin: 30, location: 'Bureau, Gombe' }).catch((e) => console.error('interview', e.message));
  await http('POST', '/me/job-alerts', T('bob'), { q: 'comptable', city: 'Kinshasa' }).catch(() => {});
  return { orgId: org.id, jobId: job.id };
}));

// ---------- freelance ----------
await step('profil freelance, mission, proposition, contrat', () => once('freelance', async () => {
  await http('PUT', '/me/freelance-profile', T('carla'), { enabled: true, title: 'Rédactrice et traductrice', skills: ['rédaction', 'traduction'], categories: ['redaction', 'traduction'], rateMinor: 2000, rateCurrency: 'USD', bio: 'Dix ans d\'expérience.' });
  const m = await http('POST', '/missions', T('alice'), { category: 'redaction', title: 'Rédaction de 5 fiches produit', description: 'Fiches pour la boutique, ton chaleureux.', budgetMinor: 15000, currency: 'USD' });
  const p = await http('POST', `/missions/${m.id}/proposals`, T('carla'), { amountMinor: 14000, deliveryDays: 5, message: 'Je peux livrer en 5 jours.' });
  const m2 = await http('POST', '/missions', T('bob'), { category: 'design', title: 'Logo pour atelier de couture', description: 'Logo simple et moderne.', budgetMinor: 8000, currency: 'USD' });
  const acc = await http('POST', `/proposals/${p.id}/accept`, T('alice'), {});
  const contractId = acc.contractId ?? acc.id ?? acc.contract?.id;
  return { mission: m.id, mission2: m2.id, contract: contractId };
}));

// ---------- éducation ----------
await step('cours, quiz, examen blanc, inscription', () => once('course', async () => {
  const c = await http('POST', '/courses', T('david'), { title: 'Mathématiques niveau 1', description: 'Les bases : calcul, fractions, géométrie.', level: 'beginner', language: 'fr' });
  await http('PUT', `/courses/${c.id}/lessons`, T('david'), { lessons: [{ title: 'Les nombres', content: 'Entiers et décimaux.' }, { title: 'Les fractions', content: 'Numérateur et dénominateur.' }, { title: 'La géométrie', content: 'Triangles et cercles.' }] });
  await http('PUT', `/courses/${c.id}/quiz`, T('david'), { passPercent: 50, questions: [{ prompt: '2 + 2 ?', options: ['3', '4', '5'], correctIndex: 1 }, { prompt: 'Capitale de la RDC ?', options: ['Kinshasa', 'Goma'], correctIndex: 0 }, { prompt: '1/2 + 1/2 ?', options: ['1', '2', '1/4'], correctIndex: 0 }] });
  await http('PUT', `/courses/${c.id}/exam`, T('david'), { examMinutes: 30 });
  await http('POST', `/courses/${c.id}/publish`, T('david'));
  await http('POST', `/courses/${c.id}/enroll`, T('gina'));
  const full = await http('GET', `/courses/${c.id}`, T('gina'));
  const l0 = full.lessons?.[0]?.id; if (l0) await http('POST', `/courses/${c.id}/lessons/${l0}/complete`, T('gina')).catch(() => {});
  await http('POST', `/courses/${c.id}/quiz/attempts`, T('gina'), { answers: [1, 0, 0] }).catch((e) => console.error('quiz', e.message));
  const s = await http('POST', `/courses/${c.id}/exam/sessions`, T('gina')).catch((e) => console.error('exam', e.message));
  if (s) await http('POST', `/courses/${c.id}/exam/sessions/${s.id}/answers`, T('gina'), { answers: s.questions.map(() => 0) }).catch(() => {});
  await http('PUT', `/courses/${c.id}/reviews/me`, T('gina'), { rating: 5, body: 'Très clair' }).catch(() => {});
  await http('POST', `/courses/${c.id}/enroll`, T('bob')).catch(() => {});
  return { course: c.id };
}));

// ---------- annonces ----------
await step('annonces (appartement, véhicule) + visite + offre', () => once('listings', async () => {
  const photo = await upload('alice', 'listing', [34, 197, 94]);
  const a = await http('POST', '/listings', T('alice'), { kind: 'property_rent', title: 'Appartement 2 chambres à Gombe', description: 'Lumineux, proche commerces.', priceMinor: 45000, currency: 'USD', city: 'Kinshasa', latitude: -4.3, longitude: 15.3, mediaIds: [photo] });
  const v = await http('POST', '/listings', T('alice'), { kind: 'vehicle', title: 'Toyota Corolla 2015', description: 'Bon état, première main.', priceMinor: 650000, currency: 'USD', city: 'Kinshasa', make: 'Toyota', model: 'Corolla', year: 2015, mileageKm: 98000, fuel: 'petrol', transmission: 'manual' }).catch((e) => { console.error('vehicule', e.message); return null; });
  await http('POST', `/listings/${a.id}/visits`, T('bob'), { scheduledAt: tomorrowAt(10, 2), message: 'Je souhaite visiter.' }).catch((e) => console.error('visit', e.message));
  if (v) await http('POST', `/listings/${v.id}/offers`, T('bob'), { amountMinor: 600000, message: 'Dernier prix ?' }).catch((e) => console.error('offer', e.message));
  await http('PUT', `/me/favorites/${a.id}`, T('bob')).catch(() => {});
  return { apt: a.id, car: v?.id };
}));

// ---------- école (drapeau school) ----------
await step('école, classe, annonce, bourse', () => once('school', async () => {
  const org = await http('POST', '/orgs', T('frank'), { slug: 'ecole-demo', name: 'École Demo', kind: 'school', country: 'CD', city: 'Kinshasa', visibility: 'public' }).catch(async () => http('GET', '/public/orgs/ecole-demo', T('frank')));
  const cl = await http('POST', `/orgs/${org.id}/school/classes`, T('frank'), { name: '6e A', yearLabel: '2026-2027' });
  await http('POST', `/orgs/${org.id}/school/classes/${cl.id}/members`, T('frank'), { handle: handle.gina, role: 'student' }).catch((e) => console.error('membre', e.message));
  await http('POST', `/orgs/${org.id}/school/classes/${cl.id}/lessons`, T('frank'), { weekday: 1, startsAt: '08:00', endsAt: '09:00', subject: 'Mathématiques', room: 'B2' }).catch((e) => console.error('lesson', e.message));
  await http('POST', `/orgs/${org.id}/school/classes/${cl.id}/announcements`, T('frank'), { title: 'Rentrée', body: 'La rentrée aura lieu lundi à 7 h 30.' }).catch((e) => console.error('annonce', e.message));
  await http('POST', `/orgs/${org.id}/school/scholarships`, T('frank'), { title: 'Bourse d\'excellence', description: 'Pour les meilleurs élèves.', deadline: '2027-03-01' }).catch((e) => console.error('bourse', e.message));
  return { orgId: org.id, classId: cl.id };
}));

// ---------- santé (drapeau health) ----------
await step('santé : dossier, rappel, professionnel validé, rendez-vous', () => once('health', async () => {
  await http('PUT', '/me/health/consent', T('gina'), { version: '1' });
  await http('POST', '/me/health/entries', T('gina'), { kind: 'allergy', recordedOn: '2026-10-01', title: 'Pénicilline', details: 'Éruption cutanée', }).catch((e) => console.error('entry', e.message));
  await http('POST', '/me/health/reminders', T('gina'), { title: 'Vitamine D', dose: '1 comprimé', times: ['08:00'], utcOffsetMinutes: 120, startsOn: '2026-11-01' }).catch((e) => console.error('reminder', e.message));
  if (!(await http('GET', '/me/health/professional', T('emma')).catch(() => null))) await http('PUT', '/me/health/professional', T('emma'), { kind: 'doctor', specialty: 'Médecine générale', licenseNumber: 'MED-12345', city: 'Kinshasa', bio: 'Consultations générales' });
  const pro = await http('GET', '/me/health/professional', T('emma'));
  await http('POST', `/admin/health/professionals/${id.emma}/review`, T('alice'), { decision: 'approve', note: 'Seed QA' }).catch(async () => http('POST', `/admin/health/professionals/${id.emma}/review`, T('alice'), { decision: 'approved', note: 'Seed QA' }));
  await http('PUT', '/me/health/professional/availability', T('emma'), { slotMinutes: 30, utcOffsetMinutes: 120, windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '12:00' })) });
  const prof = (await http('GET', '/health-professionals', T('gina'))).items[0];
  const slots = (await http('GET', `/health-professionals/${prof.userId}/slots?from=${new Date().toISOString()}&to=${new Date(Date.now() + 5 * 86400000).toISOString()}`, T('gina'))).items;
  const ap = await http('POST', '/me/health/appointments', T('gina'), { professionalId: prof.userId, startsAt: slots[0].startsAt, mode: 'in_person', reason: 'Contrôle' });
  await http('POST', `/health/appointments/${ap.id}/confirm`, T('emma')).catch((e) => console.error('confirm', e.message));
  return { pro: pro?.id, appointment: ap.id };
}));

// ---------- mobilité ----------
await step('conducteur de mobilité + lieux favoris', async () => {
  if (state.mob) return;
  await http('PUT', '/mobility/driver', T('hugo'), { vehicleKind: 'car', make: 'Toyota Vitz', plate: 'KIN-1234', color: 'Blanc', zone: 'Kinshasa' });
  await http('POST', '/me/favorite-places', T('gina'), { kind: 'home', label: 'Maison', address: '5 rue du Lac', lat: -4.33, lng: 15.31 }).catch((e) => console.error('place', e.message));
  await http('PUT', '/me/trusted-contacts', T('gina'), { handles: [handle.alice] }).catch((e) => console.error('contacts', e.message));
  state.mob = 1; save();
});
await step('IA : conversation', async () => { if (state.ai) return; await http('POST', '/ai/conversations', T('bob'), { title: 'Test IA' }); state.ai = 1; save(); });
await step('communautés : groupe publié', async () => { if (state.comm || !state.convs) return; await http('PUT', `/conversations/${state.convs.group}/community`, T('alice'), { description: 'Voisins du quartier', tags: ['quartier'] }).catch((e) => console.error('comm', e.message)); state.comm = 1; save(); });

// ---------- parcours bloqués : chauffeur approuvé, location, mini-app, covoiturage ----------
await step('hugo : KYC niveau 1 + chauffeur approuvé', async () => {
  if (state.driverOk) return;
  await sql(`INSERT INTO kyc_profiles (user_id, level) VALUES ($1, 1) ON CONFLICT (user_id) DO UPDATE SET level = GREATEST(kyc_profiles.level, 1)`, [id.hugo]);
  await http('POST', `/admin/mobility/drivers/${id.hugo}/decision`, T('alice'), { decision: 'approve' }).catch((e) => { if (!String(e.message).includes('already_decided')) throw e; });
  state.driverOk = 1; save();
});
await step('covoiturage : trajet publié par hugo', async () => {
  if (state.trip || !state.driverOk) return;
  const trip = await http('POST', '/carpool/trips', T('hugo'), { origin: { lat: -1.65849, lng: 29.2205, label: 'Gare routière de Goma' }, destination: { lat: -1.5833, lng: 29.0333, label: 'Centre de Sake' }, departsAt: tomorrowAt(9, 2), seatsTotal: 3, pricePerSeatMinor: 500, note: 'Trajet de démonstration' });
  state.trip = trip.id; save();
});
await step('location : organisation + véhicule publié', async () => {
  if (state.rental) return;
  const org = await http('POST', '/orgs', T('alice'), { slug: 'demo-location', name: 'Goma Location', kind: 'other', country: 'CD', city: 'Goma', visibility: 'public' }).catch(async () => http('GET', '/public/orgs/demo-location', T('alice')));
  const v = await http('POST', `/orgs/${org.id}/rentals`, T('alice'), { title: 'Toyota RAV4 2019', kind: 'car', make: 'Toyota', model: 'RAV4', year: 2019, seats: 5, transmission: 'auto', fuel: 'petrol', dailyRateMinor: 5000, depositMinor: 20000, city: 'Goma', description: 'Climatisée, kilométrage illimité en ville.' });
  state.rental = { orgId: org.id, vehicleId: v.id }; save();
});
await step('mini-app approuvée + consentement de bob', async () => {
  if (state.miniapp) return;
  const org = await http('POST', '/orgs', T('alice'), { slug: 'demo-apps', name: 'Atelier Apps', kind: 'other', country: 'CD', city: 'Kinshasa' }).catch(async () => http('GET', '/public/orgs/demo-apps', T('alice')));
  const redirect = 'https://app.example.test/callback';
  const manifest = {
    dataAccessed: [{ scope: 'profile.basic', purpose: 'Afficher votre nom dans la mini-application', retention: '30 jours' }],
    endpoints: [{ method: 'GET', path: '/v1/miniapp-api/me' }],
    events: ['authorization.granted', 'authorization.revoked', 'user.data_deletion_requested'],
    costs: { model: 'free', description: 'Gratuit', maxAmountMinor: null, currency: null },
    termsUrl: 'https://app.example.test/terms', privacyUrl: 'https://app.example.test/privacy', supportEmail: 'support@app.example.test', dataLocation: 'Union européenne',
  };
  const app = await http('POST', `/orgs/${org.id}/miniapps`, T('alice'), { name: 'Démo Mini-App', description: 'Mini-application de démonstration', launchUrl: 'https://app.example.test/', redirectUris: [redirect], scopes: ['profile.basic'], manifest });
  await http('POST', `/orgs/${org.id}/miniapps/${app.id}/submit`, T('alice'));
  await http('POST', `/admin/miniapps/${app.id}/review`, T('hugo'), { decision: 'approve' }); // pas alice : l'app est de son organisation
  const challenge = createHash('sha256').update(randomBytes(48).toString('base64url')).digest('base64url');
  await http('POST', '/oauth/authorize', T('bob'), { clientId: app.clientId, redirectUri: redirect, scopes: ['profile.basic'], state: 'state-' + randomUUID().slice(0, 12), codeChallenge: challenge });
  state.miniapp = { orgId: org.id, appId: app.id, clientId: app.clientId }; save();
});

// ---------- bilan ----------
console.log('\n=== BILAN ===');
for (const [s, l] of results) console.log(s, l);
console.log(`\n${results.filter((r) => r[0] === 'OK').length} OK / ${results.filter((r) => r[0] === 'KO').length} KO`);
