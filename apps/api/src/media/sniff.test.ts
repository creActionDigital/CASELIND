import { describe, expect, it } from 'vitest';
import { canRead } from './access.js';
import { matchesDeclared, sniffMime } from './sniff.js';
import { signUploadToken, verifyUploadToken } from './upload-token.js';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const zeros = (n: number) => new Array<number>(n).fill(0);

/** A real 1x1 PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const ftyp = (brand: string) => bytes([0, 0, 0, 0x18], 'ftyp', brand, [0, 0, 2, 0], 'isomiso2');
const ebml = (docType: string) =>
  bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0x82, 0x80 | docType.length], docType);
const ogg = (codecHeader: string) => bytes('OggS', zeros(24), codecHeader);

describe('sniffMime: accepted types', () => {
  it.each<[string, Uint8Array, string]>([
    ['PNG', TINY_PNG, 'image/png'],
    ['JPEG (JFIF)', bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF'), 'image/jpeg'],
    ['JPEG (Exif)', bytes([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10], 'Exif'), 'image/jpeg'],
    ['GIF89a', bytes('GIF89a', [1, 0, 1, 0]), 'image/gif'],
    ['GIF87a', bytes('GIF87a', [1, 0, 1, 0]), 'image/gif'],
    ['WebP', bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['PDF', bytes('%PDF-1.7\n%âã'), 'application/pdf'],
    ['MP4 (isom)', ftyp('isom'), 'video/mp4'],
    ['MP4 (mp42)', ftyp('mp42'), 'video/mp4'],
    ['M4A', ftyp('M4A '), 'audio/mp4'],
    ['WebM', ebml('webm'), 'video/webm'],
    ['Ogg Opus', ogg('OpusHead'), 'audio/ogg'],
    ['Ogg Vorbis', ogg('\u0001vorbis'), 'audio/ogg'],
    ['MP3 with ID3v2 tag', bytes('ID3', [3, 0, 0, 0, 0, 0, 0x21]), 'audio/mpeg'],
    ['MP3 frame (MPEG-1 Layer III)', bytes([0xff, 0xfb, 0x90, 0x64]), 'audio/mpeg'],
    ['MP3 frame (MPEG-2 Layer III)', bytes([0xff, 0xf3, 0x48, 0xc4]), 'audio/mpeg'],
  ])('%s', (_, head, mime) => {
    expect(sniffMime(head)).toBe(mime);
  });
});

describe('sniffMime: refused content', () => {
  it.each<[string, Uint8Array]>([
    ['empty', bytes()],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
    ['SVG with XML prolog', bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['HTML', bytes('<!DOCTYPE html><html><script>alert(1)</script></html>')],
    ['HTML with BOM', bytes([0xef, 0xbb, 0xbf], '<html>')],
    ['plain text', bytes('hello world')],
    ['Windows executable', bytes('MZ', [0x90, 0, 3, 0])],
    ['ZIP', bytes('PK', [3, 4, 20, 0])],
    ['RIFF that is not WebP (WAV)', bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt ')],
    ['QuickTime', ftyp('qt  ')],
    ['HEIC', ftyp('heic')],
    ['ftyp with an impossible box size', bytes([0, 0, 0, 4], 'ftypisom')],
    ['generic Matroska', ebml('matroska')],
    ['Ogg Theora video', ogg('\u0080theora')],
    ['ADTS AAC (Layer bits 00)', bytes([0xff, 0xf1, 0x50, 0x80])],
    ['MPEG frame with reserved version', bytes([0xff, 0xeb, 0x90, 0x64])],
    ['MPEG frame with bad bitrate', bytes([0xff, 0xfb, 0xf0, 0x64])],
    ['truncated PNG signature', bytes([0x89, 0x50, 0x4e, 0x47])],
  ])('%s', (_, head) => {
    expect(sniffMime(head)).toBeNull();
  });
});

describe('matchesDeclared', () => {
  it('requires the declared type, except generic MP4 declared as audio', () => {
    expect(matchesDeclared('image/png', 'image/png')).toBe(true);
    expect(matchesDeclared('image/png', 'image/jpeg')).toBe(false);
    expect(matchesDeclared('video/mp4', 'audio/mp4')).toBe(true);
    expect(matchesDeclared('audio/mp4', 'video/mp4')).toBe(false);
  });
});

describe('upload token', () => {
  const secret = 's'.repeat(32);
  const exp = new Date(Date.now() + 60_000);

  it('only works for its asset, owner and secret, until it expires', () => {
    const token = signUploadToken(secret, 'asset', 'owner', exp);
    expect(verifyUploadToken(secret, token, 'asset', 'owner')).toBe(true);
    expect(verifyUploadToken(secret, token, 'other-asset', 'owner')).toBe(false);
    expect(verifyUploadToken(secret, token, 'asset', 'other-owner')).toBe(false);
    expect(verifyUploadToken('t'.repeat(32), token, 'asset', 'owner')).toBe(false);
    expect(verifyUploadToken(secret, token, 'asset', 'owner', new Date(exp.getTime() + 1))).toBe(false);
    expect(verifyUploadToken(secret, undefined, 'asset', 'owner')).toBe(false);
    // Moving the expiry invalidates the signature.
    const [, sig] = token.split('.');
    expect(verifyUploadToken(secret, `${exp.getTime() + 3_600_000}.${sig}`, 'asset', 'owner')).toBe(false);
  });
});

describe('canRead', () => {
  it('opens public-facing purposes to everyone and keeps messages and documents private', () => {
    for (const purpose of ['avatar', 'org_logo', 'org_banner', 'product'] as const) {
      expect(canRead('viewer', { ownerUserId: 'owner', purpose })).toBe(true);
    }
    for (const purpose of ['message', 'document', 'story', 'post'] as const) {
      expect(canRead('viewer', { ownerUserId: 'owner', purpose })).toBe(false);
      expect(canRead('owner', { ownerUserId: 'owner', purpose })).toBe(true);
    }
  });
});
