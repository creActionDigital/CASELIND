import { describe, expect, it } from 'vitest';
import { canCancel, canDispute, canReview, milestoneActions } from './logic';

describe('freelance logic', () => {
  it('lets the freelancer deliver, and the client approve or ask for changes, only while the contract is active', () => {
    expect(milestoneActions('freelancer', 'active', { status: 'pending' })).toEqual(['deliver']);
    expect(milestoneActions('freelancer', 'active', { status: 'revision' })).toEqual(['deliver']);
    expect(milestoneActions('freelancer', 'active', { status: 'delivered' })).toEqual([]);
    expect(milestoneActions('client', 'active', { status: 'delivered' })).toEqual(['approve', 'revision']);
    expect(milestoneActions('client', 'active', { status: 'pending' })).toEqual([]);
    expect(milestoneActions('client', 'disputed', { status: 'delivered' })).toEqual([]);
  });
  it('cancel needs an active contract with nothing approved; dispute needs an active one', () => {
    expect(canCancel({ status: 'active', milestones: [{ status: 'pending' }] as never })).toBe(true);
    expect(canCancel({ status: 'active', milestones: [{ status: 'approved' }] as never })).toBe(false);
    expect(canCancel({ status: 'disputed', milestones: [] })).toBe(false);
    expect(canDispute({ status: 'active' })).toBe(true);
    expect(canDispute({ status: 'completed' })).toBe(false);
  });
  it('a review is offered once, after completion', () => {
    expect(canReview({ status: 'completed', myReview: null })).toBe(true);
    expect(canReview({ status: 'completed', myReview: { rating: 5, body: '' } })).toBe(false);
    expect(canReview({ status: 'active', myReview: null })).toBe(false);
  });
});
