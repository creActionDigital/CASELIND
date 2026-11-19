import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Alert: { alert: vi.fn() } }));

describe('alertConfirm (web)', () => {
  it('lance l’action si l’utilisateur confirme, rien sinon', async () => {
    const { alertConfirm } = await import('./confirm');
    const run = vi.fn();
    const buttons = [{ text: 'Annuler', style: 'cancel' as const }, { text: 'Supprimer', style: 'destructive' as const, onPress: run }];
    globalThis.confirm = vi.fn(() => false);
    alertConfirm('Supprimer ?', undefined, buttons);
    expect(run).not.toHaveBeenCalled();
    globalThis.confirm = vi.fn(() => true);
    alertConfirm('Supprimer ?', 'Irréversible', buttons);
    expect(run).toHaveBeenCalledTimes(1);
    expect(globalThis.confirm).toHaveBeenCalledWith('Supprimer ?\n\nIrréversible');
  });
});
