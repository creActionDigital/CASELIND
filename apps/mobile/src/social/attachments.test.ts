import { describe, expect, it } from 'vitest';
import { parseEventDate, toAttachmentInput, validateAttachment } from './attachments';

const now = new Date(2026, 10, 21, 12, 0);
describe('pièces jointes de publication', () => {
  it('lit une date locale et refuse le passé ou les dates impossibles', () => {
    expect(parseEventDate('2026-12-24 18:30', now)).toBe(new Date(2026, 11, 24, 18, 30).toISOString());
    expect(parseEventDate('2026-11-20 18:30', now)).toBeNull();
    expect(parseEventDate('2026-02-30 10:00', now)).toBeNull();
    expect(parseEventDate('demain', now)).toBeNull();
  });
  it('valide chaque type', () => {
    expect(validateAttachment({ type: 'none' })).toBeNull();
    expect(validateAttachment({ type: 'location', lat: null, lng: null, label: 'x' })).toBe('location');
    expect(validateAttachment({ type: 'event', title: '', when: '2026-12-24 18:30', place: '' }, now)).toBe('eventTitle');
    expect(validateAttachment({ type: 'event', title: 'Fête', when: 'x', place: '' }, now)).toBe('eventDate');
    expect(validateAttachment({ type: 'poll', options: ['Oui', ' ', 'oui'] })).toBe('pollOptions');
    expect(validateAttachment({ type: 'poll', options: ['Oui', 'Non', ''] })).toBeNull();
  });
  it('construit la requête', () => {
    expect(toAttachmentInput({ type: 'poll', options: [' A ', 'B', ''] })).toEqual({ type: 'poll', options: ['A', 'B'] });
    expect(toAttachmentInput({ type: 'location', lat: 1, lng: 2, label: ' Goma ' })).toEqual({ type: 'location', lat: 1, lng: 2, label: 'Goma' });
    expect(toAttachmentInput({ type: 'none' })).toBeUndefined();
  });
});
