import type { PostAttachmentInput } from '@caselind/contracts';

/** Brouillon d'une pièce jointe de publication, tel que saisi dans l'écran de création. */
export type AttachmentDraft =
  | { type: 'none' }
  | { type: 'location'; lat: number | null; lng: number | null; label: string }
  | { type: 'event'; title: string; when: string; place: string }
  | { type: 'poll'; options: string[] };

export type AttachmentError = 'location' | 'eventTitle' | 'eventDate' | 'pollOptions';

/** « 2026-12-24 18:30 » (heure locale) -> ISO UTC, ou null si illisible ou déjà passé. */
export function parseEventDate(text: string, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  const valid = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
  return valid && date.getTime() > now.getTime() ? date.toISOString() : null;
}

export function validateAttachment(d: AttachmentDraft, now?: Date): AttachmentError | null {
  if (d.type === 'location') return d.lat === null || d.lng === null || !d.label.trim() ? 'location' : null;
  if (d.type === 'event') return !d.title.trim() ? 'eventTitle' : parseEventDate(d.when, now) ? null : 'eventDate';
  if (d.type === 'poll') {
    const opts = d.options.map((o) => o.trim()).filter(Boolean);
    return opts.length < 2 || new Set(opts.map((o) => o.toLowerCase())).size !== opts.length ? 'pollOptions' : null;
  }
  return null;
}

/** Brouillon valide -> corps de requête (undefined sans pièce jointe). À n'appeler qu'après validateAttachment. */
export function toAttachmentInput(d: AttachmentDraft): PostAttachmentInput | undefined {
  if (d.type === 'location') return { type: 'location', lat: d.lat!, lng: d.lng!, label: d.label.trim().slice(0, 120) };
  if (d.type === 'event') return { type: 'event', title: d.title.trim(), startsAt: parseEventDate(d.when)!, ...(d.place.trim() ? { place: d.place.trim().slice(0, 200) } : {}) };
  if (d.type === 'poll') return { type: 'poll', options: d.options.map((o) => o.trim()).filter(Boolean).slice(0, 4) };
  return undefined;
}
