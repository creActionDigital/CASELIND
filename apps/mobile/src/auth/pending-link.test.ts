import { describe, expect, it } from 'vitest';
import { consentPathFromUrl, deepPathFromUrl, rememberPendingLink, takePendingLink } from './pending-link';

const Q = '?client_id=abc&redirect_uri=https%3A%2F%2Fa.test%2Fcb&scope=profile.read&state=12345678&code_challenge=x&code_challenge_method=S256';

describe('lien de consentement hors connexion', () => {
  it('garde tous les paramètres, quelle que soit la forme du lien', () => {
    expect(consentPathFromUrl(`caselind://miniapps/consent${Q}`)).toBe(`/miniapps/consent${Q}`);
    expect(consentPathFromUrl(`https://app.test/miniapps/consent${Q}`)).toBe(`/miniapps/consent${Q}`);
    expect(consentPathFromUrl(`exp://192.168.1.2:8081/--/miniapps/consent${Q}`)).toBe(`/miniapps/consent${Q}`);
  });
  it('ignore les autres liens', () => {
    expect(consentPathFromUrl('caselind://orders/1')).toBeNull();
    expect(consentPathFromUrl(null)).toBeNull();
  });
  it('rejoue le lien une seule fois', () => {
    rememberPendingLink(`caselind://miniapps/consent${Q}`);
    expect(takePendingLink()).toBe(`/miniapps/consent${Q}`);
    expect(takePendingLink()).toBeNull();
  });
});

describe('deepPathFromUrl', () => {
  it('garde le chemin et les paramètres des liens profonds', () => {
    expect(deepPathFromUrl('http://localhost:8081/rides?x=1')).toBe('/rides?x=1');
    expect(deepPathFromUrl('caselind://orders/1')).toBe('/orders/1');
    expect(deepPathFromUrl('exp://192.168.1.2:8081/--/rides/history')).toBe('/rides/history');
  });
  it('ignore l’accueil et les écrans de connexion', () => {
    expect(deepPathFromUrl('http://localhost:8081/')).toBeNull();
    expect(deepPathFromUrl('http://localhost:8081/sign-in')).toBeNull();
    expect(deepPathFromUrl('http://localhost:8081/welcome?x=1')).toBeNull();
    expect(deepPathFromUrl(null)).toBeNull();
  });
});
