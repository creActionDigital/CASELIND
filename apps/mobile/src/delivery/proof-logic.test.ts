import type { DeliveryProof, DeliveryStatus } from '@caselind/contracts';
import { describe, expect, it } from 'vitest';
import { canAttachProof, hasProof, isProofMime, showsProof } from './proof-logic';

const file = { id: '11111111-1111-4111-8111-111111111111', mime: 'image/png' as const, sizeBytes: 10, contentUrl: '/v1/media/x/content', takenAt: '2026-01-01T00:00:00.000Z' };
const proof = (p: Partial<DeliveryProof>): DeliveryProof => ({ deliveryId: '22222222-2222-4222-8222-222222222222', photo: null, signature: null, ...p });

describe('delivery proof logic', () => {
  it('attaches only once picked up, up to and after the handover', () => {
    const ok: DeliveryStatus[] = ['picked_up', 'in_transit', 'delivered'];
    for (const s of ['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'] as DeliveryStatus[]) {
      expect(canAttachProof(s)).toBe(ok.includes(s));
      expect(showsProof(s)).toBe(ok.includes(s));
    }
  });
  it('accepts JPEG, PNG and WebP only', () => {
    expect(['image/jpeg', 'image/png', 'image/webp'].every((m) => isProofMime(m as never))).toBe(true);
    expect(isProofMime('image/gif')).toBe(false);
    expect(isProofMime('video/mp4')).toBe(false);
  });
  it('detects an attached proof', () => {
    expect(hasProof(undefined)).toBe(false);
    expect(hasProof(proof({}))).toBe(false);
    expect(hasProof(proof({ photo: file }))).toBe(true);
    expect(hasProof(proof({ signature: file }))).toBe(true);
  });
});
