import { Inject, Injectable } from '@nestjs/common';
import type { FeatureFlag, PlatformRole, UpdateFeatureFlagRequest } from '@caselind/contracts';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';
import { featureFlags, type FeatureFlagRow, users } from '../db/schema.js';

/** Who a flag is evaluated for. A `null` country never matches a country restriction. */
export interface FlagContext {
  country: string | null;
  roles: readonly string[];
}

type FlagRule = Pick<FeatureFlagRow, 'enabled' | 'allowedCountries' | 'allowedRoles'>;

/** Pure evaluation of one flag: enabled AND country allowed AND at least one role allowed. */
export function isFlagOn(flag: FlagRule | undefined, ctx: FlagContext): boolean {
  if (!flag?.enabled) return false;
  if (flag.allowedCountries && (!ctx.country || !flag.allowedCountries.includes(ctx.country))) return false;
  if (flag.allowedRoles && !flag.allowedRoles.some((r) => ctx.roles.includes(r))) return false;
  return true;
}

function toFeatureFlag(f: FeatureFlagRow): FeatureFlag {
  return {
    key: f.key,
    description: f.description,
    enabled: f.enabled,
    regulated: f.regulated,
    allowedCountries: f.allowedCountries,
    allowedRoles: f.allowedRoles as PlatformRole[] | null,
    updatedAt: f.updatedAt.toISOString(),
    updatedBy: f.updatedBy,
  };
}

/**
 * Feature flags per country and per role. Unknown keys evaluate to `false` so a typo or a
 * missing seed can never switch a module on. Flags are read from the database on every
 * call: an admin change takes effect immediately.
 */
@Injectable()
export class FlagsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async evaluate(key: string, ctx: FlagContext): Promise<boolean> {
    const [flag] = await this.db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return isFlagOn(flag, ctx);
  }

  async evaluateAll(ctx: FlagContext): Promise<Record<string, boolean>> {
    const rows = await this.db.select().from(featureFlags).orderBy(asc(featureFlags.key));
    return Object.fromEntries(rows.map((f) => [f.key, isFlagOn(f, ctx)]));
  }

  /** Country and roles come from the database, never from the token. */
  async contextFor(userId: string): Promise<FlagContext> {
    const [u] = await this.db
      .select({ country: users.country, roles: users.roles })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u ? { country: u.country, roles: u.roles } : { country: null, roles: [] };
  }

  /** `userId` null = anonymous caller (public route): no country, no role. */
  async evaluateForUser(key: string, userId: string | null): Promise<boolean> {
    const ctx: FlagContext = userId ? await this.contextFor(userId) : { country: null, roles: [] };
    return this.evaluate(key, ctx);
  }

  async list(): Promise<FeatureFlag[]> {
    const rows = await this.db.select().from(featureFlags).orderBy(asc(featureFlags.key));
    return rows.map(toFeatureFlag);
  }

  async update(
    key: string,
    patch: UpdateFeatureFlagRequest,
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<FeatureFlag> {
    // Read, decision, write and audit in one transaction with the row locked: a concurrent
    // admin change waits here and then re-evaluates against the committed state, so a regulated
    // flag can never end up ON with a new reach that nobody confirmed, and the audit's from/to
    // always describe the state actually replaced.
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .limit(1)
        .for('update');
      if (!current) throw AppError.notFound('Feature flag not found');

      const { confirmRegulated, ...fields } = patch;
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
        const to = fields[field];
        if (to === undefined) continue;
        const from = current[field];
        if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
      }

      // Regulated modules (payments, betting, health...) need a deliberate, audited opt-in for
      // any change that leaves them ON with a new reach: switching on, or changing the allowed
      // countries/roles while on. Switching off or editing the description needs no confirmation.
      const enabledAfter = fields.enabled ?? current.enabled;
      const reachChanged = 'enabled' in changes || 'allowedCountries' in changes || 'allowedRoles' in changes;
      if (current.regulated && enabledAfter && reachChanged && confirmRegulated !== true) {
        throw AppError.conflict('Changing the reach of an enabled regulated feature requires confirmRegulated: true', {
          regulated: true,
        });
      }

      const [updated] = await tx
        .update(featureFlags)
        .set({ ...fields, updatedBy: actorUserId })
        .where(eq(featureFlags.key, key))
        .returning();
      await this.audit.record(
        {
          action: 'admin.flag_updated',
          actorUserId,
          meta,
          metadata: { key, changes, confirmedRegulated: current.regulated && confirmRegulated === true },
        },
        tx,
      );
      return toFeatureFlag(updated!);
    });
  }
}
