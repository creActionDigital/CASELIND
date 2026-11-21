import { mediaMimeSchema, type MediaMime } from '@caselind/contracts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const BY_EXT: Record<string, MediaMime> = { pdf: 'application/pdf', docx: DOCX, xlsx: XLSX, pptx: PPTX, doc: 'application/msword' };

/** Type accepté par l'API pour un document : le type déclaré s'il est connu, sinon l'extension du nom ; null = refusé d'avance. */
export function documentMime(declared: string | null | undefined, name: string): MediaMime | null {
  const parsed = mediaMimeSchema.safeParse(declared);
  if (parsed.success && !/^(image|video|audio)\//.test(parsed.data)) return parsed.data;
  return BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export type FileKind = 'pdf' | 'word' | 'sheet' | 'slides' | 'other';

export function fileKind(mime: string | null | undefined): FileKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === DOCX || mime === 'application/msword') return 'word';
  if (mime === XLSX) return 'sheet';
  if (mime === PPTX) return 'slides';
  return 'other';
}

/** Vrai pour une pièce jointe qui s'affiche comme un fichier (ni image, ni vidéo). */
export const isDocumentMime = (mime: string | null | undefined): boolean => !!mime && !/^(image|video)\//.test(mime);

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
