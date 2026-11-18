import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { type DeliveryProof, type SetDeliveryProofRequest, setDeliveryProofRequestSchema } from '@caselind/contracts';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { DeliveryProofService } from './delivery-proof.service.js';

/** Photo / signature proof of a delivery: set by the assigned courier, read by the courier, the buyer and the seller's order viewers (others: 404). */
@Controller('deliveries/:id/proof')
@RequireFlag('commerce')
export class DeliveryProofController {
  constructor(private readonly proofs: DeliveryProofService) {}

  @Put()
  set(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(setDeliveryProofRequestSchema)) body: SetDeliveryProofRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<DeliveryProof> {
    return this.proofs.set(user.userId, id, body, meta);
  }

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<DeliveryProof> {
    return this.proofs.get(user.userId, id);
  }
}
