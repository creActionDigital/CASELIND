import { io, type Socket } from 'socket.io-client';

export const SOCKET_PATH = '/v1/socket.io';

export interface RealtimeSocketOptions {
  /** Origine de l'API (sans /v1). */
  url: string;
  /** Jeton d'accès courant, relu à chaque (re)connexion. */
  getToken(): string | null;
}

/**
 * Crée le socket de l'application (non connecté tant que `connect()` n'est pas appelé).
 * `auth` est une fonction : une reconnexion embarque le jeton courant, jamais un jeton périmé.
 */
export function createRealtimeSocket({ url, getToken }: RealtimeSocketOptions): Socket {
  return io(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    auth: (cb) => cb({ token: getToken() }),
  });
}

/** Le refus d'authentification arrive en `connect_error` de message `unauthenticated`. */
export function isUnauthenticated(err: unknown): boolean {
  return err instanceof Error && err.message === 'unauthenticated';
}
