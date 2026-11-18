import {
  conversationInfoSchema,
  messageReactionEventSchema,
  messageSchema,
  notificationSchema,
  pollEventSchema,
  presenceSchema,
  receiptEventSchema,
} from '@caselind/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import { api, useAuth } from '../auth/auth-context';
import { API_ORIGIN } from '../lib/config';
import {
  applyConversationInfo,
  applyMessageToConversation,
  applyMessageUpdated,
  applyMessageUpdatedToConversation,
  applyReaction,
  upsertServerMessage,
  type ConversationPages,
  type MessagePages,
} from '../messaging/cache';
import { extrasKeys } from '../messaging/extras-api';
import { qk } from '../messaging/keys';
import { mergeReceipt, type ReceiptMap } from '../messaging/receipts';
import { presenceKey } from '../messaging/social-api';
import { applyPollEvent } from '../messaging/social-logic';
import { createRealtimeSocket, isUnauthenticated } from './socket';
import { createThrottle, TYPING_EMIT_INTERVAL_MS, TYPING_EXPIRE_MS } from './throttle';

interface RealtimeValue {
  connected: boolean;
  /** Émet `typing` (au plus toutes les 2 s par conversation). */
  emitTyping(conversationId: string): void;
  /** Salon actuellement visible : ses messages ne comptent pas comme non lus. */
  setActiveConversation(id: string | null): void;
  socket: Socket | null;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

/** Un seul socket pour l'application, ouvert tant que l'utilisateur est connecté. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, me } = useAuth();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const activeRef = useRef<string | null>(null);
  const throttle = useRef(createThrottle(TYPING_EMIT_INTERVAL_MS)).current;
  const myId = me?.id ?? null;

  useEffect(() => {
    if (status !== 'signedIn' || !myId) return;
    const s = createRealtimeSocket({ url: API_ORIGIN, getToken: () => api.getAccessToken() });
    let refreshedOnce = false;

    const setConv = (fn: (d: ConversationPages | undefined) => ConversationPages | undefined) =>
      queryClient.setQueriesData<ConversationPages>({ queryKey: qk.conversationsAll }, fn);

    s.on('connect', () => {
      refreshedOnce = false;
      setConnected(true);
      // Rattrapage des événements manqués pendant une coupure.
      void queryClient.invalidateQueries({ queryKey: qk.conversationsAll });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['presence'] });
      void queryClient.invalidateQueries({ queryKey: qk.unreadCount });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err) => {
      setConnected(false);
      if (!isUnauthenticated(err) || refreshedOnce) return;
      // Jeton expiré : un seul rafraîchissement partagé avec le client API, puis nouvelle tentative.
      refreshedOnce = true;
      api
        .restore()
        .then(() => s.connect())
        .catch(() => {
          /* session perdue : le client API déconnecte l'utilisateur ; erreur réseau : pas de boucle. */
        });
    });

    s.on('message.new', (raw: unknown) => {
      const parsed = messageSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      queryClient.setQueryData<MessagePages>(qk.messages(msg.conversationId), (d) => (d ? upsertServerMessage(d, msg) : d));
      const known = queryClient
        .getQueriesData<ConversationPages>({ queryKey: qk.conversationsAll })
        .some(([, d]) => d?.pages.some((p) => p.items.some((c) => c.id === msg.conversationId)));
      if (!known) void queryClient.invalidateQueries({ queryKey: qk.conversationsAll });
      setConv((d) => applyMessageToConversation(d, msg, { myId, openConversationId: activeRef.current }));
      if (msg.senderId !== myId && msg.kind !== 'system') {
        // Accusé de réception immédiat, sans attendre l'ouverture du salon.
        api
          .request(`/conversations/${msg.conversationId}/delivered`, { method: 'POST', body: { seq: msg.seq } })
          .catch(() => undefined);
      }
    });
    s.on('message.updated', (raw: unknown) => {
      const parsed = messageSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      queryClient.setQueryData<MessagePages>(qk.messages(msg.conversationId), (d) => applyMessageUpdated(d, msg));
      setConv((d) => applyMessageUpdatedToConversation(d, msg));
    });
    s.on('message.reaction', (raw: unknown) => {
      const parsed = messageReactionEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const ev = parsed.data;
      queryClient.setQueryData<MessagePages>(qk.messages(ev.conversationId), (d) => applyReaction(d, ev, myId));
    });
    // Sondage : compteurs frais pour tous (mes votes restent ceux du cache).
    s.on('message.poll', (raw: unknown) => {
      const parsed = pollEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const ev = parsed.data;
      queryClient.setQueryData<MessagePages>(qk.messages(ev.conversationId), (d) =>
        d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: applyPollEvent(p.items, ev) })) } : d,
      );
    });
    // Présence d'un pair direct (déjà filtrée côté serveur : confidentialité, blocages, réciprocité).
    s.on('presence.updated', (raw: unknown) => {
      const parsed = presenceSchema.safeParse(raw);
      if (parsed.success) queryClient.setQueryData(presenceKey(parsed.data.userId), parsed.data);
    });
    s.on('receipt.updated', (raw: unknown) => {
      const parsed = receiptEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const ev = parsed.data;
      if (ev.userId === myId) {
        // Lu sur un autre appareil : le compteur de non-lus change.
        void queryClient.invalidateQueries({ queryKey: qk.conversationsAll });
        return;
      }
      queryClient.setQueryData<ReceiptMap>(qk.receipts(ev.conversationId), (m) => mergeReceipt(m, ev));
    });
    s.on('conversation.updated', (raw: unknown) => {
      const parsed = conversationInfoSchema.safeParse(raw);
      if (!parsed.success) return;
      const info = parsed.data;
      setConv((d) => applyConversationInfo(d, info));
      void queryClient.invalidateQueries({ queryKey: qk.conversation(info.id) });
    });
    const membership = () => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: qk.conversationsAll });
    };
    s.on('conversation.member_added', membership);
    s.on('conversation.member_removed', membership);
    // Brouillon modifié depuis un autre appareil (ou écho du nôtre) : le salon décide s'il l'applique.
    s.on('draft.updated', (raw: unknown) => {
      const ev = raw as { conversationId?: unknown; body?: unknown } | null;
      if (!ev || typeof ev.conversationId !== 'string') return;
      const body = typeof ev.body === 'string' && ev.body.length > 0 ? ev.body : null;
      queryClient.setQueryData<string | null>(extrasKeys.draft(ev.conversationId), body);
    });
    s.on('notification.new', (raw: unknown) => {
      if (!notificationSchema.safeParse(raw).success) return;
      void queryClient.invalidateQueries({ queryKey: qk.notifications });
      void queryClient.invalidateQueries({ queryKey: qk.unreadCount });
    });

    setSocket(s);
    s.connect();
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setConnected(false);
      throttle.reset();
    };
  }, [status, myId, queryClient, throttle]);

  const socketRef = useRef<Socket | null>(null);
  socketRef.current = socket;

  const emitTyping = useCallback(
    (conversationId: string) => {
      const s = socketRef.current;
      if (s?.connected && throttle.allow(conversationId)) s.emit('typing', { conversationId });
    },
    [throttle],
  );
  const setActiveConversation = useCallback((id: string | null) => {
    activeRef.current = id;
  }, []);

  const value = useMemo(
    () => ({ connected, emitTyping, setActiveConversation, socket }),
    [connected, emitTyping, setActiveConversation, socket],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}

/** Utilisateurs en train d'écrire dans une conversation (s'éteint après quelques secondes sans événement). */
export function useTypingUsers(conversationId: string): string[] {
  const { socket } = useRealtime();
  const [typing, setTyping] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!socket) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const onTyping = (ev: { conversationId?: string; userId?: string }) => {
      if (ev?.conversationId !== conversationId || !ev.userId) return;
      const userId = ev.userId;
      setTyping((t) => ({ ...t, [userId]: Date.now() }));
      clearTimeout(timers.get(userId));
      timers.set(
        userId,
        setTimeout(() => {
          setTyping((t) => {
            const { [userId]: _gone, ...rest } = t;
            return rest;
          });
        }, TYPING_EXPIRE_MS),
      );
    };
    socket.on('typing', onTyping);
    return () => {
      socket.off('typing', onTyping);
      timers.forEach(clearTimeout);
      setTyping({});
    };
  }, [socket, conversationId]);
  return Object.keys(typing);
}
