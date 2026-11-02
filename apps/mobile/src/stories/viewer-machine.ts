import type { StoryGroup } from '@caselind/contracts';
import { firstUnseenIndex } from './order';

/** Durée d'affichage d'une image (ms). */
export const STORY_DURATION_MS = 5000;

export interface ViewerPos {
  group: number;
  story: number;
}

export type ViewerResult = { kind: 'move'; pos: ViewerPos } | { kind: 'close' };

/** Position de départ : groupe de l'auteur demandé, à sa première story non vue. */
export function startPosition(groups: StoryGroup[], userId: string): ViewerPos | null {
  const group = groups.findIndex((g) => g.author.userId === userId);
  if (group < 0) return null;
  return { group, story: firstUnseenIndex(groups[group]) };
}

/** Suivante : story suivante, sinon première de l'auteur suivant, sinon fermeture. */
export function next(groups: StoryGroup[], pos: ViewerPos): ViewerResult {
  const g = groups[pos.group];
  if (g && pos.story + 1 < g.stories.length) return { kind: 'move', pos: { group: pos.group, story: pos.story + 1 } };
  if (pos.group + 1 < groups.length) return { kind: 'move', pos: { group: pos.group + 1, story: 0 } };
  return { kind: 'close' };
}

/** Précédente : story précédente, sinon dernière de l'auteur précédent, sinon on rejoue la première. */
export function previous(groups: StoryGroup[], pos: ViewerPos): ViewerResult {
  if (pos.story > 0) return { kind: 'move', pos: { group: pos.group, story: pos.story - 1 } };
  if (pos.group > 0) {
    const prev = groups[pos.group - 1];
    return { kind: 'move', pos: { group: pos.group - 1, story: Math.max(0, prev.stories.length - 1) } };
  }
  return { kind: 'move', pos: { group: 0, story: 0 } };
}
