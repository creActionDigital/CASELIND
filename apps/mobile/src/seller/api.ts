import {
  couponListSchema,
  couponSchema,
  myOrgMembershipListSchema,
  myOrgMembershipSchema,
  orderDetailSchema,
  orderListSchema,
  orgSchema,
  productCategoryListSchema,
  productListSchema,
  productSchema,
  orgReviewListSchema,
  reviewSchema,
  salesSummarySchema,
  businessDocumentListSchema,
  businessDocumentSchema,
  type CreateDocumentRequest,
  type DocumentStatus,
  variantSchema,
  type CreateCouponRequest,
  type OrderStatus,
  type OrgReviewList,
  type OrgKind,
  type ProductStatus,
} from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';

export const sk = {
  myOrgs: ['seller', 'my-orgs'] as const,
  categories: ['seller', 'categories'] as const,
  products: (orgId: string) => ['seller', orgId, 'products'] as const,
  product: (orgId: string, id: string) => ['seller', orgId, 'product', id] as const,
  orders: (orgId: string) => ['seller', orgId, 'orders'] as const,
  order: (orgId: string, id: string) => ['seller', orgId, 'order', id] as const,
  coupons: (orgId: string) => ['seller', orgId, 'coupons'] as const,
  reviews: (orgId: string) => ['seller', orgId, 'reviews'] as const,
  count: (orgId: string, name: string) => ['seller', orgId, 'count', name] as const,
};

export const fetchMyOrgs = () => api.request('/me/orgs', { schema: myOrgMembershipListSchema });
export const createOrg = (body: { slug: string; name: string; kind: OrgKind; city?: string; phone?: string }) =>
  api.request('/orgs', { method: 'POST', body, schema: orgSchema });
export const acceptInvitation = (orgId: string) =>
  api.request(`/me/org-invitations/${orgId}/accept`, { method: 'POST', schema: myOrgMembershipSchema });
export const declineInvitation = (orgId: string) => api.request(`/me/org-invitations/${orgId}/decline`, { method: 'POST' });

export const fetchCategories = () => api.request('/catalog/categories', { schema: productCategoryListSchema });

export const fetchProducts = (orgId: string, status?: ProductStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/products`, { query: { status, cursor, limit: 20 }, schema: productListSchema });
export const fetchProduct = (orgId: string, id: string) => api.request(`/orgs/${orgId}/products/${id}`, { schema: productSchema });
export const createProduct = (orgId: string, body: unknown) =>
  api.request(`/orgs/${orgId}/products`, { method: 'POST', body, schema: productSchema });
export const patchProduct = (orgId: string, id: string, body: unknown) =>
  api.request(`/orgs/${orgId}/products/${id}`, { method: 'PATCH', body, schema: productSchema });
export const archiveProduct = (orgId: string, id: string) => api.request(`/orgs/${orgId}/products/${id}`, { method: 'DELETE' });
export const adjustStock = (orgId: string, variantId: string, delta: number, reason: 'restock' | 'adjustment' | 'damage') =>
  api.request(`/orgs/${orgId}/variants/${variantId}/stock`, { method: 'POST', body: { delta, reason }, schema: variantSchema });

export const fetchOrders = (orgId: string, status?: OrderStatus, cursor?: string) =>
  api.request(`/orgs/${orgId}/orders`, { query: { status, cursor, limit: 20 }, schema: orderListSchema });
export const fetchOrder = (orgId: string, id: string) => api.request(`/orgs/${orgId}/orders/${id}`, { schema: orderDetailSchema });
export const changeOrderStatus = (orgId: string, id: string, status: OrderStatus, note?: string) =>
  api.request(`/orgs/${orgId}/orders/${id}/status`, { method: 'POST', body: { status, note }, schema: orderDetailSchema });

export const fetchCoupons = (orgId: string, cursor?: string) =>
  api.request(`/orgs/${orgId}/coupons`, { query: { cursor, limit: 50 }, schema: couponListSchema });
export const createCoupon = (orgId: string, body: CreateCouponRequest) =>
  api.request(`/orgs/${orgId}/coupons`, { method: 'POST', body, schema: couponSchema });
export const deactivateCoupon = (orgId: string, id: string) =>
  api.request(`/orgs/${orgId}/coupons/${id}`, { method: 'PATCH', body: { active: false }, schema: couponSchema });

export const fetchOrgReviews = (orgId: string, status: 'all' | 'unanswered', cursor?: string): Promise<OrgReviewList> =>
  api.request(`/orgs/${orgId}/reviews`, { query: { status, cursor, limit: 20 }, schema: orgReviewListSchema });
export const replyToReview = (orgId: string, reviewId: string, body: string) =>
  api.request(`/orgs/${orgId}/reviews/${reviewId}/reply`, { method: 'POST', body: { body }, schema: reviewSchema });

/** Adhésions (invitations en attente comprises) de l'utilisateur connecté. */
export function useMyOrgs() {
  const { status } = useAuth();
  return useQuery({ queryKey: sk.myOrgs, queryFn: fetchMyOrgs, enabled: status === 'signedIn' });
}

/** Adhésion active à une organisation (rôle pour masquer ce que le rôle ne permet pas). */
export function useMembership(orgId: string) {
  const q = useMyOrgs();
  const m = q.data?.items.find((i) => i.org.id === orgId && i.status === 'active');
  return { ...q, membership: m, role: m?.role };
}

export const fetchSalesSummary = (orgId: string, days: number) => api.request(`/orgs/${orgId}/sales-summary`, { query: { days }, schema: salesSummarySchema });

export const dk = {
  list: (orgId: string, kind: string) => ['seller', orgId, 'documents', kind] as const,
  all: (orgId: string) => ['seller', orgId, 'documents'] as const,
  one: (orgId: string, id: string) => ['seller', orgId, 'document', id] as const,
};
export const fetchDocuments = (orgId: string, kind?: 'quote' | 'invoice') => api.request(`/orgs/${orgId}/documents`, { query: kind ? { kind } : {}, schema: businessDocumentListSchema });
export const fetchDocument = (orgId: string, id: string) => api.request(`/orgs/${orgId}/documents/${id}`, { schema: businessDocumentSchema });
export const createDocument = (orgId: string, body: CreateDocumentRequest) => api.request(`/orgs/${orgId}/documents`, { method: 'POST', body, schema: businessDocumentSchema });
export const setDocumentStatus = (orgId: string, id: string, status: DocumentStatus) => api.request(`/orgs/${orgId}/documents/${id}/status`, { method: 'POST', body: { status }, schema: businessDocumentSchema });
export const convertDocument = (orgId: string, id: string) => api.request(`/orgs/${orgId}/documents/${id}/convert`, { method: 'POST', schema: businessDocumentSchema });
