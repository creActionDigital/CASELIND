import { publicOrgSchema, type PublicOrg } from '@caselind/contracts';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

/** A public business page; null when it does not exist or is not public. */
export async function fetchPublicOrg(slug: string): Promise<PublicOrg | null> {
  const res = await fetch(`${API_URL}/v1/public/orgs/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return publicOrgSchema.parse(await res.json());
}
