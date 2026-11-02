import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { deletePost, patchPost, putReaction } from './api';
import { sk } from './keys';
import { removePost, updatePost, withMyReaction, type CachedPost, type PostPages } from './logic';
import type { Post, PostVisibility, ReactionType } from './types';

/** Applique `fn` à une publication dans le fil, les listes de profils et son détail. */
export function patchPostEverywhere(qc: QueryClient, id: string, fn: (p: CachedPost) => CachedPost): void {
  qc.setQueriesData<PostPages>({ queryKey: sk.feed }, (d) => updatePost(d, id, fn));
  qc.setQueriesData<PostPages>({ queryKey: ['user-posts'] }, (d) => updatePost(d, id, fn));
  qc.setQueryData<Post>(sk.post(id), (p) => (p ? fn(p) : p));
}

export function removePostEverywhere(qc: QueryClient, id: string): void {
  qc.setQueriesData<PostPages>({ queryKey: sk.feed }, (d) => removePost(d, id));
  qc.setQueriesData<PostPages>({ queryKey: ['user-posts'] }, (d) => removePost(d, id));
  qc.removeQueries({ queryKey: sk.post(id) });
}

/** Réaction optimiste ; en cas d'échec on revient à l'état précédent. */
export function useReact(post: Post) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: ReactionType | null) => putReaction(post.id, next),
    onMutate: (next) => {
      const prev = post.myReaction;
      patchPostEverywhere(qc, post.id, (p) => withMyReaction(p, next));
      return { prev };
    },
    onSuccess: (server) => patchPostEverywhere(qc, post.id, (p) => ({ ...p, reactions: server.reactions, myReaction: server.myReaction })),
    onError: (_e, _next, ctx) => patchPostEverywhere(qc, post.id, (p) => withMyReaction(p, ctx?.prev ?? null)),
  });
}

export function useDeletePost(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => deletePost(id), onSuccess: () => removePostEverywhere(qc, id) });
}

export function useEditPost(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string | null; visibility: PostVisibility }) => patchPost(id, v),
    onSuccess: (server) => patchPostEverywhere(qc, id, (p) => ({ ...p, ...server })),
  });
}
