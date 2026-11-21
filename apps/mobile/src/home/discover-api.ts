import { recommendedMerchantsSchema, recommendedPeopleSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export const fetchPeople = (limit = 10) => api.request('/discover/people', { query: { limit }, schema: recommendedPeopleSchema });
export const fetchMerchants = (limit = 10) => api.request('/discover/merchants', { query: { limit }, schema: recommendedMerchantsSchema });
export const discoverKeys = { people: (n: number) => ['discover-people', n] as const, merchants: (n: number) => ['discover-merchants', n] as const };
