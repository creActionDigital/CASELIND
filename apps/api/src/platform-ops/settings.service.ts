import { Inject, Injectable } from '@nestjs/common';
import { type AdminSetting, type AdminSettingList, type PublicConfig, type PutSettingRequest, settingValueSchemas, type SettingKey } from '@caselind/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { RequestMeta } from '../common/request-meta.js';
import { DB, type Db } from '../db/db.module.js';

type Reader = Pick<Db, 'execute'>;

/**
 * Paramètres de la plateforme par pays et par ville. Liste blanche de clés, valeur validée par clé (zod) à l'écriture
 * comme à la lecture. Résolution : la portée la plus précise d'abord (ville, pays, puis global).
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(key?: SettingKey): Promise<AdminSettingList> {
    const r = await this.db.execute<{ key: SettingKey; scope: string; value: unknown; updated_by: string | null; updated_at: Date }>(sql`
      SELECT key, scope, value, updated_by, updated_at FROM platform_settings ${key ? sql`WHERE key = ${key}` : sql``} ORDER BY key, scope`);
    return { items: r.rows.map((x): AdminSetting => ({ key: x.key, scope: x.scope, value: x.value, updatedBy: x.updated_by, updatedAt: new Date(x.updated_at).toISOString() })) };
  }

  /** Sets (or replaces) one value. The request was validated by `putSettingRequestSchema`; audited with the key and the scope, not the value. */
  async put(adminId: string, b: PutSettingRequest, meta: RequestMeta, exec: Pick<Db, 'transaction'> = this.db): Promise<AdminSetting> {
    return exec.transaction(async (tx) => {
      const r = await tx.execute<{ updated_at: Date }>(sql`
        INSERT INTO platform_settings (key, scope, value, updated_by) VALUES (${b.key}, ${b.scope}, ${JSON.stringify(b.value)}::jsonb, ${adminId}::uuid)
        ON CONFLICT (key, scope) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING updated_at`);
      await this.audit.record({ action: 'admin.setting_changed', actorUserId: adminId, meta, metadata: { key: b.key, scope: b.scope, reason: b.reason } }, tx);
      return { key: b.key, scope: b.scope, value: b.value, updatedBy: adminId, updatedAt: new Date(r.rows[0]!.updated_at).toISOString() };
    });
  }

  /** First stored value among `scopes` (most precise first) that is still valid for its key; `undefined` when none. */
  async resolve<K extends SettingKey>(key: K, scopes: string[], exec: Reader = this.db): Promise<z.output<(typeof settingValueSchemas)[K]> | undefined> {
    const r = await exec.execute<{ scope: string; value: unknown }>(sql`
      SELECT scope, value FROM platform_settings WHERE key = ${key} AND scope = ANY(ARRAY[${sql.join(scopes.map((s) => sql`${s}`), sql`, `)}]::text[])`);
    for (const scope of scopes) {
      const row = r.rows.find((x) => x.scope === scope);
      if (!row) continue;
      const parsed = settingValueSchemas[key].safeParse(row.value);
      if (parsed.success) return parsed.data as z.output<(typeof settingValueSchemas)[K]>;
    }
    return undefined;
  }

  /** Non-sensitive keys only, resolved for the requested country and city. */
  async publicConfig(country?: string, city?: string): Promise<PublicConfig> {
    const scopes = [...(country && city ? [`city:${country}:${city}`] : []), ...(country ? [`country:${country}`] : []), 'global'];
    return {
      supportContact: (await this.resolve('support.contact', scopes)) ?? null,
      currenciesEnabled: (await this.resolve('currencies.enabled', scopes.filter((s) => !s.startsWith('city:')))) ?? null,
      pilotCities: (await this.resolve('cities.pilot', scopes.filter((s) => !s.startsWith('city:')))) ?? null,
    };
  }
}
