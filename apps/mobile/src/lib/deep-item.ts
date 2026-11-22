/** Un élément ouvert par lien direct (`?id=`) est placé en tête de liste s'il n'est pas déjà dans la page chargée. */
export function mergeDeepItem<T extends { id: string }>(items: readonly T[], extra: T | undefined): T[] {
  return extra && !items.some((i) => i.id === extra.id) ? [extra, ...items] : [...items];
}
