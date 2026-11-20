import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateDeliveryZoneRequest,
  DELIVERY_ZONES_PER_ORG_MAX,
  type DeliveryZone,
  type DeliveryZoneList,
  ErrorCodes,
  type OrderAddress,
  type UpdateDeliveryZoneRequest,
} from '@caselind/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import type { RequestMeta } from '../common/request-meta.js';
import type { DbExecutor } from '../commerce/catalog.port.js';
import { DB, type Db } from '../db/db.module.js';
import { type DeliveryZoneRow, deliveryZones } from '../db/schema.js';
import { normalizeArea, UUID_RE } from './delivery.shared.js';

const zoneNotFound = () => AppError.notFound('Delivery zone not found');

function toZone(r: DeliveryZoneRow): DeliveryZone {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    areas: r.areas,
    fees: r.fees,
    expressFees: r.expressFees ?? null,
    etaMinutes: r.etaMinutes,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const normalizeAreas = (areas: string[]): string[] => [...new Set(areas.map(normalizeArea).filter((a) => a.length > 0))];

function refused(reason: string, message: string, orgId: string): AppError {
  return new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'zones', message, reason, orgId }]);
}

export interface ResolvedZone {
  zoneId: string;
  /** Zone fee, plus the express supplement when express was asked. */
  feeMinor: number;
  etaMinutes: number;
}

const expressUnavailable = (orgId: string) =>
  AppError.conflict('Express delivery is not offered for this zone', { reason: 'express_unavailable', orgId });

@Injectable()
export class DeliveryZonesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async create(orgId: string, userId: string, body: CreateDeliveryZoneRequest, meta: RequestMeta): Promise<DeliveryZone> {
    const areas = normalizeAreas(body.areas);
    if (areas.length === 0) throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'areas', message: 'no usable area' }]);
    return this.db.transaction(async (tx) => {
      // The count is read under the org row lock so two creations cannot both slip under the limit.
      await tx.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId} FOR UPDATE`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(deliveryZones)
        .where(eq(deliveryZones.orgId, orgId));
      if (n >= DELIVERY_ZONES_PER_ORG_MAX) throw AppError.conflict('Too many delivery zones', { reason: 'zone_limit', max: DELIVERY_ZONES_PER_ORG_MAX });
      const [row] = await tx
        .insert(deliveryZones)
        .values({ orgId, name: body.name, areas, fees: body.fees, expressFees: body.expressFees ?? null, etaMinutes: body.etaMinutes, active: body.active })
        .returning();
      await this.audit.record(
        { action: 'delivery.zone_saved', actorUserId: userId, meta, metadata: { orgId, zoneId: row!.id, created: true } },
        tx,
      );
      return toZone(row!);
    });
  }

  async update(orgId: string, zoneId: string, userId: string, body: UpdateDeliveryZoneRequest, meta: RequestMeta): Promise<DeliveryZone> {
    if (!UUID_RE.test(zoneId)) throw zoneNotFound();
    const patch: Partial<typeof deliveryZones.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.areas !== undefined) {
      patch.areas = normalizeAreas(body.areas);
      if (patch.areas.length === 0) throw new AppError(400, ErrorCodes.validationFailed, 'Request validation failed', [{ path: 'areas', message: 'no usable area' }]);
    }
    if (body.fees !== undefined) patch.fees = body.fees;
    if (body.expressFees !== undefined) patch.expressFees = body.expressFees;
    if (body.etaMinutes !== undefined) patch.etaMinutes = body.etaMinutes;
    if (body.active !== undefined) patch.active = body.active;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(deliveryZones)
        .set(patch)
        .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.orgId, orgId)))
        .returning();
      if (!row) throw zoneNotFound();
      await this.audit.record({ action: 'delivery.zone_saved', actorUserId: userId, meta, metadata: { orgId, zoneId, created: false } }, tx);
      return toZone(row);
    });
  }

  async remove(orgId: string, zoneId: string, userId: string, meta: RequestMeta): Promise<void> {
    if (!UUID_RE.test(zoneId)) throw zoneNotFound();
    await this.db.transaction(async (tx) => {
      // Orders keep their fee; their zone reference is cleared by the foreign key.
      const deleted = await tx
        .delete(deliveryZones)
        .where(and(eq(deliveryZones.id, zoneId), eq(deliveryZones.orgId, orgId)))
        .returning({ id: deliveryZones.id });
      if (deleted.length === 0) throw zoneNotFound();
      await this.audit.record({ action: 'delivery.zone_deleted', actorUserId: userId, meta, metadata: { orgId, zoneId } }, tx);
    });
  }

  /** Active zones of an organisation, for a buyer choosing one at checkout. */
  async listPublic(orgId: string): Promise<DeliveryZoneList> {
    if (!UUID_RE.test(orgId)) return { items: [] };
    return this.list(orgId, true);
  }

  async list(orgId: string, activeOnly: boolean): Promise<DeliveryZoneList> {
    const filters = [eq(deliveryZones.orgId, orgId)];
    if (activeOnly) filters.push(eq(deliveryZones.active, true));
    const rows = await this.db
      .select()
      .from(deliveryZones)
      .where(and(...filters))
      .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));
    return { items: rows.map(toZone) };
  }

  /**
   * Zone and fee of one order at checkout. An organisation without active zone delivers for free (the seller
   * has not priced anything); with zones, `zoneId` is required, must belong to the organisation, cover the
   * address and carry a fee in the order currency. Returns null when there is nothing to charge or schedule.
   */
  async resolveForCheckout(
    tx: DbExecutor,
    orgId: string,
    currency: string,
    zoneId: string | undefined,
    address: OrderAddress,
    speed: 'standard' | 'express' = 'standard',
  ): Promise<ResolvedZone | null> {
    const zones = await tx
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.orgId, orgId), eq(deliveryZones.active, true)))
      .orderBy(asc(deliveryZones.id));
    if (zones.length === 0) {
      if (zoneId) throw refused('zone_not_found', 'unknown delivery zone', orgId);
      // No zone, no supplement to charge: express cannot be offered.
      if (speed === 'express') throw expressUnavailable(orgId);
      return null;
    }
    if (!zoneId) throw refused('zone_required', 'this seller delivers by zone: choose one', orgId);
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) throw refused('zone_not_found', 'unknown delivery zone', orgId);
    const parts = [address.city, address.line2].filter((p): p is string => !!p).map(normalizeArea);
    if (!zone.areas.some((a) => parts.includes(a))) throw refused('zone_not_covered', 'the address is outside the zone', orgId);
    const fee = zone.fees[currency];
    if (fee === undefined) throw refused('zone_currency_unsupported', 'the zone has no fee in the order currency', orgId);
    // The supplement comes from the zone only, never from the client.
    const supplement = speed === 'express' ? zone.expressFees?.[currency] : 0;
    if (supplement === undefined) throw expressUnavailable(orgId);
    return { zoneId: zone.id, feeMinor: fee + supplement, etaMinutes: zone.etaMinutes };
  }
}
