import { MINIAPP_API_ENDPOINTS, MINIAPP_EVENTS, validateManifest, type ManifestProblem, type MiniAppManifest, type MiniAppScope } from '@caselind/contracts';

export { MINIAPP_API_ENDPOINTS, MINIAPP_EVENTS, validateManifest };
export type { ManifestProblem, MiniAppManifest };

/** Typed identity helper: `const manifest = defineManifest({...})` gives completion and compile-time checks. */
export const defineManifest = (m: MiniAppManifest): MiniAppManifest => m;

/** Local validation (same rules as the server and the submission): returns the problems, an empty list meaning "ready to submit". */
export function checkManifest(raw: unknown, scopes: readonly MiniAppScope[]): ManifestProblem[] {
  const r = validateManifest(raw, scopes);
  return r.ok ? [] : r.problems;
}
