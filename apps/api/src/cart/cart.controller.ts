import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { type Cart, type SetCartItemRequest, setCartItemRequestSchema } from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { CartService } from './cart.service.js';

@Controller('cart')
@RequireFlag('commerce')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Cart> {
    return this.cart.get(user.userId);
  }

  @Put('items/:variantId')
  setItem(
    @CurrentUser() user: AuthUser,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(setCartItemRequestSchema)) body: SetCartItemRequest,
  ): Promise<Cart> {
    return this.cart.setItem(user.userId, variantId, body.quantity);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser): Promise<void> {
    await this.cart.clear(user.userId);
  }
}
