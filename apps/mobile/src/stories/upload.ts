import type { MediaMime } from '@caselind/contracts';
import { uploadImage } from '../media/upload';

/** Annonce (purpose story) puis envoi des octets. Renvoie l'id de l'asset. */
export const uploadStoryImage = (uri: string, mime: MediaMime): Promise<string> => uploadImage(uri, mime, 'story');
