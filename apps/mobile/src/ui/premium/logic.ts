/** Logique pure des composants premium (testée dans logic.test.ts). */

/** Page courante d'un carrousel à pagination, d'après le décalage horizontal. */
export function pageIndex(offsetX: number, pageWidth: number, count: number): number {
  if (pageWidth <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}

/** Valeur ramenée entre 0 et 1 (barres de progression). */
export const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Variation signée « +12 % » / « -3 % » ; null si non fournie. */
export function formatDelta(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const r = Math.round(pct * 10) / 10;
  return `${r > 0 ? '+' : ''}${r} %`;
}

/** Délai d'apparition décalé en liste, plafonné pour ne jamais faire attendre. */
export const staggerDelay = (index: number, step = 40, max = 320): number => Math.min(max, Math.max(0, index) * step);

/** Fermeture d'une feuille : glissement assez long ou assez vif vers le bas. */
export const shouldDismiss = (dy: number, vy: number, height: number): boolean => dy > height * 0.3 || (dy > 24 && vy > 0.8);
