import type { Conversation, Message } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { createThrottle } from '../realtime/throttle';
import {
  applyMessageToConversation,
  applyReaction,
  buildOptimisticMessage,
  displayMessages,
  outboxAdd,
  outboxMark,
  outboxRemove,
  upsertServerMessage,
  type ConversationPages,
  type MessagePages,
} from './cache';
import { mergeReceipt, receiptStatus } from './receipts';

const CONV = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const PEER = '33333333-3333-4333-8333-333333333333';
const CID = '44444444-4444-4444-8444-444444444444';

function msg(over: Partial<Message>): Message {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    conversationId: CONV,
    seq: 1,
    kind: 'text',
    senderId: ME,
    clientId: null,
    body: 'x',
    media: null,
    replyToId: null,
    mentions: [],
    systemEvent: null,
    recalled: false,
    reactions: [],
    myReaction: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    forwarded: false,
    expiresAt: null,
    favorited: false,
    poll: null,
    ...over,
  };
}

const empty = (): MessagePages => ({ pages: [{ items: [], hasMore: false }], pageParams: [undefined] });
const ids = (d: MessagePages) => d.pages.flatMap((p) => p.items.map((m) => m.id));

describe('fusion des messages', () => {
  it('remplace le message optimiste par le message serveur via clientId', () => {
    const opt = buildOptimisticMessage({ conversationId: CONV, senderId: ME, clientId: CID, kind: 'text', body: 'salut' });
    const outbox = outboxAdd([], opt);
    expect(displayMessages(empty(), outbox)[0].local).toBe('sending');
    const server = msg({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seq: 7, clientId: CID, body: 'salut' });
    const shown = displayMessages(upsertServerMessage(empty(), server), outbox);
    expect(shown).toHaveLength(1);
    expect(shown[0].seq).toBe(7);
    expect(shown[0].local).toBeUndefined();
  });

  it('pas de doublon si message.new arrive avant la réponse HTTP', () => {
    const opt = buildOptimisticMessage({ conversationId: CONV, senderId: ME, clientId: CID, kind: 'text', body: 'a' });
    const server = msg({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seq: 3, clientId: CID });
    let data = upsertServerMessage(empty(), server); // événement socket
    expect(displayMessages(data, outboxAdd([], opt))).toHaveLength(1); // HTTP pas encore revenu
    data = upsertServerMessage(data, server); // réponse HTTP
    expect(ids(data)).toEqual([server.id]);
    expect(displayMessages(data, outboxRemove(outboxAdd([], opt), CID))).toHaveLength(1);
  });

  it('message.new reçu sans optimiste : inséré, trié du plus récent au plus ancien', () => {
    let data = upsertServerMessage(empty(), msg({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', seq: 2 }));
    data = upsertServerMessage(data, msg({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', seq: 3 }));
    data = upsertServerMessage(data, msg({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', seq: 3 }));
    expect(data.pages[0].items.map((m) => m.seq)).toEqual([3, 2]);
  });

  it('un message en échec reste en tête et se réessaie avec le même clientId', () => {
    const opt = buildOptimisticMessage({ conversationId: CONV, senderId: ME, clientId: CID, kind: 'text', body: 'a' });
    let outbox = outboxMark(outboxAdd([], opt), CID, 'failed');
    expect(displayMessages(empty(), outbox)[0].local).toBe('failed');
    outbox = outboxAdd(outbox, opt); // réessai : même clientId, pas de second message
    expect(outbox).toHaveLength(1);
    expect(outbox[0].local).toBe('sending');
  });

  it('applyReaction ne touche myReaction que pour moi', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const data = upsertServerMessage(empty(), msg({ id, seq: 1 }));
    const ev = { conversationId: CONV, messageId: id, userId: PEER, emoji: '👍', reactions: [{ emoji: '👍', count: 1 }] };
    expect(applyReaction(data, ev, ME)!.pages[0].items[0].myReaction).toBeNull();
    expect(applyReaction(data, { ...ev, userId: ME }, ME)!.pages[0].items[0].myReaction).toBe('👍');
  });
});

function conv(over: Partial<Conversation>): Conversation {
  return {
    id: CONV,
    kind: 'direct',
    title: null,
    announcement: null,
    avatarUrl: null,
    peer: null,
    memberCount: 2,
    myRole: 'member',
    lastSeq: 1,
    lastMessage: null,
    unreadCount: 0,
    myLastReadSeq: 1,
    mutedUntil: null,
    pinned: false,
    archived: false,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    disappearingSeconds: null,
    draft: null,
    ...over,
  };
}

describe('liste des conversations', () => {
  const other = '66666666-6666-4666-8666-666666666666';
  const pages = (): ConversationPages => ({
    pages: [{ items: [conv({ id: other, pinned: true }), conv({})], nextCursor: null }],
    pageParams: [undefined],
  });

  it('incrémente les non-lus pour un message reçu et garde les épinglées d’abord', () => {
    const next = applyMessageToConversation(pages(), msg({ seq: 2, senderId: PEER, createdAt: '2026-02-01T00:00:00.000Z' }), { myId: ME })!;
    expect(next.pages[0].items.map((c) => c.id)).toEqual([other, CONV]);
    expect(next.pages[0].items[1].unreadCount).toBe(1);
    expect(next.pages[0].items[1].lastMessage?.seq).toBe(2);
  });

  it('pas de non-lu pour mon message ni quand le salon est ouvert, ni pour un événement rejoué', () => {
    const m = msg({ seq: 2, senderId: PEER });
    expect(applyMessageToConversation(pages(), { ...m, senderId: ME }, { myId: ME })!.pages[0].items[1].unreadCount).toBe(0);
    expect(applyMessageToConversation(pages(), m, { myId: ME, openConversationId: CONV })!.pages[0].items[1].unreadCount).toBe(0);
    const once = applyMessageToConversation(pages(), m, { myId: ME })!;
    expect(applyMessageToConversation(once, m, { myId: ME })!.pages[0].items[1].unreadCount).toBe(1);
  });
});

describe('état d’accusé', () => {
  it('envoi, échec, envoyé, reçu, lu', () => {
    expect(receiptStatus({ seq: 5, local: 'sending' }, [])).toBe('sending');
    expect(receiptStatus({ seq: 5, local: 'failed' }, [])).toBe('failed');
    expect(receiptStatus({ seq: 5 }, [{ delivered: 0, read: 0 }])).toBe('sent');
    expect(receiptStatus({ seq: 5 }, [{ delivered: 5, read: 2 }])).toBe('delivered');
    expect(receiptStatus({ seq: 5 }, [{ delivered: 5, read: 5 }])).toBe('read');
  });

  it('en groupe, il faut que tous aient lu ; une lecture masquée ne vaut pas « lu »', () => {
    expect(receiptStatus({ seq: 5 }, [{ delivered: 5, read: 5 }, { delivered: 5, read: 1 }])).toBe('delivered');
    expect(receiptStatus({ seq: 5 }, [{ delivered: 5, read: null }])).toBe('delivered');
    expect(receiptStatus({ seq: 5 }, [{ delivered: 4, read: 5 }])).toBe('read');
  });

  it('mergeReceipt est monotone et conserve une lecture masquée', () => {
    let map = mergeReceipt(undefined, { conversationId: CONV, userId: PEER, lastDeliveredSeq: 4, lastReadSeq: 3 });
    map = mergeReceipt(map, { conversationId: CONV, userId: PEER, lastDeliveredSeq: 2, lastReadSeq: null });
    expect(map[PEER]).toEqual({ delivered: 4, read: 3 });
  });
});

describe('limitation de typing', () => {
  it('au plus un envoi par 2 s et par conversation', () => {
    let t = 1000;
    const th = createThrottle(2000, () => t);
    expect(th.allow('a')).toBe(true);
    t = 2500;
    expect(th.allow('a')).toBe(false);
    expect(th.allow('b')).toBe(true);
    t = 3000;
    expect(th.allow('a')).toBe(true);
  });
});
