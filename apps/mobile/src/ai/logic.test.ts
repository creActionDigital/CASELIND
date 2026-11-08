import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/api';
import { aiErrorKey, effectiveModel, needsDataNotice, titleFrom } from './logic';

const card = (id: string, trainsOnData: boolean | 'unknown') =>
  ({ id, provider: 'gemini', label: id, free: true, trainsOnData, dataPolicy: 'p' }) as const;

describe('aiErrorKey', () => {
  it('maps assistant error codes and leaves the rest to the generic translator', () => {
    expect(aiErrorKey(new ApiRequestError(409, 'data_notice_required', 'x'))).toBe('ai.error.notice');
    expect(aiErrorKey(new ApiRequestError(503, 'ai_unavailable', 'x'))).toBe('ai.error.unavailable');
    expect(aiErrorKey(new ApiRequestError(502, 'ai_provider_error', 'x'))).toBe('ai.error.provider');
    expect(aiErrorKey(new ApiRequestError(429, 'rate_limited', 'x'))).toBe('ai.error.quota');
    expect(aiErrorKey(new ApiRequestError(404, 'not_found', 'x'))).toBeNull();
    expect(aiErrorKey(new Error('boom'))).toBeNull();
  });
});

describe('needsDataNotice', () => {
  it('asks for the notice unless the model never trains or it was accepted', () => {
    expect(needsDataNotice(card('g', true), { acknowledgedDataNotice: false })).toBe(true);
    expect(needsDataNotice(card('u', 'unknown'), { acknowledgedDataNotice: false })).toBe(true);
    expect(needsDataNotice(card('q', false), { acknowledgedDataNotice: false })).toBe(false);
    expect(needsDataNotice(card('g', true), { acknowledgedDataNotice: true })).toBe(false);
    expect(needsDataNotice(undefined, { acknowledgedDataNotice: false })).toBe(false);
  });
});

describe('effectiveModel', () => {
  const models = [card('a', true), card('b', false)];
  it('prefers the user choice, then the default, then the first model', () => {
    expect(effectiveModel(models, { modelId: 'b' }, 'a')?.id).toBe('b');
    expect(effectiveModel(models, { modelId: 'gone' }, 'a')?.id).toBe('a');
    expect(effectiveModel(models, { modelId: null }, null)?.id).toBe('a');
    expect(effectiveModel([], { modelId: null }, null)).toBeUndefined();
  });
});

describe('titleFrom', () => {
  it('keeps the first line and shortens long questions', () => {
    expect(titleFrom('  Bonjour\nsuite')).toBe('Bonjour');
    const long = 'x'.repeat(80);
    expect(titleFrom(long)).toHaveLength(60);
    expect(titleFrom(long).endsWith('…')).toBe(true);
  });
});
