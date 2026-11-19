import { describe, expect, it } from 'vitest';
import { adler32, crc32, encodeGrayPng, hasInk, rasterizeStrokes, signaturePng, SIG_H, SIG_W, strokeToPath } from './png';

const ascii = (b: Uint8Array) => String.fromCharCode(...b);
const be32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/** Petit décodeur de test : vérifie les CRC, lit IHDR et relit les blocs stored d'IDAT. */
function decode(png: Uint8Array) {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: number[] = [];
  const types: string[] = [];
  while (o < png.length) {
    const len = be32(png, o);
    const type = ascii(png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    expect(be32(png, o + 8 + len)).toBe(crc32(png.subarray(o + 4, o + 8 + len)));
    types.push(type);
    if (type === 'IHDR') {
      w = be32(data, 0);
      h = be32(data, 4);
      expect(Array.from(data.subarray(8))).toEqual([8, 0, 0, 0, 0]);
    }
    if (type === 'IDAT') for (const b of data) idat.push(b);
    o += 12 + len;
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  const z = Uint8Array.from(idat);
  expect([z[0], z[1]]).toEqual([0x78, 0x01]);
  const raw: number[] = [];
  let p = 2;
  for (;;) {
    const final = z[p]!;
    const n = z[p + 1]! | (z[p + 2]! << 8);
    expect((~n & 0xffff) >>> 0).toBe(z[p + 3]! | (z[p + 4]! << 8));
    for (const b of z.subarray(p + 5, p + 5 + n)) raw.push(b);
    p += 5 + n;
    if (final) break;
  }
  const rawBytes = Uint8Array.from(raw);
  expect(be32(z, p)).toBe(adler32(rawBytes));
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(rawBytes[y * (w + 1)]).toBe(0);
    gray.set(rawBytes.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w);
  }
  return { w, h, gray };
}

describe('sommes de contrôle', () => {
  it('valeurs connues', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });
});

describe('PNG', () => {
  it('une signature est un PNG valide 300×150 qui se relit pixel pour pixel', () => {
    const strokes = [[{ x: 10, y: 10 }, { x: 80, y: 40 }, { x: 120, y: 20 }], [{ x: 50, y: 70 }]];
    const gray = rasterizeStrokes(strokes, 300, 150);
    const d = decode(signaturePng(strokes, 300, 150));
    expect([d.w, d.h]).toEqual([SIG_W, SIG_H]);
    expect(Array.from(d.gray)).toEqual(Array.from(gray));
    expect(d.gray[10 * 300 + 10]).toBe(0);
    expect(d.gray[70 * 300 + 50]).toBe(0);
    expect(d.gray[40 * 300 + 80]).toBe(0);
    expect(d.gray[140 * 300 + 280]).toBe(255);
  });
  it('le trait fait 3 px de large', () => {
    const g = rasterizeStrokes([[{ x: 20, y: 20 }, { x: 100, y: 20 }]], 300, 150);
    expect([18, 19, 20, 21, 22].map((y) => g[y * 300 + 60])).toEqual([255, 0, 0, 0, 255]);
  });
  it('met la zone de tracé à l’échelle', () => {
    const g = rasterizeStrokes([[{ x: 100, y: 50 }]], 200, 100);
    expect(g[75 * 300 + 150]).toBe(0);
  });
  it('découpe en plusieurs blocs stored au-delà de 65535 octets', () => {
    const w = 400;
    const h = 200;
    const gray = new Uint8Array(w * h).map((_, i) => i % 251);
    const d = decode(encodeGrayPng(gray, w, h));
    expect(Array.from(d.gray)).toEqual(Array.from(gray));
  });
  it('détecte l’absence de tracé', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([[]])).toBe(false);
    expect(hasInk([[{ x: 1, y: 1 }]])).toBe(true);
  });
});

describe('tracé SVG', () => {
  it('relie les points ; un point seul devient un segment nul', () => {
    expect(strokeToPath([{ x: 1, y: 2 }, { x: 3.14, y: 4 }])).toBe('M 1.0 2.0 L 3.1 4.0');
    expect(strokeToPath([{ x: 5, y: 6 }])).toBe('M 5.0 6.0 L 5.0 6.0');
    expect(strokeToPath([])).toBe('');
  });
});
