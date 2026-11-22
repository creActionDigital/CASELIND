import { productDescriptionResultSchema } from '@caselind/contracts';
import { api } from '../auth/auth-context';

export { factsFromText } from './ai-description-facts';

export const draftDescription = (orgId: string, title: string, facts: string[]) =>
  api.request(`/orgs/${orgId}/ai/product-description`, { method: 'POST', body: { title: title.trim(), facts }, schema: productDescriptionResultSchema });
