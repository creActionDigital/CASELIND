import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@caselind/contracts';

/**
 * Payment methods a checkout may use. Only cash on delivery exists: no payment partner is chosen yet
 * (BACKLOG Q5) and no amount transits through CASELIND. A payment integration replaces this provider
 * (and extends the `PaymentMethod` contract and the orders CHECK constraint) without touching orders.
 */
@Injectable()
export class PaymentMethods {
  available(): PaymentMethod[] {
    return ['cash_on_delivery'];
  }

  isAvailable(method: string): method is PaymentMethod {
    return (this.available() as string[]).includes(method);
  }
}
