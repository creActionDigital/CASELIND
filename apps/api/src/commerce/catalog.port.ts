import { Injectable } from '@nestjs/common';
import type { Db } from '../db/db.module.js';

/** Executor accepted by the port: the app's Db or a transaction opened from it. */
export type DbExecutor = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface ReserveLine {
  variantId: string;
  quantity: number;
}

/** Snapshot of a sellable variant at checkout time; orders copy it so later catalogue edits never change them. */
export interface PricedLine {
  variantId: string;
  productId: string;
  orgId: string;
  title: string;
  variantLabel: string | null;
  sku: string | null;
  /** Effective price: the promotion in force is applied here (the only place a price is fixed). */
  unitPriceMinor: number;
  /** Base price when a promotion lowers `unitPriceMinor` (crossed out), else null/absent. */
  compareAtPriceMinor?: number | null;
  currency: string;
  quantity: number;
  imageAssetId: string | null;
  /** Promotion whose units `reserve` counted for this line (null/absent: base price); kept on the order item to give them back. */
  promotionId?: string | null;
  promoUnits?: number;
}

/** `orgId`: only variants of that org count (others read as unavailable); `reason`: label of the stock movement. */
export interface ReserveOptions {
  orgId?: string;
  reason?: 'order_reserved' | 'pos_sale';}

/** `reason`: label of the stock movement (default `order_released`). */
export interface ReleaseOptions {
  reason?: 'order_released' | 'pos_void' | 'return_restocked';
  /** Promotional units to give back (sold_count - units, never below 0), read from the order items. */
  promos?: { promotionId: string; units: number }[];
}

export type ReserveResult =
  | { ok: true; lines: PricedLine[] }
  | { ok: false; reason: 'unavailable' | 'insufficient_stock'; variantIds: string[] };

/**
 * What orders, cart and reviews (lot 5B) need from the catalogue (lot 5A), so neither module imports the
 * other's tables. Implemented by the catalogue module; this stub knows no product.
 */
@Injectable()
export class CatalogPort {
  /**
   * Current price and availability for display (cart). Unknown, unpublished, archived, hidden variants and those
   * of a private or suspended org (or of a seller blocked with `viewerId`) are omitted.
   */
  async price(_lines: ReserveLine[], _viewerId?: string): Promise<PricedLine[]> {
    return [];
  }
  /**
   * Inside the caller's transaction: locks the variants (FOR UPDATE, ordered by id), checks that each is
   * published, its product and org are active, and stock covers the quantity, then decrements the stock.
   * All or nothing.
   */
  async reserve(_tx: DbExecutor, _lines: ReserveLine[], _buyerId?: string, _opts?: ReserveOptions): Promise<ReserveResult> {
    return { ok: false, reason: 'unavailable', variantIds: _lines.map((l) => l.variantId) };
  }
  /** Inside the caller's transaction: gives the stock back (order cancelled before shipping, counter sale voided). */
  async release(_tx: DbExecutor, _lines: ReserveLine[], _opts?: ReleaseOptions): Promise<void> {}
  /** Whether the product exists and is visible to buyers (reviews). */
  async productExists(_productId: string, _viewerId?: string): Promise<boolean> {
    return false;
  }
}
