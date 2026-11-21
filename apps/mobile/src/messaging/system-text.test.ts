import { describe, expect, it } from 'vitest';
import type { SystemEvent } from '@caselind/contracts';
import { systemText } from './system-text';

const t = (key: string, p?: Record<string, string | number>) => `${key}:${Object.values(p ?? {}).join(',')}`;
const name = (id: string | null) => `n-${id}`;
const added = (userId: string, actorId: string) => ({ type: 'member_added', userId, actorId, title: null }) as unknown as SystemEvent;

describe('systemText member_added', () => {
  it('says "joined" when the person added themselves (public community)', () => {
    expect(systemText(added('u1', 'u1'), name, t as never)).toBe('chat.system.member_joined:n-u1');
  });
  it('keeps "added by" when someone else added them', () => {
    expect(systemText(added('u1', 'u2'), name, t as never)).toBe('chat.system.member_added:n-u1,n-u2');
  });
});

describe('systemText group_created', () => {
  const ev = { type: 'group_created', actorId: 'u1' } as unknown as SystemEvent;
  it('utilise la forme « Vous avez créé » quand l’auteur est soi-même', () => {
    const tt = (k: string) => k;
    expect(systemText(ev, () => 'chat.you', tt as never)).toBe('chat.system.group_created_you');
    expect(systemText(ev, name, t as never)).toBe('chat.system.group_created:n-u1');
  });
});
