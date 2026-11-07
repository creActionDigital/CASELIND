import { userFlagsSchema, type Wallet } from '@caselind/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, useAuth } from '../auth/auth-context';
import { fetchKyc } from './kyc-api';
import { fetchOrgTransactions, fetchOrgWallet, fetchTransactions, fetchWallet } from './api';

export const walletKeys = {
  wallet: ['wallet'] as const,
  transactions: (currency: string) => ['wallet-transactions', currency] as const,
  kyc: ['kyc'] as const,
  orgWallet: (orgId: string) => ['org-wallet', orgId] as const,
  orgTransactions: (orgId: string, currency: string) => ['org-wallet-transactions', orgId, currency] as const,
};

/** Flag `wallet.sandbox` (requête `flags` partagée avec l'écran Plus). `undefined` tant qu'inconnu. */
export function useWalletEnabled(): boolean | undefined {
  const { status } = useAuth();
  const flags = useQuery({
    queryKey: ['flags'],
    queryFn: () => api.request('/config/flags', { schema: userFlagsSchema }),
    enabled: status === 'signedIn',
  });
  if (!flags.data) return flags.isError ? false : undefined;
  return flags.data.flags['wallet.sandbox'] === true;
}

export function useWallet(enabled = true) {
  const flag = useWalletEnabled();
  return useQuery<Wallet>({ queryKey: walletKeys.wallet, queryFn: fetchWallet, enabled: enabled && flag === true, retry: false });
}

export function useTransactions(currency: string) {
  return useInfiniteQuery({
    queryKey: walletKeys.transactions(currency),
    queryFn: ({ pageParam }) => fetchTransactions(currency, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useKyc() {
  return useQuery({ queryKey: walletKeys.kyc, queryFn: fetchKyc, retry: false });
}

export function useOrgWallet(orgId: string) {
  return useQuery({ queryKey: walletKeys.orgWallet(orgId), queryFn: () => fetchOrgWallet(orgId) });
}

export function useOrgTransactions(orgId: string, currency: string) {
  return useInfiniteQuery({
    queryKey: walletKeys.orgTransactions(orgId, currency),
    queryFn: ({ pageParam }) => fetchOrgTransactions(orgId, currency, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
