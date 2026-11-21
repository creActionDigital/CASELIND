import { describe, expect, it } from 'vitest';
import { ROUTES } from '../lib/back-target';
import { hrefPath, TRANSPORT_SERVICES, TRANSPORT_SPACES } from './services';

describe('services de transport', () => {
  it('chaque lien mène à un écran existant, sans doublon', () => {
    for (const s of [...TRANSPORT_SERVICES, ...TRANSPORT_SPACES]) expect(ROUTES).toContain(hrefPath(s.href));
    expect(new Set(TRANSPORT_SERVICES.map((s) => s.id)).size).toBe(TRANSPORT_SERVICES.length);
    expect(TRANSPORT_SERVICES.map((s) => s.href)).toContain('/courier?kind=meal');
  });
});
