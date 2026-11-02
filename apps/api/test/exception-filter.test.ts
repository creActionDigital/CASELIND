import { Logger } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

describe('AllExceptionsFilter logging', () => {
  it('never logs the bound parameters of a failed query (message bodies, credentials)', () => {
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const cause = Object.assign(new Error('insert or update violates foreign key constraint'), { code: '23503' });
    const err = new DrizzleQueryError('insert into "messages" ("body") values ($1)', ['contenu très privé'], cause);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = { switchToHttp: () => ({ getRequest: () => ({ id: 'r1' }), getResponse: () => res }) };
    new AllExceptionsFilter().catch(err, host as never);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(logged).toHaveLength(1);
    const text = JSON.stringify(logged, (_k, v) => (v instanceof Error ? { ...v, name: v.name, message: v.message, stack: v.stack } : v));
    expect(text).not.toContain('privé');
    expect(text).toContain('insert into');
    vi.restoreAllMocks();
  });
});
