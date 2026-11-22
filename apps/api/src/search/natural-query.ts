import type { NaturalFilters, OrgKind } from '@caselind/contracts';

/**
 * Deterministic analyser of a natural-language search (fr/en/sw): price phrases, "near X", place types and a
 * small category lexicon. No model, no SQL: it only produces the validated filters the search runs.
 */

export const EMPTY_FILTERS: NaturalFilters = {
  keywords: null,
  categorySlug: null,
  minPriceMinor: null,
  maxPriceMinor: null,
  currency: null,
  city: null,
  placeKind: null,
  cheapFirst: false,
  nearMe: false,
};

const CURRENCY_WORDS: [RegExp, string][] = [
  [/^(?:\$|us\$|usd|dollars?|dola(?:ri)?)$/, 'USD'],
  [/^(?:€|eur|euros?)$/, 'EUR'],
  [/^(?:fc|cdf|francs?(?: congolais)?)$/, 'CDF'],
];
const CUR = String.raw`(?:us\$|\$|€|usd|dollars?|dola(?:ri)?|eur(?:os?)?|cdf|fc|francs?(?: congolais)?)(?![a-z])`;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const L = String.raw`(?<![a-z])`;

const NEAR_ME = new RegExp(`${L}(?:pres de moi|autour de moi|proche de moi|a proximite|near me|around me|nearby|karibu nami|karibu na mimi)(?![a-z])`, 'g');
const CHEAP = new RegExp(`${L}(?:pas chers?|pas cheres?|bon marche|abordables?|economiques?|cheap(?:est)?|affordable|inexpensive|bei nafuu|nafuu|rahisi)(?![a-z])`, 'g');

const RANGE = new RegExp(`${L}(?:entre|between|kati ya)\\s*(?:(${CUR})\\s*)?(${NUM})\\s*(${CUR})?\\s*(?:et|and|na|-)\\s*(?:(${CUR})\\s*)?(${NUM})\\s*(${CUR})?`, 'g');
const MAX = new RegExp(`${L}(?:moins de|moins que|pas plus de|maximum|max|jusqu a|jusqu'a|under|below|less than|up to|at most|chini ya|<)\\s*(?:(${CUR})\\s*)?(${NUM})\\s*(${CUR})?`, 'g');
const MIN = new RegExp(`${L}(?:plus de|au moins|minimum|min|over|above|more than|at least|zaidi ya|>)\\s*(?:(${CUR})\\s*)?(${NUM})\\s*(${CUR})?`, 'g');

/** Marker words that may introduce a city. Weak ones need a capitalised word after them. */
const STRONG_PLACE = String.raw`(?:pres de|proche de|autour de|a cote de|near|around|close to|karibu na|karibu)`;
const WEAK_PLACE = String.raw`(?:a|au|in|at|huko|mjini|jijini)`;
const CITY_STOP = new Set(['avec', 'pour', 'moins', 'plus', 'sous', 'et', 'and', 'with', 'for', 'under', 'below', 'na', 'ya', 'chini', 'max', 'pas', 'bon', 'cheap', 'les', 'des', 'qui', 'that', 'which', 'entre', 'between', 'de', 'du']);
const CITY_ARTICLES = new Set(['le', 'la', 'les', 'l', 'the', 'ville', 'city']);

const STOPWORDS = new Set([
  'je', 'tu', 'il', 'on', 'nous', 'vous', 'moi', 'me', 'mon', 'ma', 'mes', 'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'un', 'une', 'et', 'ou', 'a', 'au', 'aux', 'en', 'pour', 'avec', 'sans', 'sur', 'dans', 'par',
  'cherche', 'chercher', 'recherche', 'veux', 'voudrais', 'voulez', 'trouver', 'trouve', 'trouvez', 'donne', 'montre', 'afficher', 'besoin', 'quelque', 'chose', 'des', 'quelques', 'svp', 'stp', 'merci', 'il', 'y', 'qui', 'que',
  'i', 'want', 'need', 'looking', 'look', 'find', 'search', 'show', 'give', 'get', 'an', 'the', 'some', 'any', 'for', 'to', 'in', 'at', 'of', 'and', 'or', 'please', 'with', 'is', 'are', 'there', 'near', 'around',
  'nataka', 'natafuta', 'tafuta', 'tafadhali', 'ninataka', 'kwa', 'na', 'ya', 'wa', 'za', 'la', 'katika', 'huko', 'mjini', 'jijini', 'karibu',
]);

/** Words of the place-type lexicon (accent-free). */
const PLACE_KINDS: [OrgKind, string[]][] = [
  ['restaurant', ['restaurant', 'restaurants', 'resto', 'restos', 'mgahawa', 'migahawa', 'maquis', 'snack', 'cafe']],
  ['pharmacy', ['pharmacie', 'pharmacies', 'pharmacy', 'pharmacies', 'duka la dawa', 'famasia']],
  ['hotel', ['hotel', 'hotels', 'hoteli', 'auberge', 'guesthouse', 'lodge']],
  ['fuel_station', ['station-service', 'station service', 'station essence', 'stations service', 'fuel station', 'gas station', 'petrol station', 'kituo cha mafuta']],
  ['bank', ['banque', 'bank', 'distributeur', 'atm', 'guichet', 'benki']],
  ['school', ['ecole', 'ecoles', 'school', 'schools', 'shule', 'college', 'lycee']],
  ['hospital', ['hopital', 'hopitaux', 'clinique', 'cliniques', 'hospital', 'clinic', 'hospitali', 'zahanati']],
  ['shop', ['boutique', 'boutiques', 'magasin', 'magasins', 'shop', 'shops', 'store', 'duka', 'maduka']],
  ['warehouse', ['entrepot', 'entrepots', 'warehouse', 'ghala']],
];
/** Trades: a place of kind "services" while the word stays a keyword. */
const SERVICE_WORDS = ['electricien', 'electricienne', 'plombier', 'plombiere', 'coiffeur', 'coiffeuse', 'mecanicien', 'menuisier', 'macon', 'peintre', 'electrician', 'plumber', 'hairdresser', 'mechanic', 'carpenter', 'painter', 'fundi', 'mchungaji', 'mekanika'];

const CATEGORIES: [NaturalFilters['categorySlug'] & string, string[]][] = [
  ['mode', ['sandale', 'sandales', 'chaussure', 'chaussures', 'basket', 'baskets', 'robe', 'robes', 'pagne', 'pagnes', 'chemise', 'pantalon', 'vetement', 'vetements', 'sac', 'sacs', 'shoes', 'sandals', 'dress', 'shirt', 'clothes', 'bag', 'viatu', 'nguo', 'mkoba']],
  ['electronique', ['telephone', 'telephones', 'smartphone', 'portable', 'ordinateur', 'ordinateurs', 'laptop', 'tablette', 'ecouteurs', 'chargeur', 'television', 'tv', 'phone', 'computer', 'charger', 'headphones', 'simu', 'kompyuta']],
  ['alimentation', ['riz', 'pain', 'viande', 'poisson', 'huile', 'sucre', 'farine', 'lait', 'fruits', 'legumes', 'boisson', 'boissons', 'food', 'rice', 'bread', 'meat', 'fish', 'milk', 'chakula', 'mchele', 'mkate', 'nyama', 'samaki']],
  ['beaute', ['savon', 'creme', 'parfum', 'maquillage', 'shampoing', 'cosmetique', 'cosmetiques', 'soap', 'perfume', 'makeup', 'cosmetics', 'sabuni', 'manukato']],
  ['maison', ['meuble', 'meubles', 'canape', 'lit', 'matelas', 'table', 'chaise', 'casserole', 'cuisine', 'furniture', 'sofa', 'bed', 'mattress', 'chair', 'kitchen', 'kiti', 'kitanda']],
  ['sante', ['medicament', 'medicaments', 'vitamine', 'vitamines', 'masque', 'medicine', 'vitamins', 'dawa']],
  ['bebe', ['bebe', 'couche', 'couches', 'biberon', 'poussette', 'baby', 'diapers', 'stroller', 'mtoto']],
  ['sport', ['ballon', 'football', 'velo', 'maillot', 'sport', 'bicycle', 'bike', 'ball', 'jersey', 'mpira', 'baiskeli']],
  ['auto-moto', ['moto', 'motos', 'voiture', 'voitures', 'pneu', 'pneus', 'batterie', 'casque', 'car', 'cars', 'tyre', 'tire', 'motorcycle', 'helmet', 'gari', 'pikipiki']],
];

const strip = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "1 000,50" / "20" / "1.000" to minor units (x100). A separator followed by exactly 3 digits is a thousands mark. */
export function toMinor(raw: string): number {
  let s = raw.trim();
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 1e10 ? Math.round(n * 100) : 0;
}

function currencyOf(...words: (string | undefined)[]): string | null {
  for (const w of words) {
    if (!w) continue;
    const t = w.trim();
    for (const [re, code] of CURRENCY_WORDS) if (re.test(t)) return code;
  }
  return null;
}

const blank = (work: string, m: RegExpMatchArray): string => work.slice(0, m.index!) + ' '.repeat(m[0].length) + work.slice(m.index! + m[0].length);

const titleCase = (s: string): string => s.replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** Natural phrase to structured filters. Never throws. */
export function parseNaturalQuery(input: string): NaturalFilters {
  const nfc = input.normalize('NFC').replace(/[  ]/g, ' ').replace(/(\d)[ ](?=\d{3}(?!\d))/g, '$1');
  const plain = strip(nfc);
  let work = plain.toLowerCase();
  const out: NaturalFilters = { ...EMPTY_FILTERS };

  const take = (re: RegExp): RegExpMatchArray | null => {
    re.lastIndex = 0;
    const m = re.exec(work);
    if (!m) return null;
    work = blank(work, m);
    return m;
  };

  if (take(NEAR_ME)) out.nearMe = true;
  if (take(CHEAP)) out.cheapFirst = true;

  const range = take(RANGE);
  if (range) {
    const a = toMinor(range[2]!);
    const b = toMinor(range[5]!);
    out.minPriceMinor = Math.min(a, b);
    out.maxPriceMinor = Math.max(a, b);
    out.currency = currencyOf(range[1], range[3], range[4], range[6]);
  } else {
    const max = take(MAX);
    if (max) {
      out.maxPriceMinor = toMinor(max[2]!);
      out.currency = currencyOf(max[1], max[3]);
    }
    const min = take(MIN);
    if (min) {
      out.minPriceMinor = toMinor(min[2]!);
      out.currency ??= currencyOf(min[1], min[3]);
    }
  }

  // City: "pres de Goma", "a Bukavu" (a capital letter is required after the weak markers).
  const cityWords = (start: number, requireCapital: boolean): { from: number; to: number } | null => {
    const tail = plain.slice(start);
    let from = -1;
    let to = -1;
    let n = 0;
    for (const m of tail.matchAll(/\S+/g)) {
      const bare = m[0].replace(/[,.;:!?]+$/, '');
      const lw = bare.toLowerCase();
      if (!/^[\p{L}'-]+$/u.test(bare) || CITY_STOP.has(lw)) break;
      if (n === 0 && CITY_ARTICLES.has(lw.replace(/'$/, ''))) continue;
      if (requireCapital && !/^\p{Lu}/u.test(bare)) break;
      if (from < 0) from = m.index;
      to = m.index + bare.length;
      n += 1;
      if (n === 3 || bare.length !== m[0].length) break;
    }
    return n > 0 ? { from: start + from, to: start + to } : null;
  };
  const strongRe = new RegExp(`${L}${STRONG_PLACE}\\s+`, 'g');
  const weakRe = new RegExp(`${L}${WEAK_PLACE}\\s+`, 'g');
  for (const [re, weak] of [[strongRe, false], [weakRe, true]] as const) {
    if (out.city || out.nearMe) break;
    re.lastIndex = 0;
    for (let m = re.exec(work); m; m = re.exec(work)) {
      const span = cityWords(m.index + m[0].length, weak);
      if (!span) continue;
      const raw = plain.slice(span.from, span.to);
      const cut = (): void => {
        work = work.slice(0, m!.index) + ' '.repeat(span.to - m!.index) + work.slice(span.to);
      };
      if (['moi', 'me', 'mimi'].includes(raw.toLowerCase())) {
        out.nearMe = true;
        cut();
        break;
      }
      out.city = titleCase(nfc.length === plain.length ? nfc.slice(span.from, span.to) : raw).slice(0, 60);
      cut();
      break;
    }
  }

  const tokens = work.split(/[^a-z0-9$€'-]+/).filter(Boolean);
  const kept: string[] = [];
  const joined = ` ${tokens.join(' ')} `;
  for (const [kind, words] of PLACE_KINDS) {
    for (const w of words) {
      if (joined.includes(` ${w} `)) {
        out.placeKind ??= kind;
        work = work.replace(new RegExp(`${L}${w.replace(/[-\s]/g, '[-\\s]')}(?![a-z])`, 'g'), ' ');
      }
    }
  }
  for (const w of tokens) if (SERVICE_WORDS.includes(w)) out.placeKind ??= 'services';
  for (const [slug, words] of CATEGORIES) {
    if (!out.categorySlug && tokens.some((t) => words.includes(t))) out.categorySlug = slug;
  }

  const sameLength = nfc.length === work.length;
  for (const m of work.matchAll(/[a-z0-9]+/g)) {
    if (STOPWORDS.has(m[0])) continue;
    // Keep the accents of the original text for matching product titles.
    kept.push(sameLength ? nfc.slice(m.index, m.index + m[0].length).toLowerCase() : m[0]);
  }
  const keywords = kept.join(' ').slice(0, 100).trim();
  out.keywords = keywords.length > 0 ? keywords : null;
  return out;
}

/** Human-readable keys of the filters that are set (the chips the client shows). */
export function activeFilterKeys(f: NaturalFilters): (keyof NaturalFilters)[] {
  return (Object.keys(f) as (keyof NaturalFilters)[]).filter((k) => f[k] !== null && f[k] !== false);
}
