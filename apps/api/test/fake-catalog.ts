import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { CatalogPort, type PricedLine, type ReleaseOptions, type ReserveLine, type ReserveOptions, type ReserveResult } from '../src/commerce/catalog.port.js';
import type { TestContext } from './helpers.js';

/** In-memory catalogue standing in for lot 5A: cart, orders and reviews only talk to the CatalogPort. */
interface FakeVariant {
  productId: string;
  orgId: string;
  currency: string;
  price: number;
  stock: number;
  published: boolean;
  title: string;
  /** false: stock is not tracked (never checked nor moved). */
  trackStock?: boolean;
  /** Promotion in force: reserve reports its units like the real port. */
  promotionId?: string;
}
export class FakeCatalog {
  readonly variants = new Map<string, FakeVariant>();
  readonly products = new Set<string>();
  readonly released: ReserveLine[][] = [];
  readonly releasedPromos: NonNullable<ReleaseOptions['promos']>[] = [];

  add(v: Omit<FakeVariant, 'productId' | 'title' | 'published'> & Partial<FakeVariant>): string {
    const id = randomUUID();
    const productId = v.productId ?? randomUUID();
    this.products.add(productId);
    this.variants.set(id, { productId, title: 'Article', published: true, ...v });
    return id;
  }

  private tracked(variantId: string): boolean {
    return this.variants.get(variantId)!.trackStock !== false;
  }

  private line(variantId: string, quantity: number): PricedLine {
    const v = this.variants.get(variantId)!;
    return {
      variantId,
      productId: v.productId,
      orgId: v.orgId,
      title: v.title,
      variantLabel: 'Standard',
      sku: `SKU-${variantId.slice(0, 4)}`,
      unitPriceMinor: v.price,
      currency: v.currency,
      quantity,
      imageAssetId: null,
      ...(v.promotionId ? { promotionId: v.promotionId, promoUnits: quantity } : {}),
    };
  }

  price(lines: ReserveLine[]): PricedLine[] {
    return lines.filter((l) => this.variants.get(l.variantId)?.published).map((l) => this.line(l.variantId, l.quantity));
  }

  reserve(lines: ReserveLine[], opts: ReserveOptions = {}): ReserveResult {
    const bad = lines.filter((l) => {
      const v = this.variants.get(l.variantId);
      return !v || !v.published || (opts.orgId !== undefined && v.orgId !== opts.orgId);
    });
    if (bad.length > 0) return { ok: false, reason: 'unavailable', variantIds: bad.map((l) => l.variantId) };
    const short = lines.filter((l) => this.tracked(l.variantId) && this.variants.get(l.variantId)!.stock < l.quantity);
    if (short.length > 0) return { ok: false, reason: 'insufficient_stock', variantIds: short.map((l) => l.variantId) };
    for (const l of lines) if (this.tracked(l.variantId)) this.variants.get(l.variantId)!.stock -= l.quantity;
    return { ok: true, lines: lines.map((l) => this.line(l.variantId, l.quantity)) };
  }

  release(lines: ReserveLine[], opts: ReleaseOptions = {}): void {
    this.released.push(lines);
    if (opts.promos?.length) this.releasedPromos.push(opts.promos);
    for (const l of lines) if (this.tracked(l.variantId)) this.variants.get(l.variantId)!.stock += l.quantity;
  }
}

/** Replaces the catalogue port of a running app with the in-memory one. */
export function installFakeCatalog(ctx: TestContext, fake: FakeCatalog): void {
  const port = ctx.app.get(CatalogPort);
  vi.spyOn(port, 'price').mockImplementation(async (lines) => fake.price(lines));
  vi.spyOn(port, 'reserve').mockImplementation(async (_tx, lines, _buyerId, opts) => fake.reserve(lines, opts));
  vi.spyOn(port, 'release').mockImplementation(async (_tx, lines, opts) => fake.release(lines, opts));
  vi.spyOn(port, 'productExists').mockImplementation(async (id) => fake.products.has(id));
}
