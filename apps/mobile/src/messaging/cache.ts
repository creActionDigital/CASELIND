import type {
  Conversation,
  ConversationInfo,
  ConversationList,
  Message,
  MessageReactionEvent,
  ReceiptState,
} from '@caselind/contracts';

/** Forme des données d'un `useInfiniteQuery` (sans dépendre de react-query : fonctions pures testables). */
export interface Pages<T> {
  pages: T[];
  pageParams: unknown[];
}

/** Message tel que stocké dans le cache : les messages locaux (optimistes) portent `local`. */
export type CachedMessage = Message & {
  local?: 'sending' | 'failed';
  localUri?: string;
  localMime?: string;
  /** Document en cours d'envoi : nom et taille d'origine. */
  localName?: string;
  localSize?: number;
  /** Vocal en cours d'envoi : durée en secondes. */
  localDuration?: number;
};
export type CachedMessageList = { items: CachedMessage[]; hasMore: boolean };
export type MessagePages = Pages<CachedMessageList>;

/** Les messages locaux restent en tête de liste (les plus récents). */
export const OPTIMISTIC_SEQ = Number.MAX_SAFE_INTEGER;

export function buildOptimisticMessage(input: {
  conversationId: string;
  senderId: string;
  clientId: string;
  kind: 'text' | 'media';
  body?: string | null;
  replyToId?: string | null;
  localUri?: string;
  localMime?: string;
  localName?: string;
  localSize?: number;
  localDuration?: number;
  now?: Date;
}): CachedMessage {
  return {
    id: input.clientId,
    conversationId: input.conversationId,
    seq: OPTIMISTIC_SEQ,
    kind: input.kind,
    senderId: input.senderId,
    clientId: input.clientId,
    body: input.body ?? null,
    media: null,
    replyToId: input.replyToId ?? null,
    mentions: [],
    systemEvent: null,
    recalled: false,
    reactions: [],
    myReaction: null,
    createdAt: (input.now ?? new Date()).toISOString(),
    forwarded: false,
    expiresAt: null,
    favorited: false,
    poll: null,
    local: 'sending',
    localUri: input.localUri,
    localMime: input.localMime,
    localName: input.localName,
    localSize: input.localSize,
    localDuration: input.localDuration,
  };
}

const emptyPages = (): MessagePages => ({ pages: [{ items: [], hasMore: false }], pageParams: [undefined] });

function mapItems(data: MessagePages, fn: (items: CachedMessage[]) => CachedMessage[]): MessagePages {
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: fn(p.items) })) };
}

function has(data: MessagePages, match: (m: CachedMessage) => boolean): boolean {
  return data.pages.some((p) => p.items.some(match));
}

function sortNewestFirst(items: CachedMessage[]): CachedMessage[] {
  return [...items].sort((a, b) => b.seq - a.seq);
}

/** Re-trie la première page uniquement (seule à recevoir des insertions). */
function resort(data: MessagePages): MessagePages {
  const [first, ...rest] = data.pages;
  return { ...data, pages: [{ ...first, items: sortNewestFirst(first.items) }, ...rest] };
}

/**
 * Insère ou remplace un message serveur. Dédoublonnage par `id`, puis par `clientId` : le message
 * optimiste est remplacé sur place, que `message.new` arrive avant ou après la réponse HTTP.
 */
export function upsertServerMessage(data: MessagePages | undefined, msg: Message): MessagePages {
  const base = data ?? emptyPages();
  const same = (m: CachedMessage) => m.id === msg.id || (msg.clientId !== null && m.clientId === msg.clientId);
  if (has(base, same)) {
    let replaced = false;
    const next = mapItems(base, (items) =>
      items.flatMap((m) => {
        if (!same(m)) return [m];
        if (replaced) return []; // doublon résiduel
        replaced = true;
        // myReaction n'est pas porté par les événements temps réel : on conserve la valeur locale.
        return [{ ...msg, myReaction: msg.myReaction ?? m.myReaction }];
      }),
    );
    return resort(next);
  }
  const [first, ...rest] = base.pages;
  return { ...base, pages: [{ ...first, items: sortNewestFirst([...first.items, msg]) }, ...rest] };
}

/* ---------- Boîte d'envoi : messages locaux (envoi en cours ou échoué), hors du cache serveur ---------- */

/** Plus récent en premier. Séparée des pages serveur : un rechargement du serveur ne l'efface pas. */
export type Outbox = CachedMessage[];

export function outboxAdd(outbox: Outbox | undefined, msg: CachedMessage): Outbox {
  const rest = (outbox ?? []).filter((m) => m.clientId !== msg.clientId);
  const previous = (outbox ?? []).find((m) => m.clientId === msg.clientId);
  // Un réessai garde la place du message d'origine.
  if (previous) return (outbox ?? []).map((m) => (m.clientId === msg.clientId ? { ...m, local: 'sending' } : m));
  return [msg, ...rest];
}

export function outboxMark(outbox: Outbox | undefined, clientId: string, state: 'sending' | 'failed'): Outbox {
  return (outbox ?? []).map((m) => (m.clientId === clientId ? { ...m, local: state } : m));
}

export function outboxRemove(outbox: Outbox | undefined, clientId: string): Outbox {
  return (outbox ?? []).filter((m) => m.clientId !== clientId);
}

/** Liste affichée (plus récent d'abord) : messages locaux puis messages serveur, sans doublon par clientId. */
export function displayMessages(data: MessagePages | undefined, outbox: Outbox | undefined): CachedMessage[] {
  const server = data?.pages.flatMap((p) => p.items) ?? [];
  const known = new Set(server.map((m) => m.clientId).filter((c): c is string => !!c));
  return [...(outbox ?? []).filter((m) => !known.has(m.clientId ?? '')), ...server];
}

/** Rappel pour tous réussi : le message reste, sans corps, média ni réactions. */
export function markRecalled(data: MessagePages | undefined, messageId: string): MessagePages | undefined {
  if (!data) return data;
  return mapItems(data, (items) =>
    items.map((m) => (m.id === messageId ? { ...m, recalled: true, body: null, media: null, reactions: [], myReaction: null } : m)),
  );
}

/** `message.updated` (rappel) : remplace par id ; une réaction personnelle disparaît avec le rappel. */
export function applyMessageUpdated(data: MessagePages | undefined, msg: Message): MessagePages | undefined {
  if (!data) return data;
  return mapItems(data, (items) =>
    items.map((m) => (m.id === msg.id ? { ...msg, myReaction: msg.recalled ? null : m.myReaction } : m)),
  );
}

export function applyReaction(data: MessagePages | undefined, ev: MessageReactionEvent, myId: string): MessagePages | undefined {
  if (!data) return data;
  return mapItems(data, (items) =>
    items.map((m) =>
      m.id === ev.messageId ? { ...m, reactions: ev.reactions, myReaction: ev.userId === myId ? ev.emoji : m.myReaction } : m,
    ),
  );
}

/** Masquer pour moi. */
export function removeMessage(data: MessagePages | undefined, messageId: string): MessagePages | undefined {
  return data ? mapItems(data, (items) => items.filter((m) => m.id !== messageId)) : data;
}

/** Plus petit `seq` serveur d'une page (curseur `beforeSeq`). */
export function oldestSeq(page: { items: CachedMessage[] }): number | undefined {
  const seqs = page.items.filter((m) => !m.local).map((m) => m.seq);
  return seqs.length ? Math.min(...seqs) : undefined;
}

/** Plus grand `seq` serveur présent. */
export function newestServerSeq(data: MessagePages | undefined): number {
  let max = 0;
  for (const p of data?.pages ?? []) for (const m of p.items) if (!m.local && m.seq > max) max = m.seq;
  return max;
}

/* ---------- Liste des conversations ---------- */

export type ConversationPages = Pages<ConversationList>;

export function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
}

function mapConversations(data: ConversationPages, fn: (c: Conversation) => Conversation): ConversationPages {
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn) })) };
}

function resortFirstPage(data: ConversationPages): ConversationPages {
  const [first, ...rest] = data.pages;
  return first ? { ...data, pages: [{ ...first, items: sortConversations(first.items) }, ...rest] } : data;
}

export function hasConversation(data: ConversationPages | undefined, id: string): boolean {
  return !!data?.pages.some((p) => p.items.some((c) => c.id === id));
}

/** `message.new` : dernier message, activité, non-lus (sauf si l'écran est ouvert ou si c'est moi). */
export function applyMessageToConversation(
  data: ConversationPages | undefined,
  msg: Message,
  opts: { myId: string; openConversationId?: string | null },
): ConversationPages | undefined {
  if (!data || !hasConversation(data, msg.conversationId)) return data;
  const next = mapConversations(data, (c) => {
    if (c.id !== msg.conversationId) return c;
    const isNew = msg.seq > c.lastSeq;
    if (!isNew) return c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c;
    const mine = msg.senderId === opts.myId;
    const seen = opts.openConversationId === c.id;
    return {
      ...c,
      lastSeq: msg.seq,
      lastMessage: msg,
      lastActivityAt: msg.createdAt > c.lastActivityAt ? msg.createdAt : c.lastActivityAt,
      unreadCount: !mine && !seen && msg.kind !== 'system' ? c.unreadCount + 1 : c.unreadCount,
    };
  });
  return resortFirstPage(next);
}

export function applyMessageUpdatedToConversation(data: ConversationPages | undefined, msg: Message): ConversationPages | undefined {
  if (!data) return data;
  return mapConversations(data, (c) => (c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c));
}

export function applyConversationInfo(data: ConversationPages | undefined, info: ConversationInfo): ConversationPages | undefined {
  if (!data) return data;
  return mapConversations(data, (c) =>
    c.id === info.id
      ? { ...c, title: info.title, announcement: info.announcement, avatarUrl: info.avatarUrl, memberCount: info.memberCount }
      : c,
  );
}

/** Après `POST /read` : compteur de non-lus serveur. */
export function applyReadState(data: ConversationPages | undefined, state: ReceiptState): ConversationPages | undefined {
  if (!data) return data;
  return mapConversations(data, (c) =>
    c.id === state.conversationId ? { ...c, unreadCount: state.unreadCount, myLastReadSeq: state.lastReadSeq } : c,
  );
}

export function patchConversation(
  data: ConversationPages | undefined,
  id: string,
  patch: Partial<Pick<Conversation, 'pinned' | 'archived' | 'mutedUntil'>>,
): ConversationPages | undefined {
  if (!data) return data;
  return resortFirstPage(mapConversations(data, (c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function removeConversation(data: ConversationPages | undefined, id: string): ConversationPages | undefined {
  return data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== id) })) } : data;
}

export function isMuted(c: Pick<Conversation, 'mutedUntil'>, now = Date.now()): boolean {
  return !!c.mutedUntil && new Date(c.mutedUntil).getTime() > now;
}
