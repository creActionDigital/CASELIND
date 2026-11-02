import { Logger } from '@nestjs/common';

export interface PushMessage {
  /** Provider push token. */
  to: string;
  title: string;
  body: string;
  /** Opaque routing data for the client. */
  data: Record<string, string>;
  /** true = delivered even in quiet mode (informational for the provider). */
  urgent: boolean;
}

/** One result per message, in the same order as the input. */
export type PushResult =
  | { status: 'ok' }
  | { status: 'error'; error: 'DeviceNotRegistered' | 'Failed' };

/**
 * Port towards the push provider. The only implementation that talks to a provider SDK is
 * ExpoPushGateway; tests inject a fake. `send` should not throw, but callers tolerate it.
 */
export abstract class PushGateway {
  abstract send(messages: PushMessage[]): Promise<PushResult[]>;
}

/** Development adapter: journals the number of pushes, never their content or tokens. */
export class LogPushGateway extends PushGateway {
  private readonly logger = new Logger('LogPushGateway');

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.logger.log(`push (not delivered, log provider): ${messages.length} message(s)`);
    return messages.map(() => ({ status: 'ok' }));
  }
}
