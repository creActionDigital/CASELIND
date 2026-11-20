/**
 * Génère les images de marque de l'appli à partir des logos fournis par le propriétaire (dossier `logo` du bureau).
 * Usage : node apps/mobile/scripts/brand-assets.cjs "<dossier des 3 logos>"
 * copie 3 = vertical (symbole + nom), copie 7 = symbole seul, copie 9 = horizontal. Fond transparent conservé.
 */
const path = require('node:path');
const Jimp = require('jimp-compact');

const src = process.argv[2];
if (!src) throw new Error('dossier des logos requis');
const out = path.join(__dirname, '..', 'assets', 'images');
const file = (n) => path.join(src, `LOGO CASELIND VFPlan de travail 1 copie ${n}@4x.png`);

// Efface les points isolés (poussière d'export : quelques pixels loin du dessin), puis rogne les marges transparentes.
function trim(img) {
  const { width: w, height: h, data } = img.bitmap;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 8;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    let c = 0;
    for (let dy = -20; dy <= 20 && c < 30; dy += 2) for (let dx = -20; dx <= 20; dx += 2) if (on(x + dx, y + dy)) c++;
    if (c < 30) data[(y * w + x) * 4 + 3] = 0;
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 8) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return img.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

// Symbole centré sur un carré `size`, occupant `ratio` du côté, fond `bg` (null = transparent).
async function square(mark, size, ratio, bg) {
  const canvas = new Jimp(size, size, bg ?? 0x00000000);
  const m = mark.clone().scaleToFit(Math.round(size * ratio), Math.round(size * ratio));
  return canvas.composite(m, Math.round((size - m.bitmap.width) / 2), Math.round((size - m.bitmap.height) / 2));
}

(async () => {
  const vertical = trim(await Jimp.read(file(3)));
  const mark = trim(await Jimp.read(file(7)));
  const horizontal = trim(await Jimp.read(file(9)));

  await vertical.clone().resize(720, Jimp.AUTO).writeAsync(path.join(out, 'logo-vertical.png'));
  await horizontal.clone().resize(960, Jimp.AUTO).writeAsync(path.join(out, 'logo-horizontal.png'));
  await mark.clone().resize(256, Jimp.AUTO).writeAsync(path.join(out, 'logo-mark.png'));

  const WHITE = 0xffffffff;
  await (await square(mark, 1024, 0.72, WHITE)).writeAsync(path.join(out, 'icon.png'));
  // Android adaptatif : le contenu doit tenir dans le cercle central (~61 % du côté).
  await (await square(mark, 1024, 0.56, null)).writeAsync(path.join(out, 'android-icon-foreground.png'));
  await new Jimp(1024, 1024, WHITE).writeAsync(path.join(out, 'android-icon-background.png'));
  const mono = await square(mark, 1024, 0.56, null);
  mono.scan(0, 0, 1024, 1024, (x, y, i) => { mono.bitmap.data[i] = mono.bitmap.data[i + 1] = mono.bitmap.data[i + 2] = 0; });
  await mono.writeAsync(path.join(out, 'android-icon-monochrome.png'));
  await vertical.clone().resize(400, Jimp.AUTO).writeAsync(path.join(out, 'splash-icon.png'));
  await (await square(mark, 48, 0.9, null)).writeAsync(path.join(out, 'favicon.png'));
  console.log('ok', { vertical: [vertical.bitmap.width, vertical.bitmap.height], mark: [mark.bitmap.width, mark.bitmap.height], horizontal: [horizontal.bitmap.width, horizontal.bitmap.height] });
})();
