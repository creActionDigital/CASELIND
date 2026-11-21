import type { SystemEvent } from '@caselind/contracts';
import type { MessageKey } from '../i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Clé de libellé d'une durée d'éphémère (24 h, 7 jours, 90 jours). */
export function disappearingDurationKey(seconds: number | null | undefined): MessageKey | null {
  switch (seconds) {
    case 86400:
      return 'messagesX.duration.86400';
    case 604800:
      return 'messagesX.duration.604800';
    case 7776000:
      return 'messagesX.duration.7776000';
    default:
      return null;
  }
}

export function durationText(seconds: number, t: T): string {
  const key = disappearingDurationKey(seconds);
  if (key) return t(key);
  const days = Math.max(1, Math.round(seconds / 86400));
  return t('messagesX.duration.days', { n: days });
}

/** Texte d'un message système (pur, testé). */
export function systemText(ev: SystemEvent, name: (userId: string | null) => string, t: T): string {
  switch (ev.type) {
    case 'group_created':
      // « Vous a créé » serait faux : forme dédiée quand l'auteur est la personne connectée.
      return name(ev.actorId) === t('chat.you') ? t('chat.system.group_created_you') : t('chat.system.group_created', { name: name(ev.actorId) });
    case 'member_added':
      // Rejoindre une communauté publique : la personne s'ajoute elle-même.
      if (ev.userId === ev.actorId) return t('chat.system.member_joined', { name: name(ev.userId) });
      return t('chat.system.member_added', { name: name(ev.userId), actor: name(ev.actorId) });
    case 'member_removed':
      return t('chat.system.member_removed', { name: name(ev.userId), actor: name(ev.actorId) });
    case 'member_left':
      return t('chat.system.member_left', { name: name(ev.userId) });
    case 'title_changed':
      return t('chat.system.title_changed', { name: name(ev.actorId), title: ev.title ?? '' });
    case 'disappearing_changed':
      return ev.seconds
        ? t('chat.system.disappearing_on', { name: name(ev.actorId), duration: durationText(ev.seconds, t) })
        : t('chat.system.disappearing_off', { name: name(ev.actorId) });
  }
}
