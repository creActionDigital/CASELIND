/** Ajoute `item` en tête d'une liste récente : sans doublon (insensible à la casse), vide ignoré, `max` éléments. */
export function pushRecent(list: readonly string[], item: string, max = 10): string[] {
  const v = item.trim();
  if (!v) return [...list];
  return [v, ...list.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, max);
}
