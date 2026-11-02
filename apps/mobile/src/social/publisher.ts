import type { MediaMime } from '@caselind/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../lib/api';
import { createPost } from './api';
import { sk } from './keys';
import { buildOptimisticPost, mergeServerPost, prependPost, removePost, updatePost, type PostPages } from './logic';
import type { PostAuthor, PostVisibility } from './types';
import { uploadPostMedia } from './upload';

export interface PublishInput {
  clientId: string;
  author: PostAuthor;
  body: string | null;
  visibility: PostVisibility;
  media: { uri: string; mime: MediaMime }[];
}

/** Envois en cours ou échoués (réessai avec le même clientId, sans renvoyer les médias déjà envoyés). */
const pending = new Map<string, { input: PublishInput; uploaded: string[] }>();

function patchLists(qc: QueryClient, authorId: string, fn: (d: PostPages | undefined) => PostPages | undefined) {
  qc.setQueryData<PostPages>(sk.feed, fn);
  qc.setQueryData<PostPages>(sk.userPosts(authorId), fn);
}

async function run(qc: QueryClient, clientId: string): Promise<void> {
  const job = pending.get(clientId);
  if (!job) return;
  const { input } = job;
  const mark = (p: { local?: 'sending' | 'failed'; progress?: number }) =>
    patchLists(qc, input.author.id, (d) => updatePost(d, clientId, (x) => ({ ...x, ...p })));
  mark({ local: 'sending' });
  try {
    for (let i = job.uploaded.length; i < input.media.length; i += 1) {
      job.uploaded.push(await uploadPostMedia(input.media[i].uri, input.media[i].mime));
      mark({ progress: job.uploaded.length / input.media.length });
    }
    const server = await createPost({
      clientId,
      body: input.body ?? undefined,
      mediaIds: job.uploaded,
      visibility: input.visibility,
    });
    pending.delete(clientId);
    patchLists(qc, input.author.id, (d) => mergeServerPost(d, clientId, server));
    qc.setQueryData(sk.post(server.id), server);
  } catch (err) {
    mark({ local: 'failed' });
    // Refus de validation : les médias envoyés ne sont plus fiables, on repart de zéro au réessai.
    if (err instanceof ApiRequestError && err.status === 400) job.uploaded = [];
  }
}

/** Insère la publication provisoire en tête du fil puis lance l'envoi ; ne dépend d'aucun écran. */
export function startPublish(qc: QueryClient, input: PublishInput): void {
  pending.set(input.clientId, { input, uploaded: [] });
  const optimistic = buildOptimisticPost(input);
  patchLists(qc, input.author.id, (d) => prependPost(d, optimistic));
  void run(qc, input.clientId);
}

export function retryPublish(qc: QueryClient, clientId: string): void {
  void run(qc, clientId);
}

export function discardPublish(qc: QueryClient, clientId: string, authorId: string): void {
  pending.delete(clientId);
  patchLists(qc, authorId, (d) => removePost(d, clientId));
}
