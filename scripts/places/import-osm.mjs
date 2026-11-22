#!/usr/bin/env node
/**
 * Import de lieux réels depuis OpenStreetMap (API Overpass publique) vers `organizations`.
 * Licence des données : ODbL 1.0 — © contributeurs OpenStreetMap (https://www.openstreetmap.org/copyright) :
 * attribution affichée sur la carte et dans la fiche, base dérivée partagée à l'identique.
 * Ne s'exécute qu'avec l'option explicite (après accord du propriétaire) :
 *   node scripts/places/import-osm.mjs --accept-odbl [--bbox=S,W,N,E] [--dry-run]
 * Une seule requête Overpass (User-Agent identifié, timeout 60 s). La réponse est écrite dans un dossier temporaire neuf
 * et lue comme JSON, jamais exécutée. Idempotent : clé (osm_type, osm_id) ; seules les lignes source='osm' sont mises à jour
 * (les lieux créés par des utilisateurs ne sont jamais touchés). Les lieux de démo (slug demo-gom-*) d'une catégorie
 * sont retirés quand l'import a trouvé au moins un lieu réel dans cette catégorie.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

if (!process.argv.includes('--accept-odbl')) {
  console.log('Import OpenStreetMap désactivé : relancez avec --accept-odbl (licence ODbL).');
  process.exit(0);
}
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const bbox = arg('bbox', '-1.72,29.17,-1.62,29.27'); // Goma
const dry = process.argv.includes('--dry-run');
const DB = process.env.DATABASE_URL ?? 'postgres://postgres:caselind-dev-only@localhost:54329/caselind_utf8';
// Étiquette OSM -> catégorie Caselind (le premier critère qui correspond gagne)
const MAP = [
  ['amenity', 'restaurant', 'restaurant'], ['amenity', 'cafe', 'restaurant'], ['amenity', 'fast_food', 'restaurant'],
  ['amenity', 'fuel', 'fuel_station'], ['amenity', 'pharmacy', 'pharmacy'], ['amenity', 'hospital', 'hospital'], ['amenity', 'clinic', 'hospital'],
  ['tourism', 'hotel', 'hotel'], ['tourism', 'guest_house', 'hotel'], ['amenity', 'school', 'school'], ['amenity', 'college', 'school'],
  ['amenity', 'bank', 'bank'], ['amenity', 'atm', 'bank'],
  ['amenity', 'post_office', 'services'], ['amenity', 'car_wash', 'services'], ['craft', '*', 'services'],
  ['shop', '*', 'shop'],
];
const kindOf = (t) => MAP.find(([k, v]) => (v === '*' ? t[k] : t[k] === v))?.[2];
const union = MAP.map(([k, v]) => `nwr["${k}"${v === '*' ? '' : `="${v}"`}]["name"](${bbox});`).join('');
const query = `[out:json][timeout:60];(${union});out center tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: new URLSearchParams({ data: query }),
  headers: { 'user-agent': 'caselind-places-import/1.0' },
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caselind-osm-'));
const file = path.join(dir, 'overpass.json');
fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
const { elements } = JSON.parse(fs.readFileSync(file, 'utf8'));

const phoneOf = (t) => {
  const raw = (t.phone ?? t['contact:phone'] ?? '').split(';')[0].replace(/[\s().-]/g, '');
  return /^\+[1-9][0-9]{6,14}$/.test(raw) ? raw : null;
};
const counts = {};
const db = new pg.Client({ connectionString: DB });
if (!dry) await db.connect();
for (const e of elements) {
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon, kind = kindOf(e.tags ?? {});
  if (lat == null || lng == null || !kind || !e.tags?.name) continue;
  counts[kind] = (counts[kind] ?? 0) + 1;
  if (dry) continue;
  const street = [e.tags['addr:housenumber'], e.tags['addr:street']].filter(Boolean).join(' ').slice(0, 300) || null;
  await db.query(
    `INSERT INTO organizations (slug, name, kind, description, country, city, address, phone, visibility, status, lat, lng, source, osm_type, osm_id)
     VALUES ($1,$2,$3,'© contributeurs OpenStreetMap (ODbL)','CD','Goma',$4,$5,'public','active',$6,$7,'osm',$8,$9)
     ON CONFLICT (osm_type, osm_id) WHERE source = 'osm'
     DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, address = EXCLUDED.address, phone = EXCLUDED.phone, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
    [`osm-${e.type[0]}${e.id}`, e.tags.name.slice(0, 120), kind, street, phoneOf(e.tags), lat, lng, e.type, e.id],
  );
}
let removed = 0;
if (!dry && Object.keys(counts).length) {
  const r = await db.query(`DELETE FROM organizations WHERE slug LIKE 'demo-gom-%' AND source IS NULL AND kind = ANY($1)`, [Object.keys(counts)]);
  removed = r.rowCount;
}
if (!dry) await db.end();
console.log(`${dry ? 'Essai à blanc' : 'Import'} : ${elements.length} éléments OSM ; par catégorie :`, counts, `; démo retirée : ${removed} ; réponse brute : ${file}`);
