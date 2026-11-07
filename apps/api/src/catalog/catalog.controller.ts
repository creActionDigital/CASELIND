import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type AdjustStockRequest,
  adjustStockRequestSchema,
  type CreateProductRequest,
  createProductRequestSchema,
  type OrgProductListQuery,
  orgProductListQuerySchema,
  type OrgStorefrontQuery,
  orgStorefrontQuerySchema,
  type Product,
  type ProductCategoryList,
  type ProductList,
  type StorefrontProductDetail,
  type StorefrontProductList,
  type StorefrontQuery,
  storefrontQuerySchema,
  type UpdateProductRequest,
  updateProductRequestSchema,
  type Variant,
} from '@caselind/contracts';
import { AppError } from '../common/app-error.js';
import { ReqMeta, type RequestMeta } from '../common/request-meta.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequireFlag } from '../flags/flag.guard.js';
import { CurrentMembership, type OrgMembership, OrgPermission } from '../orgs/org.guard.js';
import { roleHasPermission } from '../orgs/org-permissions.js';
import { type AuthUser, CurrentUser, Public } from '../security/auth.guard.js';
import { CatalogService } from './catalog.service.js';
import { StorefrontService } from './storefront.service.js';

function assertCanReadCatalog(m: OrgMembership): void {
  if (!roleHasPermission(m.role, 'catalog.manage') && !roleHasPermission(m.role, 'inventory.manage')) throw AppError.forbidden();
}

/** Seller side. Behind the `commerce` flag; a member without the permission gets 403, a non-member 404. */
@Controller()
@RequireFlag('commerce')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog/categories')
  categories(): Promise<ProductCategoryList> {
    return this.catalog.categories();
  }

  @Post('orgs/:orgId/products')
  @OrgPermission('catalog.manage')
  create(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createProductRequestSchema)) body: CreateProductRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Product> {
    return this.catalog.create(m.orgId, user.userId, body, meta);
  }

  /** Reading (products and variants with exact stock): `catalog.manage` or `inventory.manage`; writing stays `catalog.manage`. */
  @Get('orgs/:orgId/products')
  @OrgPermission('org.view')
  list(
    @CurrentMembership() m: OrgMembership,
    @Query(new ZodPipe(orgProductListQuerySchema)) query: OrgProductListQuery,
  ): Promise<ProductList> {
    assertCanReadCatalog(m);
    return this.catalog.list(m.orgId, query);
  }

  @Get('orgs/:orgId/products/:productId')
  @OrgPermission('org.view')
  get(@CurrentMembership() m: OrgMembership, @Param('productId') productId: string): Promise<Product> {
    assertCanReadCatalog(m);
    return this.catalog.get(m.orgId, productId);
  }

  @Patch('orgs/:orgId/products/:productId')
  @OrgPermission('catalog.manage')
  update(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodPipe(updateProductRequestSchema)) body: UpdateProductRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Product> {
    return this.catalog.update(m.orgId, user.userId, productId, body, meta);
  }

  /** Archives (never deletes): orders keep referring to the product. */
  @Delete('orgs/:orgId/products/:productId')
  @OrgPermission('catalog.manage')
  @HttpCode(204)
  async archive(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.catalog.archive(m.orgId, user.userId, productId, meta);
  }

  /** `inventory.manage` or `catalog.manage`: the guard only checks membership, the role check is here. */
  @Post('orgs/:orgId/variants/:variantId/stock')
  @OrgPermission('org.view')
  @HttpCode(200)
  adjustStock(
    @CurrentMembership() m: OrgMembership,
    @CurrentUser() user: AuthUser,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(adjustStockRequestSchema)) body: AdjustStockRequest,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Variant> {
    if (!roleHasPermission(m.role, 'inventory.manage') && !roleHasPermission(m.role, 'catalog.manage')) throw AppError.forbidden();
    return this.catalog.adjustStock(m.orgId, user.userId, variantId, body, meta);
  }
}

/** Buyer side for signed-in users. */
@Controller('products')
@RequireFlag('commerce')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(storefrontQuerySchema)) q: StorefrontQuery): Promise<StorefrontProductList> {
    return this.storefront.search(user.userId, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StorefrontProductDetail> {
    return this.storefront.detail(user.userId, id);
  }
}

/** Public storefront of one organisation: no token, so it can be shared and indexed. */
@Controller('public/orgs')
export class PublicCatalogController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get(':slug/products')
  @Public()
  products(@Param('slug') slug: string, @Query(new ZodPipe(orgStorefrontQuerySchema)) q: OrgStorefrontQuery): Promise<StorefrontProductList> {
    return this.storefront.byOrgSlug(slug, q);
  }
}
