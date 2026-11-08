import { Injectable, Logger } from '@nestjs/common';

/** Server → client events. Payloads are the contract schemas of the module that emits them. */
export type RealtimeEvent =
  | 'message.new'
  | 'message.updated'
  | 'message.reaction'
  | 'receipt.updated'
  | 'conversation.updated'
  | 'conversation.member_added'
  | 'conversation.member_removed'
  | 'draft.updated'
  | 'typing'
  | 'notification.new'
  /** Lot 8: status of a delivery (user room of the buyer and of the courier) and the courier position (room of the order). */
  | 'delivery.updated'
  | 'delivery.location';

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
export const orderRoom = (orderId: string) => `order:${orderId}`;
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

/**
 * Lists the conversations a user's sockets must join on connection. The messaging module provides
 * the real implementation; the default joins nothing.
 */
export abstract class ConversationRoomsResolver {
  abstract conversationIdsFor(userId: string): Promise<string[]>;
}
export class NoConversationRooms extends ConversationRoomsResolver {
  async conversationIdsFor(): Promise<string[]> {
    return [];
  }
}

/** Minimal view of the Socket.IO server used here (keeps this port free of transport imports). */
export interface RealtimeServer {
  to(room: string): { emit(event: string, payload: unknown): unknown };
  in(room: string): {
    socketsJoin(room: string): unknown;
    socketsLeave(room: string): unknown;
    disconnectSockets(close?: boolean): unknown;
  };
}

/**
 * The only way other modules talk to connected clients. Every broadcast goes through a room
 * (`user:<id>`, `conversation:<id>`, `session:<id>`) so a Redis adapter can be added later without
 * code changes. All methods are fire-and-forget and never throw; call them after the database
 * commit. The realtime gateway binds the server; without one (HTTP-only tests) they are no-ops.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: RealtimeServer | null = null;

  bind(server: RealtimeServer | null): void {
    this.server = server;
  }

  emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
    this.run(() => this.server?.to(userRoom(userId)).emit(event, payload));
  }
  emitToConversation(conversationId: string, event: RealtimeEvent, payload: unknown): void {
    this.run(() => this.server?.to(conversationRoom(conversationId)).emit(event, payload));
  }
  /** Makes the users' connected sockets join (or leave) a conversation room. */
  addToConversation(userIds: string[], conversationId: string): void {
    for (const id of userIds) {
      this.run(() => this.server?.in(userRoom(id)).socketsJoin(conversationRoom(conversationId)));
    }
  }
  removeFromConversation(userId: string, conversationId: string): void {
    this.run(() => this.server?.in(userRoom(userId)).socketsLeave(conversationRoom(conversationId)));
  }
  emitToOrder(orderId: string, event: RealtimeEvent, payload: unknown): void {
    this.run(() => this.server?.to(orderRoom(orderId)).emit(event, payload));
  }
  /** Lot 8: the users' connected sockets join the room of an order (the buyer only, for the courier position). */
  addToOrder(userIds: string[], orderId: string): void {
    for (const id of userIds) this.run(() => this.server?.in(userRoom(id)).socketsJoin(orderRoom(orderId)));
  }
  removeFromOrder(userIds: string[], orderId: string): void {
    for (const id of userIds) this.run(() => this.server?.in(userRoom(id)).socketsLeave(orderRoom(orderId)));
  }
  /** Closes sockets authenticated with this session (session revoked, logout). */
  disconnectSession(sessionId: string): void {
    this.run(() => this.server?.in(sessionRoom(sessionId)).disconnectSockets(true));
  }
  /** Closes every socket of the user (suspension, deletion request, password reset). */
  disconnectUser(userId: string): void {
    this.run(() => this.server?.in(userRoom(userId)).disconnectSockets(true));
  }

  private run(fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      this.logger.warn(`realtime operation failed: ${(err as Error).name}`);
    }
  }
}
