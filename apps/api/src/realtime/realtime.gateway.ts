import { Inject, Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import type { AuthUser } from '../security/auth.guard.js';
import { SessionVerifier } from '../security/session-verifier.js';
import {
  ConversationRoomsResolver,
  conversationRoom,
  RealtimeService,
  sessionRoom,
  userRoom,
} from './realtime.service.js';

const typingPayloadSchema = z.object({ conversationId: z.uuid() });
const TYPING_MIN_INTERVAL_MS = 2000;

interface SocketData {
  auth?: AuthUser;
  typingAt?: Map<string, number>;
}

/**
 * Connection point for realtime clients (path /v1/socket.io). Authentication happens once, in a
 * Socket.IO middleware at the handshake, from `handshake.auth.token` only. Everything the server
 * sends goes through RealtimeService; the only client event accepted is `typing`.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private server: Server | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly verifier: SessionVerifier,
    private readonly rooms: ConversationRoomsResolver,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    this.realtime.bind(server);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('unauthenticated')),
      );
    });
    const every = this.env.REALTIME_SESSION_RECHECK_SECONDS;
    if (every > 0) {
      this.timer = setInterval(() => void this.recheckSessions(), every * 1000);
      this.timer.unref();
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.realtime.bind(null);
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token: unknown = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw new Error('no token');
    const auth = await this.verifier.verify(token);
    if (!auth) throw new Error('invalid');
    (socket.data as SocketData).auth = auth;
    socket.join([userRoom(auth.userId), sessionRoom(auth.sessionId)]);
    const conversationIds = await this.rooms.conversationIdsFor(auth.userId);
    if (conversationIds.length > 0) socket.join(conversationIds.map(conversationRoom));
  }

  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const parsed = typingPayloadSchema.safeParse(body);
    const data = client.data as SocketData;
    if (!parsed.success || !data.auth) return;
    const { conversationId } = parsed.data;
    const room = conversationRoom(conversationId);
    if (!client.rooms.has(room)) return;
    const typingAt = (data.typingAt ??= new Map());
    const now = Date.now();
    const last = typingAt.get(conversationId);
    if (last !== undefined && now - last < TYPING_MIN_INTERVAL_MS) return;
    typingAt.set(conversationId, now);
    client.to(room).emit('typing', { conversationId, userId: data.auth.userId });
  }

  /** Safety net for suspensions and any revocation that did not go through RealtimeService. */
  private async recheckSessions(): Promise<void> {
    try {
      if (!this.server) return;
      const sockets = await this.server.fetchSockets();
      const ids = new Set<string>();
      for (const s of sockets) {
        const id = (s.data as SocketData).auth?.sessionId;
        if (id) ids.add(id);
      }
      const live = await this.verifier.liveSessionIds([...ids]);
      for (const id of ids) {
        if (!live.has(id)) this.server.in(sessionRoom(id)).disconnectSockets(true);
      }
    } catch (err) {
      this.logger.warn(`session recheck failed: ${(err as Error).name}`);
    }
  }
}
