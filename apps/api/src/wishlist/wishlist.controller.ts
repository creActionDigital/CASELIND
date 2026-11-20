import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { type PageQuery, pageQuerySchema, type WishlistList } from '@caselind/contracts';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { type AuthUser, CurrentUser } from '../security/auth.guard.js';
import { WishlistService } from './wishlist.service.js';

@Controller('me/wishlist')
@RequireFlag('commerce')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuerySchema)) q: PageQuery): Promise<WishlistList> {
    return this.wishlist.list(user.userId, q);
  }

  @Put(':productId')
  @HttpCode(204)
  async add(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<void> {
    await this.wishlist.add(user.userId, productId);
  }

  @Delete(':productId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<void> {
    await this.wishlist.remove(user.userId, productId);
  }
}
