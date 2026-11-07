import {
  orgWalletSchema,
  publicProfileSchema,
  walletSchema,
  walletTransactionListSchema,
  walletTransferResponseSchema,
  type SandboxTopupRequest,
  type WalletTransferRequest,
} from '@caselind/contracts';
import { api } from '../auth/auth-context';

const PAGE = 20;

export const fetchWallet = () => api.request('/wallet', { schema: walletSchema });
export const fetchTransactions = (currency: string | undefined, cursor?: string) =>
  api.request('/wallet/transactions', { query: { currency, limit: PAGE, cursor }, schema: walletTransactionListSchema });
export const sendTransfer = (body: WalletTransferRequest) =>
  api.request('/wallet/transfers', { method: 'POST', body, schema: walletTransferResponseSchema });
export const sandboxTopup = (body: SandboxTopupRequest) =>
  api.request('/wallet/sandbox/topup', { method: 'POST', body, schema: walletTransferResponseSchema });
export const fetchUserByHandle = (handle: string) =>
  api.request(`/users/${encodeURIComponent(handle.replace(/^@/, '').toLowerCase())}`, { schema: publicProfileSchema });

export const fetchOrgWallet = (orgId: string) => api.request(`/orgs/${orgId}/wallet`, { schema: orgWalletSchema });
export const fetchOrgTransactions = (orgId: string, currency: string | undefined, cursor?: string) =>
  api.request(`/orgs/${orgId}/wallet/transactions`, { query: { currency, limit: PAGE, cursor }, schema: walletTransactionListSchema });
