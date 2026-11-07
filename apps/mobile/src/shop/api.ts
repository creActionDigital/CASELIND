import {
  cartSchema,
  checkoutResponseSchema,
  orderDetailSchema,
  orderListSchema,
  productCategoryListSchema,
  publicOrgSchema,
  reviewListSchema,
  reviewSchema,
  storefrontProductDetailSchema,
  storefrontProductListSchema,
  type CheckoutRequest,
  type OrderStatus,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export interface ShopFilters {
  q?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  sort: 'recent' | 'price_asc' | 'price_desc';
  orgId?: string;
}

export const fetchCategories = () => api.request('/catalog/categories', { schema: productCategoryListSchema });
export const fetchProducts = (f: ShopFilters, cursor?: string) =>
  api.request('/products', { query: { ...f, limit: PAGE, cursor }, schema: storefrontProductListSchema });
export const fetchProduct = (id: string) => api.request(`/products/${id}`, { schema: storefrontProductDetailSchema });
export const fetchStore = (slug: string) => api.request(`/public/orgs/${encodeURIComponent(slug)}`, { schema: publicOrgSchema, auth: false });
export const fetchStoreProducts = (slug: string, cursor?: string) =>
  api.request(`/public/orgs/${encodeURIComponent(slug)}/products`, { query: { limit: PAGE, cursor }, schema: storefrontProductListSchema, auth: false });

export const fetchCart = () => api.request('/cart', { schema: cartSchema });
export const setCartItem = (variantId: string, quantity: number) =>
  api.request(`/cart/items/${variantId}`, { method: 'PUT', body: { quantity }, schema: cartSchema });

export const checkout = (body: CheckoutRequest) => api.request('/orders/checkout', { method: 'POST', body, schema: checkoutResponseSchema });
export const fetchOrders = (status: OrderStatus | undefined, cursor?: string) =>
  api.request('/orders', { query: { status, limit: PAGE, cursor }, schema: orderListSchema });
export const fetchOrder = (id: string) => api.request(`/orders/${id}`, { schema: orderDetailSchema });
export const cancelOrder = (id: string) => api.request(`/orders/${id}/cancel`, { method: 'POST', body: {}, schema: orderDetailSchema });

export const fetchReviews = (productId: string, cursor?: string) =>
  api.request(`/products/${productId}/reviews`, { query: { limit: PAGE, cursor }, schema: reviewListSchema });
export const createReview = (productId: string, body: { rating: number; body?: string }) =>
  api.request(`/products/${productId}/reviews`, { method: 'POST', body, schema: reviewSchema });
