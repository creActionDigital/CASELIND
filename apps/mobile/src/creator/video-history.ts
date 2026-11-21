import { loadRecent, pushRecent, saveRecent } from '../lib/recent-list';

/** Identifiants des dernieres videos vues : stockes sur l'appareil seulement (jamais envoyes). */
export const VIDEO_HISTORY_KEY = 'caselind-video-history.json';
export const VIDEO_HISTORY_MAX = 30;

export async function recordVideoView(postId: string): Promise<void> {
  await saveRecent(VIDEO_HISTORY_KEY, pushRecent(await loadRecent(VIDEO_HISTORY_KEY), postId, VIDEO_HISTORY_MAX));
}
export const loadVideoHistory = (): Promise<string[]> => loadRecent(VIDEO_HISTORY_KEY);
export const clearVideoHistory = (): Promise<void> => saveRecent(VIDEO_HISTORY_KEY, []);
