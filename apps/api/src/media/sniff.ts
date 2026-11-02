import type { MediaMime } from '@caselind/contracts';

/** Bytes read from the start of an upload for type detection; enough for every signature below. */
export const SNIFF_HEAD_BYTES = 4096;

const ascii = (buf: Uint8Array, start: number, text: string): boolean => {
  if (buf.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) if (buf[start + i] !== text.charCodeAt(i)) return false;
  return true;
};

const startsWith = (buf: Uint8Array, bytes: readonly number[]): boolean =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

const indexOfAscii = (buf: Uint8Array, text: string, from: number, to: number): number => {
  const end = Math.min(buf.length, to) - text.length;
  for (let i = from; i <= end; i++) if (ascii(buf, i, text)) return i;
  return -1;
};

/** ISO-BMFF (MP4) major brands that are plain MP4 video containers. QuickTime, HEIF, 3GP are not accepted. */
const MP4_VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'mmp4', 'MSNV']);
/** Brands that only carry audio (iTunes AAC / ALAC, audiobooks). */
const MP4_AUDIO_BRANDS = new Set(['M4A ', 'M4B ']);

function sniffMp4(head: Uint8Array): MediaMime | null {
  // Box header: 32-bit size, then 'ftyp', then the 4-character major brand.
  if (!ascii(head, 4, 'ftyp') || head.length < 12) return null;
  const boxSize = ((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0;
  if (boxSize < 12) return null;
  const brand = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!);
  if (MP4_AUDIO_BRANDS.has(brand)) return 'audio/mp4';
  if (MP4_VIDEO_BRANDS.has(brand)) return 'video/mp4';
  return null;
}

/** EBML header whose DocType is "webm" (generic Matroska is refused). */
function sniffWebm(head: Uint8Array): MediaMime | null {
  if (!startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  // DocType element id 0x4282, then a one-byte size (0x84 = 4 bytes), then the value.
  for (let i = 4; i + 7 <= Math.min(head.length, 64); i++) {
    if (head[i] === 0x42 && head[i + 1] === 0x82) return ascii(head, i + 3, 'webm') ? 'video/webm' : null;
  }
  return null;
}

/** Ogg container whose first stream is Opus or Vorbis audio (Theora video is refused). */
function sniffOgg(head: Uint8Array): MediaMime | null {
  if (!ascii(head, 0, 'OggS')) return null;
  if (indexOfAscii(head, 'OpusHead', 28, 128) >= 0) return 'audio/ogg';
  if (indexOfAscii(head, '\u0001vorbis', 28, 128) >= 0) return 'audio/ogg';
  return null;
}

/** MP3: an ID3v2 tag, or a valid MPEG audio Layer III frame header. */
function sniffMpegAudio(head: Uint8Array): MediaMime | null {
  if (ascii(head, 0, 'ID3') && head.length >= 10 && head[3]! >= 2 && head[3]! <= 4) return 'audio/mpeg';
  if (head.length < 4 || head[0] !== 0xff || (head[1]! & 0xe0) !== 0xe0) return null;
  const version = (head[1]! >> 3) & 0b11; // 01 is reserved
  const layer = (head[1]! >> 1) & 0b11; // 01 = Layer III (00 would be ADTS AAC)
  const bitrate = head[2]! >> 4; // 0000 free, 1111 bad
  const sampleRate = (head[2]! >> 2) & 0b11; // 11 reserved
  if (version === 0b01 || layer !== 0b01 || bitrate === 0 || bitrate === 0xf || sampleRate === 0b11) return null;
  return 'audio/mpeg';
}

/**
 * Detects the type of an upload from its first bytes (magic numbers). Returns null for anything that
 * is not one of the accepted types: SVG, HTML, XML, scripts, executables, archives, HEIC, QuickTime...
 * Text-based formats are never accepted because they cannot be told apart from active content (XSS).
 */
export function sniffMime(head: Uint8Array): MediaMime | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'image/gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'image/webp';
  if (ascii(head, 0, '%PDF-')) return 'application/pdf';
  return sniffMp4(head) ?? sniffWebm(head) ?? sniffOgg(head) ?? sniffMpegAudio(head);
}

/**
 * Whether content detected as `detected` may be stored under the type the client declared.
 * Exact match, with one exception: audio-only MP4 files (voice notes recorded on phones) often use
 * the generic ISO brands, so content detected as video/mp4 is accepted when declared audio/mp4.
 */
export function matchesDeclared(detected: MediaMime, declared: MediaMime): boolean {
  return detected === declared || (detected === 'video/mp4' && declared === 'audio/mp4');
}
