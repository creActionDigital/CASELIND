import { describe, expect, it } from 'vitest';
import { parentRoute, ROUTES } from './back-target';

// Types Node volontairement non chargés (ils changeraient setTimeout pour toute l'appli) : accès minimal typé à la main.
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('node:fs') as { readdirSync(d: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
const path = require('node:path') as { join(...p: string[]): string; relative(a: string, b: string): string; sep: string };

/** URL de chaque écran de src/app/(app), comme expo-router les sert (groupes et index retirés). */
function screens(): string[] {
  const base = path.join(__dirname, '..', 'app', '(app)');
  const out: string[] = [];
  (function walk(d: string) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.tsx') && f.name !== '_layout.tsx' && !f.name.endsWith('.test.tsx')) {
        const segs = path.relative(base, p).replace(/\.tsx$/, '').split(path.sep).filter((s: string) => !/^\(.*\)$/.test(s) && s !== 'index');
        out.push('/' + segs.join('/'));
      }
    }
  })(base);
  return [...new Set(out)].sort();
}

describe('retour de secours', () => {
  it('la liste des écrans suit les fichiers de src/app/(app)', () => {
    expect([...ROUTES].sort()).toEqual(screens());
  });
  it("remonte au parent existant le plus proche, sinon à l'accueil", () => {
    expect(parentRoute('/wallet/savings')).toBe('/wallet');
    expect(parentRoute('/seller/abc/orders/123')).toBe('/seller/abc/orders');
    expect(parentRoute('/seller/abc/school/fees/c1')).toBe('/seller/abc/school');
    expect(parentRoute('/education/edit/42')).toBe('/education');
    expect(parentRoute('/user/u1/followers')).toBe('/user/u1');
    expect(parentRoute('/product/p1?x=1')).toBe('/');
    expect(parentRoute('/messages/c1')).toBe('/messages');
    expect(parentRoute('/notifications')).toBe('/');
  });
});
