import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { ApiRequestError } from '../lib/api';
import { patchPostEverywhere } from '../social/hooks';
import type { Post } from '../social/types';
import { putBookmark, sendImpressions } from './api';
import { ImpressionTracker } from './logic';

const FLUSH_MS = 2000;
const VIEWABILITY = { itemVisiblePercentThreshold: 60, minimumViewTime: 250 } as const;

/** Favori optimiste : le signet change tout de suite dans le fil, les profils et le détail ; retour arrière en cas d'échec. */
export function useBookmark(post: Post) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => putBookmark(post.id, on),
    onMutate: (on) => {
      const prev = post.bookmarked === true;
      patchPostEverywhere(qc, post.id, (p) => ({ ...p, bookmarked: on }));
      return { prev };
    },
    onError: (_e, _on, ctx) => patchPostEverywhere(qc, post.id, (p) => ({ ...p, bookmarked: ctx?.prev ?? false })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bookmarks'] }),
  });
}

/**
 * Envoi discret des impressions d'une liste : seules les publications restées visibles au moins 1 s sont rapportées, par lots
 * toutes les 2 s, une fois par session. `idOf` renvoie l'id d'un élément de liste à compter (null : rien, par ex. ses propres publications).
 * À brancher sur `FlatList` : `onViewableItemsChanged` et `viewabilityConfig`.
 */
export function useImpressionReporting<T>(idOf: (item: T) => string | null) {
  const tracker = useRef(new ImpressionTracker()).current;
  const idOfRef = useRef(idOf);
  idOfRef.current = idOf;

  const flush = useCallback(async () => {
    const ids = tracker.take(Date.now());
    if (ids.length === 0) return;
    try {
      await sendImpressions(ids);
    } catch (err) {
      // Une réponse du serveur (frein 429, refus) n'est pas retentée ; seule une panne réseau l'est.
      if (!(err instanceof ApiRequestError)) tracker.release(ids);
    }
  }, [tracker]);

  useEffect(() => {
    const h = setInterval(() => void flush(), FLUSH_MS);
    return () => clearInterval(h);
  }, [flush]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: unknown }[] }) => {
    const ids = viewableItems.map((v) => idOfRef.current(v.item as T)).filter((id): id is string => id !== null);
    tracker.update(ids, Date.now());
  }).current;

  return { onViewableItemsChanged, viewabilityConfig: VIEWABILITY };
}
