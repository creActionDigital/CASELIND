import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

export const SOCKET_IO_PATH = '/v1/socket.io';

/** Socket.IO has its own CORS option; it reuses CORS_ORIGINS and is closed when none is configured. */
export class CaselindIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      path: SOCKET_IO_PATH,
      cors: { origin: this.corsOrigins.length ? this.corsOrigins : false, credentials: false },
      // Only tiny client events (typing) are accepted.
      maxHttpBufferSize: 16 * 1024,
    } as ServerOptions);
  }
}
