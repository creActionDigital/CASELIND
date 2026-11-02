import type { StoryGroup } from '@caselind/contracts';

/** Ordre de la barre : soi d'abord, puis les auteurs avec des stories non vues, puis les vus (ordre serveur conservé). */
export function orderStoryGroups(groups: StoryGroup[], myId: string | undefined): StoryGroup[] {
  const rank = (g: StoryGroup) => (g.author.userId === myId ? 0 : g.hasUnseen ? 1 : 2);
  return groups
    .filter((g) => g.stories.length > 0)
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

/** Index de la première story non vue d'un groupe (0 si tout est vu : on rejoue depuis le début). */
export function firstUnseenIndex(group: StoryGroup): number {
  const i = group.stories.findIndex((s) => !s.seen);
  return i < 0 ? 0 : i;
}
