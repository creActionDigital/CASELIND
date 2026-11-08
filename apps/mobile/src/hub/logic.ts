/** Logique pure du hub (onglet central) : ordre des onglets et formatage des compteurs. */
export const HUB_TABS = ['live', 'videos', 'posts', 'products'] as const;
export type HubTab = (typeof HUB_TABS)[number];

/** Index de l'onglet affiché pour un décalage horizontal de défilement (page entière la plus proche). */
export function tabIndexFromOffset(offsetX: number, pageWidth: number): number {
  if (!(pageWidth > 0)) return 0;
  return Math.min(HUB_TABS.length - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}

/** Compteur compact : « 999 », « 1,2 k », « 2 M » (fr) ou « 1.2k », « 2M » (en). Arrondi vers le bas. */
export function formatCount(n: number, locale: 'fr' | 'en' = 'fr'): string {
  const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const unit = (x: number, suffix: string) => {
    const t = Math.floor(x * 10) / 10;
    const s = Number.isInteger(t) ? String(t) : t.toFixed(1);
    const num = locale === 'fr' ? s.replace('.', ',') : s;
    return locale === 'fr' ? `${num} ${suffix}` : `${num}${suffix}`;
  };
  if (v < 1000) return String(v);
  if (v < 1_000_000) return unit(v / 1000, 'k');
  return unit(v / 1_000_000, 'M');
}
