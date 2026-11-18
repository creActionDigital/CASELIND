import { describe, expect, it } from 'vitest';
import { GOMA_CENTER } from './geo';
import { clampZoom, fitPoints, panCenter, project, radiusPoints, toScreen, unproject, visibleTiles } from './tiles';

const URL_T = 'https://t.example/{z}/{x}/{y}.png';

describe('projection', () => {
  it('projette puis retrouve le point (aller-retour)', () => {
    for (const z of [3, 10, 17]) {
      const p = project(GOMA_CENTER, z);
      const back = unproject(p.x, p.y, z);
      expect(back.lat).toBeCloseTo(GOMA_CENTER.lat, 6);
      expect(back.lng).toBeCloseTo(GOMA_CENTER.lng, 6);
    }
  });
  it('place le méridien 0 et l’équateur au milieu du monde', () => {
    const p = project({ lat: 0, lng: 0 }, 2);
    expect(p.x).toBeCloseTo(512);
    expect(p.y).toBeCloseTo(512);
  });
  it('borne le zoom', () => {
    expect(clampZoom(0)).toBe(3);
    expect(clampZoom(99)).toBe(18);
    expect(clampZoom(12.4)).toBe(12);
  });
});

describe('tuiles visibles', () => {
  it('couvre la fenêtre, sans sortir du monde, avec la bonne adresse', () => {
    const tiles = visibleTiles(GOMA_CENTER, 12, 375, 400, URL_T);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.every((t) => t.left > -256 && t.left < 375 && t.top > -256 && t.top < 400)).toBe(true);
    expect(tiles[0]!.url).toMatch(/^https:\/\/t\.example\/12\/\d+\/\d+\.png$/);
  });
  it('boucle à l’est et à l’ouest, ignore les pôles', () => {
    const west = visibleTiles({ lat: 0, lng: -179.9 }, 3, 600, 300, URL_T);
    expect(west.some((t) => t.key.startsWith('3/-1/'))).toBe(true);
    expect(west.every((t) => Number(t.url.split('/')[4]) >= 0)).toBe(true);
    const pole = visibleTiles({ lat: 85, lng: 0 }, 3, 300, 900, URL_T);
    expect(pole.every((t) => !t.key.includes('/-'))).toBe(true);
  });
});

describe('placement et déplacement', () => {
  it('le centre est au milieu de l’écran', () => {
    const s = toScreen(GOMA_CENTER, GOMA_CENTER, 14, 375, 400);
    expect(s.x).toBeCloseTo(187.5);
    expect(s.y).toBeCloseTo(200);
  });
  it('tirer la carte vers la droite déplace le centre vers l’ouest', () => {
    const c = panCenter(GOMA_CENTER, 14, 100, 0);
    expect(c.lng).toBeLessThan(GOMA_CENTER.lng);
    expect(c.lat).toBeCloseTo(GOMA_CENTER.lat, 6);
  });
});

describe('cadrage', () => {
  it('un point : zoom de rue ; plusieurs : tous visibles', () => {
    expect(fitPoints([GOMA_CENTER], 375, 400).zoom).toBe(15);
    const pts = radiusPoints(GOMA_CENTER, 5);
    const { center, zoom } = fitPoints(pts, 375, 400);
    for (const p of pts) {
      const s = toScreen(p, center, zoom, 375, 400);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(375);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(400);
    }
  });
  it('un rayon plus petit donne un zoom plus fort', () => {
    expect(fitPoints(radiusPoints(GOMA_CENTER, 1), 375, 400).zoom).toBeGreaterThan(fitPoints(radiusPoints(GOMA_CENTER, 25), 375, 400).zoom);
  });
});
