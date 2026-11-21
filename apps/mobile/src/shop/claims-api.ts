import { returnListSchema, type ReturnStatus } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const claimKeys = { mine: (status: ReturnStatus | 'all') => ['my-returns', status] as const };

/** Réclamations de l'acheteur (retours et litiges de toutes ses commandes), plus récentes d'abord. */
export const fetchMyClaims = (status: ReturnStatus | 'all', cursor?: string) =>
  api.request('/me/returns', { query: { status: status === 'all' ? undefined : status, limit: 20, cursor }, schema: returnListSchema });
