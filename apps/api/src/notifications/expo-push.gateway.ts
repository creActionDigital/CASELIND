import { Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { PushGateway, type PushMessage, type PushResult } from './push-gateway.js';

/**
 * Expo Push adapter, the only file importing expo-server-sdk. Delayed receipts (Expo's second
 * phase, which reports tokens that failed after acceptance) are not processed yet.
 */
export class ExpoPushGateway extends PushGateway {
  private readonly logger = new Logger('ExpoPushGateway');
  private readonly expo: Expo;

  constructor(accessToken?: string) {
    super();
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const results: PushResult[] = messages.map(() => ({ status: 'error', error: 'Failed' }) as PushResult);
    const valid: { index: number; message: ExpoPushMessage }[] = [];
    messages.forEach((m, index) => {
      if (!Expo.isExpoPushToken(m.to)) {
        results[index] = { status: 'error', error: 'DeviceNotRegistered' };
        return;
      }
      valid.push({
        index,
        message: {
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data,
          sound: 'default',
          priority: m.urgent ? 'high' : 'default',
        },
      });
    });

    let offset = 0;
    for (const chunk of this.expo.chunkPushNotifications(valid.map((v) => v.message))) {
      const slice = valid.slice(offset, offset + chunk.length);
      offset += chunk.length;
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          const target = slice[i];
          if (!target) return;
          if (ticket.status === 'ok') results[target.index] = { status: 'ok' };
          else {
            results[target.index] = {
              status: 'error',
              error: ticket.details?.error === 'DeviceNotRegistered' ? 'DeviceNotRegistered' : 'Failed',
            };
          }
        });
      } catch (err) {
        this.logger.warn(`expo chunk failed: ${(err as Error).name}`);
      }
    }
    return results;
  }
}
