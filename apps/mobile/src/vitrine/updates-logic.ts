import type { CreateOrgUpdateRequest, OrgUpdate, OrgUpdateKind } from '@caselind/contracts';

const pad = (n: number) => String(n).padStart(2, '0');

/** « 2026-11-20 18:30 » (heure de l'appareil) → date ; `null` si le format ou la date est invalide (pas de 31 février). */
export function parseDateTime(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  const same = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
  return same ? date : null;
}

/** Instant ISO → « AAAA-MM-JJ HH:MM » (heure de l'appareil), pour pré-remplir le formulaire ; vide si absent. */
export function toInputText(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Instant ISO → « JJ/MM/AAAA HH:MM » (heure de l'appareil). */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** « 20/11/2026 18:30 → 20:00 » ou le début seul ; vide sans date. */
export function formatRange(u: Pick<OrgUpdate, 'startsAt' | 'endsAt'>): string {
  if (!u.startsAt && !u.endsAt) return '';
  if (!u.startsAt) return formatWhen(u.endsAt!);
  if (!u.endsAt) return formatWhen(u.startsAt);
  const a = formatWhen(u.startsAt);
  const b = formatWhen(u.endsAt);
  return a.slice(0, 10) === b.slice(0, 10) ? `${a} → ${b.slice(11)}` : `${a} → ${b}`;
}

export type UpdateForm = { kind: OrgUpdateKind; title: string; body: string; startsAt: string; endsAt: string; place: string };
export type UpdateFormError = 'title' | 'body' | 'startsAt' | 'startsRequired' | 'endsAt' | 'endBeforeStart';

export const emptyForm = (): UpdateForm => ({ kind: 'post', title: '', body: '', startsAt: '', endsAt: '', place: '' });

export const formOf = (u: OrgUpdate): UpdateForm => ({ kind: u.kind, title: u.title, body: u.body, startsAt: toInputText(u.startsAt), endsAt: toInputText(u.endsAt), place: u.place ?? '' });

/** Formulaire → requête (mêmes règles que l'API) ; sinon le champ fautif. Dates vides = absentes (`null`, pour effacer à la modification). */
export function buildUpdate(f: UpdateForm): { ok: CreateOrgUpdateRequest } | { error: UpdateFormError } {
  const title = f.title.trim();
  const body = f.body.trim();
  if (!title || title.length > 80) return { error: 'title' };
  if (!body || body.length > 1000) return { error: 'body' };
  const starts = f.startsAt.trim() ? parseDateTime(f.startsAt) : null;
  if (f.startsAt.trim() && !starts) return { error: 'startsAt' };
  const ends = f.endsAt.trim() ? parseDateTime(f.endsAt) : null;
  if (f.endsAt.trim() && !ends) return { error: 'endsAt' };
  if (f.kind === 'event' && !starts) return { error: 'startsRequired' };
  if (starts && ends && ends <= starts) return { error: 'endBeforeStart' };
  return { ok: { kind: f.kind, title, body, startsAt: starts?.toISOString() ?? null, endsAt: ends?.toISOString() ?? null, place: f.place.trim() || null } };
}
