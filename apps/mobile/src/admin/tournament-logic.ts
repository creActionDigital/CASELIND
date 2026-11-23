/** Saisie d'un tournoi : « AAAA-MM-JJ HH:MM » (heure locale) -> ISO 8601, ou null si la date est invalide. */
export function parseLocalDateTime(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  // refuse les dates qui « débordent » (31 février devenu 3 mars, 25 h, etc.)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date.toISOString();
}

export type TournamentDraft = { title: string; startsAt: string; endsAt: string };

/** Corps de POST /admin/games/tournaments, ou null : titre 1 à 80 caractères, deux dates valides, fin après le début. */
export function tournamentBody(title: string, starts: string, ends: string): TournamentDraft | null {
  const t = title.trim();
  const startsAt = parseLocalDateTime(starts);
  const endsAt = parseLocalDateTime(ends);
  if (t.length < 1 || t.length > 80 || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  return { title: t, startsAt, endsAt };
}
