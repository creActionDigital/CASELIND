/** Encodeur PNG minimal en JS pur (aucune lib de capture) : niveaux de gris 8 bits, deflate en blocs « stored » (sans compression). */

export interface Pt {
  x: number;
  y: number;
}

export const SIG_W = 300;
export const SIG_H = 150;
export const SIG_THICKNESS = 3;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

/** Flux zlib : en-tête 0x78 0x01, blocs stored de 65535 octets au plus, puis Adler-32. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, (i + 1) * 65535);
    const n = part.length;
    out.set([i === blocks - 1 ? 1 : 0, n & 255, n >>> 8, ~n & 255, (~n >>> 8) & 255], o);
    out.set(part, o + 5);
    o += 5 + n;
  }
  out.set(u32(adler32(raw)), o);
  return out;
}

/** Image en niveaux de gris (w×h octets, 0 = noir, 255 = blanc) → fichier PNG. */
export function encodeGrayPng(gray: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w + 1) * h); // chaque ligne commence par son octet de filtre (0 = aucun)
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 0, 0, 0, 0]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Trace un segment (Bresenham) en posant à chaque pas un carré de `thickness` px. */
function drawLine(gray: Uint8Array, w: number, h: number, a: Pt, b: Pt, thickness: number): void {
  const lo = -Math.floor((thickness - 1) / 2);
  const hi = Math.floor(thickness / 2);
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    for (let j = lo; j <= hi; j++) {
      for (let i = lo; i <= hi; i++) {
        const px = x0 + i;
        const py = y0 + j;
        if (px >= 0 && px < w && py >= 0 && py < h) gray[py * w + px] = 0;
      }
    }
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Traits (en px de la zone de signature, srcW×srcH) → tampon gris w×h, fond blanc, encre noire. */
export function rasterizeStrokes(strokes: readonly (readonly Pt[])[], srcW: number, srcH: number, w = SIG_W, h = SIG_H, thickness = SIG_THICKNESS): Uint8Array {
  const gray = new Uint8Array(w * h).fill(255);
  const sx = w / srcW;
  const sy = h / srcH;
  for (const s of strokes) {
    const pts = s.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    if (pts.length === 1) drawLine(gray, w, h, pts[0]!, pts[0]!, thickness);
    for (let i = 1; i < pts.length; i++) drawLine(gray, w, h, pts[i - 1]!, pts[i]!, thickness);
  }
  return gray;
}

/** Signature tracée → PNG 300×150. */
export const signaturePng = (strokes: readonly (readonly Pt[])[], srcW: number, srcH: number): Uint8Array =>
  encodeGrayPng(rasterizeStrokes(strokes, srcW, srcH), SIG_W, SIG_H);

/** Vrai s'il y a au moins un point tracé. */
export const hasInk = (strokes: readonly (readonly Pt[])[]): boolean => strokes.some((s) => s.length > 0);

/** Tracé SVG (« M x y L x y ») d'un trait ; un seul point devient un point rond (segment de longueur nulle). */
export function strokeToPath(s: readonly Pt[]): string {
  if (s.length === 0) return '';
  const f = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return s.length === 1 ? `M ${f(s[0]!)} L ${f(s[0]!)}` : `M ${f(s[0]!)} ` + s.slice(1).map((p) => `L ${f(p)}`).join(' ');
}
