import { describe, expect, it } from 'vitest';
import { formatDay, parseRoute, safeHttps } from './logic';

describe('parseRoute', () => {
  it('routes home, a shop page, and the rest to not found', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/s/chez-awa/')).toEqual({ name: 'shop', slug: 'chez-awa' });
    expect(parseRoute('/s/Chez Awa')).toEqual({ name: 'notfound' });
    expect(parseRoute('/s/../admin')).toEqual({ name: 'notfound' });
    expect(parseRoute('/x')).toEqual({ name: 'notfound' });
  });
});
describe('formatDay', () => {
  it('joins intervals and reports a closed day', () => {
    expect(formatDay([{ open: '08:00', close: '12:00' }, { open: '14:00', close: '18:00' }])).toBe('08:00–12:00, 14:00–18:00');
    expect(formatDay([])).toBeNull();
    expect(formatDay(undefined)).toBeNull();
  });
});
describe('safeHttps', () => {
  it('only lets https through', () => {
    expect(safeHttps('https://exemple.cd')).toBe('https://exemple.cd');
    expect(safeHttps('http://exemple.cd')).toBeNull();
    expect(safeHttps('javascript:alert(1)')).toBeNull();
    expect(safeHttps(null)).toBeNull();
  });
});
