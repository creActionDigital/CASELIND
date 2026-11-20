import {
  type CreatePromotionRequest,
  promotionListSchema,
  promotionSchema,
  storefrontProductListSchema,
  type PromotionStatus,
  type UpdatePromotionRequest,
  wishlistListSchema,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export const promoKeys = {
  wishlist: ['wishlist'] as const,
  flash: ['flash-sales'] as const,
  org: (orgId: string) => ['org-promotions', orgId] as const,
};

export const fetchFlashSales = (cursor?: string, limit = PAGE) =>
  api.request('/promotions/flash', { query: { limit, cursor }, schema: storefrontProductListSchema });

export const fetchWishlist = (cursor?: string) => api.request('/me/wishlist', { query: { limit: PAGE, cursor }, schema: wishlistListSchema });
export const addWish = (productId: string) => api.request(`/me/wishlist/${productId}`, { method: 'PUT' });
export const removeWish = (productId: string) => api.request(`/me/wishlist/${productId}`, { method: 'DELETE' });

export const fetchOrgPromotions = (orgId: string, status?: PromotionStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/promotions`, { query: { status, limit: PAGE, cursor }, schema: promotionListSchema });
export const createPromotion = (orgId: string, body: CreatePromotionRequest) =>
  api.request(`/orgs/${orgId}/promotions`, { method: 'POST', body, schema: promotionSchema });
export const patchPromotion = (orgId: string, id: string, body: UpdatePromotionRequest) =>
  api.request(`/orgs/${orgId}/promotions/${id}`, { method: 'PATCH', body, schema: promotionSchema });
export const deletePromotion = (orgId: string, id: string) => api.request(`/orgs/${orgId}/promotions/${id}`, { method: 'DELETE' });
