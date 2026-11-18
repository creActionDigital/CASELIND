import type { ConversationRole, Message, Poll, PollEvent, Presence } from '@caselind/contracts';

/** Logique pure des sondages, de la présence et de la recherche dans les messages (testée sans écran). */

export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 80;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
export const MESSAGE_SEARCH_MIN = 2;

export interface PollDraft {
  question: string;
  options: string[];
  multiple: boolean;
}

/** Brouillon valide : question 1..200, 2 à 6 options distinctes (sans tenir compte de la casse) de 1..80. Les lignes vides sont ignorées. */
export function cleanPollDraft(d: PollDraft): { ok: boolean; question: string; options: string[] } {
  const question = d.question.trim();
  const options = d.options.map((o) => o.trim()).filter((o) => o.length > 0);
  const distinct = new Set(options.map((o) => o.toLowerCase())).size === options.length;
  const ok =
    question.length >= 1 &&
    question.length <= POLL_QUESTION_MAX &&
    options.length >= POLL_OPTIONS_MIN &&
    options.length <= POLL_OPTIONS_MAX &&
    options.every((o) => o.length <= POLL_OPTION_MAX) &&
    distinct;
  return { ok, question, options };
}

/** Nouveau choix après un appui sur une option : un seul choix remplace, plusieurs bascule ; ré-appuyer retire. */
export function nextVotes(poll: Pick<Poll, 'multiple'>, current: string[], optionId: string): string[] {
  if (current.includes(optionId)) return current.filter((id) => id !== optionId);
  return poll.multiple ? [...current, optionId] : [optionId];
}

/** Part d'une option en pourcentage entier du total des voix (0 sans voix). */
export function optionPercent(votes: number, totalVotes: number): number {
  return totalVotes <= 0 ? 0 : Math.round((votes / totalVotes) * 100);
}

export function totalVotes(poll: Pick<Poll, 'options'>): number {
  return poll.options.reduce((n, o) => n + o.votes, 0);
}

/** Le créateur, ou un administrateur/propriétaire du groupe, peut clore un sondage encore ouvert. */
export function canClosePoll(m: Pick<Message, 'senderId' | 'poll'>, myId: string, myRole: ConversationRole): boolean {
  if (!m.poll || m.poll.closed) return false;
  return m.senderId === myId || myRole === 'owner' || myRole === 'admin';
}

/** Applique `message.poll` : met les compteurs à jour et garde les votes personnels déjà connus. */
export function applyPollEvent<T extends Pick<Message, 'id' | 'poll'>>(items: T[], ev: Pick<PollEvent, 'messageId' | 'poll'>): T[] {
  return items.map((m) => (m.id === ev.messageId && m.poll ? { ...m, poll: { ...ev.poll, myVotes: m.poll.myVotes } } : m));
}

/** Après mon propre vote, les compteurs locaux suivent sans attendre le serveur. */
export function withMyVotes(poll: Poll, votes: string[]): Poll {
  const before = new Set(poll.myVotes);
  const after = new Set(votes);
  return {
    ...poll,
    myVotes: votes,
    voters: Math.max(0, poll.voters + (votes.length > 0 ? 1 : 0) - (poll.myVotes.length > 0 ? 1 : 0)),
    options: poll.options.map((o) => ({ ...o, votes: Math.max(0, o.votes + (after.has(o.id) ? 1 : 0) - (before.has(o.id) ? 1 : 0)) })),
  };
}

export type PresenceView = { kind: 'hidden' } | { kind: 'online' } | { kind: 'lastSeen'; at: Date } | { kind: 'unknown' };

/** Ce que l'en-tête d'une conversation directe affiche : en ligne, « vu à » ou rien. */
export function presenceView(p: Presence | null | undefined): PresenceView {
  if (!p || !p.visible) return { kind: 'hidden' };
  if (p.online) return { kind: 'online' };
  return p.lastSeenAt ? { kind: 'lastSeen', at: new Date(p.lastSeenAt) } : { kind: 'unknown' };
}

/** « vu à HH:MM » le jour même, « vu hier à HH:MM » la veille, sinon la date courte. */
export function lastSeenWhen(at: Date, now: Date, locale: string): { day: 'today' | 'yesterday' | 'date'; text: string } {
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days <= 0) return { day: 'today', text: time };
  if (days === 1) return { day: 'yesterday', text: time };
  return { day: 'date', text: at.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) + ' ' + time };
}

/** Remplace la présence d'un pair dans le cache après `presence.updated`. */
export function applyPresence(current: Presence | undefined, ev: Presence): Presence {
  return current && current.userId !== ev.userId ? current : ev;
}

/** La recherche ne part qu'à partir de 2 caractères utiles. */
export function searchReady(q: string): boolean {
  return q.trim().length >= MESSAGE_SEARCH_MIN;
}
