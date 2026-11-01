import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppError } from '../common/app-error.js';
import { FlagGuard, RequireFlag } from './flag.guard.js';
import { type FlagContext, FlagsService, isFlagOn } from './flags.service.js';

class Gated {
  @RequireFlag('betting')
  bet() {}

  open() {}
}

@RequireFlag('messaging')
class GatedController {
  send() {}
}

/** Fake service: records calls, answers from a fixed set of "on" flags. */
function fakeFlags(on: string[]) {
  const calls: { key: string; userId: string | null }[] = [];
  const service = {
    async evaluateForUser(key: string, userId: string | null) {
      calls.push({ key, userId });
      return on.includes(key);
    },
  } as unknown as FlagsService;
  return { service, calls };
}

function context(cls: object, handler: () => void, auth?: { userId: string }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

describe('FlagGuard', () => {
  it('lets routes without @RequireFlag through without evaluating anything', async () => {
    const { service, calls } = fakeFlags([]);
    const guard = new FlagGuard(new Reflector(), service);
    await expect(guard.canActivate(context(Gated, Gated.prototype.open, { userId: 'u1' }))).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses with 403 feature_disabled when the flag is off for the user', async () => {
    const { service, calls } = fakeFlags([]);
    const guard = new FlagGuard(new Reflector(), service);
    const err = await guard.canActivate(context(Gated, Gated.prototype.bet, { userId: 'u1' })).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 403, code: 'feature_disabled' });
    expect(calls).toEqual([{ key: 'betting', userId: 'u1' }]);
  });

  it('allows the route when the flag is on, including a flag set on the controller', async () => {
    const { service, calls } = fakeFlags(['betting', 'messaging']);
    const guard = new FlagGuard(new Reflector(), service);
    await expect(guard.canActivate(context(Gated, Gated.prototype.bet, { userId: 'u1' }))).resolves.toBe(true);
    await expect(
      guard.canActivate(context(GatedController, GatedController.prototype.send, { userId: 'u2' })),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      { key: 'betting', userId: 'u1' },
      { key: 'messaging', userId: 'u2' },
    ]);
  });

  it('evaluates an anonymous caller (public route) with no user', async () => {
    const { service, calls } = fakeFlags([]);
    const guard = new FlagGuard(new Reflector(), service);
    await expect(guard.canActivate(context(Gated, Gated.prototype.bet))).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    expect(calls).toEqual([{ key: 'betting', userId: null }]);
  });
});

describe('isFlagOn', () => {
  const user: FlagContext = { country: 'CD', roles: ['user'] };
  const flag = { enabled: true, allowedCountries: null, allowedRoles: null };

  it('is false for an unknown or disabled flag', () => {
    expect(isFlagOn(undefined, user)).toBe(false);
    expect(isFlagOn({ ...flag, enabled: false }, user)).toBe(false);
  });

  it('applies country and role restrictions; a user without country never matches a country list', () => {
    expect(isFlagOn(flag, user)).toBe(true);
    expect(isFlagOn({ ...flag, allowedCountries: ['CD'] }, user)).toBe(true);
    expect(isFlagOn({ ...flag, allowedCountries: ['KE'] }, user)).toBe(false);
    expect(isFlagOn({ ...flag, allowedCountries: ['CD'] }, { country: null, roles: ['user'] })).toBe(false);
    expect(isFlagOn({ ...flag, allowedRoles: ['admin'] }, user)).toBe(false);
    expect(isFlagOn({ ...flag, allowedRoles: ['admin'] }, { country: 'CD', roles: ['user', 'admin'] })).toBe(true);
  });
});
